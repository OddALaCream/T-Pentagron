"""Validación con datos nunca vistos, usando los modelos YA entrenados (sin reentrenar).

1) Reproducibilidad: recalcula 2025 con los modelos guardados y compara con predictions.parquet.
2) Datos externos: aplica Modelo A y Modelo B a un cubo independiente (por defecto data_holdout/,
   2012-2017, construido con FIRESIGHT_DATA=data_holdout FIRESIGHT_YEARS=2012-2017 fetch + index_h3).
3) Intervalos de confianza: bootstrap por bloques de días (las celdas de un mismo día no son independientes).

Uso: python -m firesight.evaluate_external [carpeta_processed_externa] [año_inicio-año_fin]
"""
import json
import sys
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
from sklearn.metrics import average_precision_score, brier_score_loss, f1_score

from . import harmonize as HA
from . import predict as PR
from .common import load_cube, year_mask
from .config import METRICS, MODELS, PROCESSED, ROOT, SEED, TEST_YEARS

N_BOOT = int(__import__("os").environ.get("FIRESIGHT_NBOOT", 50))


def harmonizer_eval(cube, H, years):
    cells_n, T = cube["modis_count"].shape
    F = HA.build_features(cube, CELLS)
    X = pd.DataFrame({k: F[k].ravel() for k in HA.FEATURES})
    both = np.broadcast_to(cube["modis_avail"] & cube["viirs_avail"] & year_mask(cube["dates"], years),
                           (cells_n, T)).ravel()
    idx = np.flatnonzero(both)
    Xi = X.iloc[idx]
    y = cube["viirs_count"].ravel()[idx].astype(float)
    w = np.ones(len(idx))
    pb = H["baseline"].predict(Xi.m_count.values, Xi.month.values)
    pl = np.concatenate([H["lgbm"].predict(Xi.iloc[s:s + 2_000_000], num_iteration=H["lgbm"].best_iteration)
                         for s in range(0, len(Xi), 2_000_000)])
    eq, _, _ = HA.apply_harmonizer(F, H, cells_n, T)
    pf = eq.ravel()[idx]
    out = {"n_pairs": int(len(idx)), "raw_modis": HA.scores(y, Xi.m_count.values, w),
           "baseline": HA.scores(y, pb, w), "lgbm": HA.scores(y, pl, w), "final": HA.scores(y, pf, w)}
    yr = cube["dates"].year.to_numpy()[idx % T]
    ann = pd.DataFrame({"year": yr, "viirs": y, "modis": Xi.m_count.values, "harm": pf}).groupby("year").sum()
    out["annual_totals"] = {int(k): {"viirs": float(r.viirs), "modis_raw": float(r.modis), "harmonized": float(r.harm),
                                     "ratio_harm_viirs": float(r.harm / max(r.viirs, 1e-9))} for k, r in ann.iterrows()}
    day = pd.DataFrame({"d": idx % T, "y": y, "f": pf, "m": Xi.m_count.values}).groupby("d").sum()
    out["aoi_daily_corr"] = {"raw_modis": float(day.y.corr(day.m)), "final": float(day.y.corr(day.f))}
    act = np.where(np.broadcast_to(cube["viirs_avail"], (cells_n, T)), cube["viirs_count"],
                   np.where(np.broadcast_to(cube["modis_avail"], (cells_n, T)), eq, np.nan)).astype(np.float32)
    return out, act


def bootstrap(y, scores_by_model, day, rng, thr):
    """IC 95 % de PR-AUC/F1/Brier y de las diferencias RF - referencia, remuestreando días completos."""
    order = np.argsort(day, kind="stable")
    days, starts = np.unique(day[order], return_index=True)
    pos = dict(zip(days, np.split(order, starts[1:])))
    res = {m: {"pr_auc": [], "f1": [], "brier": []} for m in scores_by_model}
    for _ in range(N_BOOT):
        pick = rng.choice(days, size=len(days), replace=True)
        ii = np.concatenate([pos[d] for d in pick])
        yy = y[ii]
        if yy.sum() == 0:
            continue
        for m, p in scores_by_model.items():
            pp = p[ii]
            res[m]["pr_auc"].append(average_precision_score(yy, pp))
            res[m]["f1"].append(f1_score(yy, pp >= thr[m], zero_division=0))
            res[m]["brier"].append(brier_score_loss(yy, np.clip(pp, 0, 1)))
    ci = lambda a: [float(np.percentile(a, 2.5)), float(np.percentile(a, 97.5))]  # noqa: E731
    out = {m: {k: ci(v) for k, v in d.items()} for m, d in res.items()}
    for ref in [m for m in scores_by_model if m != "random_forest"]:
        out[f"rf_minus_{ref}"] = {k: ci(np.array(res["random_forest"][k]) - np.array(res[ref][k]))
                                  for k in ("pr_auc", "f1", "brier")}
    return out


