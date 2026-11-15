"""Exporta las predicciones del Modelo B a un artefacto liviano que cualquier backend puede servir
sin sklearn: probabilidad calibrada por celda/día y, para las celdas relevantes, la explicación local
exacta del Random Forest (sesgo + Σ aportes = probabilidad del bosque antes de calibrar).

Uso:  python -m firesight.export_serving [AÑO] [DIR_SALIDA]      (por defecto 2024 y data/models/)

Salidas en DIR_SALIDA:
  predictions_{AÑO}.parquet   h3_id, issue_date, probability, above_threshold        (todas las celdas y días)
  explanations_{AÑO}.parquet  h3_id, issue_date, forest_bias, forest_raw, v_<var>, c_<var> (23 variables)
                              solo celdas con probabilidad >= EXPLAIN_MIN_P o entre las 30 de mayor
                              probabilidad de ese día
  model_card.json             versión, métricas (validación, prueba, externa, OOF), umbral, variables, avisos
"""
import json
import sys
from pathlib import Path

import firesight  # noqa: F401  (sklearn antes que lightgbm en ARM)
import joblib
import numpy as np
import pandas as pd
import scipy.sparse as sp

from . import predict as PR
from .common import base_estimator, load_cube, year_mask
from .config import METRICS, MODELS, SERVING, TEST_YEARS, TRAIN_YEARS, VAL_YEARS

EXPLAIN_MIN_P = 0.05
TOP_PER_DAY = 30


def forest_contributions(rf, X):
    """Saabas / treeinterpreter vectorizado: para cada árbol, el cambio de probabilidad padre→hijo se
    atribuye a la variable del nodo padre. contrib = camino(filas×nodos) @ D(nodos×variables)."""
    Xa = np.asarray(X, dtype=np.float32)
    m, k = Xa.shape
    contrib = np.zeros((m, k))
    bias = 0.0
    for est in rf.estimators_:
        tr = est.tree_
        val = tr.value[:, 0, :]
        p1 = val[:, 1] / val.sum(1)
        bias += p1[0]
        parent = np.full(tr.node_count, -1)
        for side in (tr.children_left, tr.children_right):
            ok = side >= 0
            parent[side[ok]] = np.flatnonzero(ok)
        nodes = np.flatnonzero(parent >= 0)
        D = sp.csr_matrix((p1[nodes] - p1[parent[nodes]], (nodes, tr.feature[parent[nodes]])),
                          shape=(tr.node_count, k))
        contrib += (est.decision_path(Xa) @ D).toarray()
    n = len(rf.estimators_)
    return bias / n, contrib / n


def main(year=2024, out=SERVING):
    out = Path(out)
    out.mkdir(parents=True, exist_ok=True)
    bundle = joblib.load(MODELS / "fire_predictor.joblib")
    if year in TRAIN_YEARS:
        raise SystemExit("Para años de entrenamiento use los modelos fold_{año}.joblib (no implementado aquí).")
    cal, thr = bundle["model"], bundle["threshold"]
    rf = base_estimator(cal)
    cube, cells = load_cube()
    F, _ = PR.build(cube, cells)
    dates = cube["dates"]
    n, T = F[PR.FEATURES[0]].shape
    cols = np.flatnonzero(year_mask(dates, [year]))
    h3_ids = cells.h3_id.astype(str).to_numpy()
    i_y = (np.arange(n)[:, None] * T + cols[None, :]).ravel()
    X = PR.frame(F, i_y)[list(rf.feature_names_in_)]
    p = cal.predict_proba(X)[:, 1]
    cell_idx, day_idx = np.divmod(i_y, T)
    pred = pd.DataFrame({"h3_id": h3_ids[cell_idx], "issue_date": dates[day_idx].date,
                         "probability": p.astype(np.float32), "above_threshold": p >= thr})
    pred.to_parquet(out / f"predictions_{year}.parquet", index=False, compression="zstd")

    # filas a explicar: p >= EXPLAIN_MIN_P o top-30 del día (para el detalle regional)
    rank = pred.groupby("issue_date").probability.rank(ascending=False, method="first")
    sel = np.flatnonzero((pred.probability.to_numpy() >= EXPLAIN_MIN_P) | (rank.to_numpy() <= TOP_PER_DAY))
    Xs = X.iloc[sel].reset_index(drop=True)
    bias, contrib = forest_contributions(rf, Xs)
    raw = rf.predict_proba(Xs)[:, 1]
    err = float(np.abs(bias + contrib.sum(1) - raw).max())
    ex = pred.iloc[sel][["h3_id", "issue_date"]].reset_index(drop=True)
    ex["forest_bias"] = np.float32(bias)
    ex["forest_raw"] = raw.astype(np.float32)
    for j, k in enumerate(rf.feature_names_in_):
        ex["v_" + k] = Xs[k].to_numpy(np.float32)
        ex["c_" + k] = contrib[:, j].astype(np.float32)
    ex.to_parquet(out / f"explanations_{year}.parquet", index=False, compression="zstd")

    pm = json.loads((METRICS / "prediction_metrics.json").read_text())
    ext = {p_.stem.replace("external_validation_", ""): json.loads(p_.read_text())
           for p_ in sorted(METRICS.glob("external_validation_*-*.json"))}
    oof = METRICS / "oof_metrics.json"
    split = "validation" if year in VAL_YEARS else "test" if year in TEST_YEARS else "external"
    card = {
        "model_version": bundle["version"], "harmonizer_version": bundle["harmonizer_version"],
        "year": year, "evaluation_split": split, "threshold_f1": thr,
        "region": {"id": "chiquitania", "name": "Chiquitanía (Santa Cruz)", "h3_resolution": 6,
                   "cell_count": int(n), "bbox": [float(cells.lon.min()), float(cells.lat.min()),
                                                  float(cells.lon.max()), float(cells.lat.max())]},
        "explanations": {"min_probability": EXPLAIN_MIN_P, "top_per_day": TOP_PER_DAY, "rows": int(len(ex)),
                         "max_decomposition_error": err,
                         "meaning": "Aporte local de cada variable a la probabilidad del bosque, antes de la calibración isotónica."},
        "feature_order": list(rf.feature_names_in_),
        "prediction_metrics": pm,
        "external_validation": {k: v.get("external_predictor", v) for k, v in ext.items()},
        "oof_metrics": json.loads(oof.read_text()) if oof.exists() else None,
    }
    (out / "model_card.json").write_text(json.dumps(card, indent=1, ensure_ascii=False, default=float))
    print(f"[export] {year}: {len(pred):,} predicciones, {len(ex):,} explicadas (error de descomposición {err:.1e}) → {out}")


if __name__ == "__main__":
    main(int(sys.argv[1]) if len(sys.argv) > 1 else 2024, *(sys.argv[2:3]))