def predictor_eval(cube, act, P, tables, years, rng):
    F, y = PR.build(cube, CELLS, act_raw=act, clim_tables=tables)
    n, T = y.shape
    yr = y.ravel()
    idx = np.flatnonzero(np.broadcast_to(year_mask(cube["dates"], years), (n, T)).ravel() & ~np.isnan(yr))
    X = PR.frame(F, idx)
    yy = yr[idx].astype(int)
    p_rf = np.concatenate([P["model"].predict_proba(X.iloc[s:s + 500_000])[:, 1] for s in range(0, len(X), 500_000)])
    thr_val = json.loads((METRICS / "prediction_metrics.json").read_text())["models"]
    probs = {"random_forest": p_rf, "seasonal_baseline": X.clim_cell_month.values, "persistence": X.detected_t.values}
    thr = {m: thr_val[m]["val"]["threshold"] for m in probs}
    out = {"n": int(len(idx)), "models": {m: PR.evaluate(yy, p, thr[m]) for m, p in probs.items()}}
    # por año y por temporada (seca/quema jul-oct vs resto)
    dts = cube["dates"][idx % T]
    for name, mask in [*[(str(y_), dts.year == y_) for y_ in years],
                       ("fire_season_jul_oct", dts.month.isin([7, 8, 9, 10])),
                       ("jan_aug", dts.month <= 8), ("sep_dec", dts.month >= 9),
                       ("rest_of_year", ~dts.month.isin([7, 8, 9, 10]))]:
        mask = np.asarray(mask)
        if yy[mask].sum() > 0:
            out.setdefault("by_subset", {})[name] = {
                m: {k: v for k, v in PR.evaluate(yy[mask], p[mask], thr[m]).items() if k != "calibration"}
                for m, p in probs.items()}
    out["bootstrap_95ci_by_day"] = bootstrap(yy, probs, idx % T, rng, thr)
    return out, p_rf, idx


def main():
    global CELLS
    rng = np.random.default_rng(SEED)
    ext_dir = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / "data" / "firesight_holdout" / "processed"
    ext_years = sys.argv[2] if len(sys.argv) > 2 else "2013-2017"
    a, b = map(int, ext_years.split("-"))
    ext_years = list(range(a, b + 1))
    H = joblib.load(MODELS / "harmonizer.joblib")
    P = joblib.load(MODELS / "fire_predictor.joblib")
    report = {"harmonizer_version": H["version"], "predictor_version": P["version"]}

    # ----- cubo principal: climatología fija + reproducibilidad 2025
    cube, CELLS = load_cube()
    _, y_main, _, _ = PR.labels(cube)
    tables = PR.climatology_table(y_main, cube["dates"])
    act_main = np.load(PROCESSED / "harmonized_cube.npz")["activity_index"]
    print("[ext] 2025 (prueba original) con modelos guardados + IC bootstrap")
    r25, p25, idx25 = predictor_eval(cube, act_main, P, tables, TEST_YEARS, rng)
    report["test_2025"] = r25
    saved = pd.read_parquet(PROCESSED / "predictions.parquet")
    T = cube["modis_count"].shape[1]
    key = pd.DataFrame({"h3_id": CELLS.h3_id.values[idx25 // T], "issue_date": cube["dates"].values[idx25 % T], "p": p25})
    m = key.merge(saved[["h3_id", "issue_date", "probability"]].astype({"h3_id": str}), on=["h3_id", "issue_date"])
    report["reproducibility_2025_max_abs_diff"] = float(np.abs(m.p - m.probability).max())
    report["reproducibility_rows_matched"] = int(len(m))
    print(f"   reproducibilidad: {len(m):,} filas, max |Δp| = {report['reproducibility_2025_max_abs_diff']:.2e}")
    del cube, act_main

    # ----- datos externos nunca vistos
    cube_x, cells_x = load_cube(ext_dir)
    assert cells_x.h3_id.tolist() == CELLS.h3_id.tolist(), "la grilla H3 externa no coincide"
    print(f"[ext] Modelo A en {ext_years}")
    rA, act_x = harmonizer_eval(cube_x, H, ext_years)
    report["external_harmonizer"] = {"years": ext_years, **rA}
    print(f"   dev raw={rA['raw_modis']['poisson_deviance']:.3f} base={rA['baseline']['poisson_deviance']:.3f} "
          f"lgbm={rA['lgbm']['poisson_deviance']:.3f} final={rA['final']['poisson_deviance']:.3f}")
    print(f"[ext] Modelo B en {ext_years}")
    rB, _, _ = predictor_eval(cube_x, act_x, P, tables, ext_years, rng)
    report["external_predictor"] = {"years": ext_years, **rB}
    for mname, v in rB["models"].items():
        print(f"   {mname:18s} PR-AUC={v['pr_auc']:.3f} F1={v['f1']:.3f} Brier={v['brier']:.4f} "
              f"P={v['precision']:.3f} R={v['recall']:.3f}")
    (METRICS / f"external_validation_{ext_years[0]}-{ext_years[-1]}.json").write_text(json.dumps(report, indent=2, ensure_ascii=False))
    print(f"[ext] metrics/external_validation_{ext_years[0]}-{ext_years[-1]}.json")


CELLS = None

if __name__ == "__main__":
    main()
