"""Predicciones fuera de muestra (out-of-fold) para los años de entrenamiento 2018-2023.

Para cada año Y de entrenamiento se entrena un Random Forest con los OTROS años de entrenamiento
(misma receta que el modelo principal), se calibra con 2024 y se predice solo Y. Así ninguna
probabilidad servida para 2018-2023 sale de un modelo que vio ese año.

Salidas: models/fold_{Y}.joblib, data/processed/oof_prob.npz, metrics/oof_metrics.json
Uso: python -m firesight.oof
"""
import json

import firesight  # noqa: F401
import joblib
import numpy as np
from sklearn.ensemble import RandomForestClassifier

from . import predict as PR
from .common import calibrate_prefit, load_cube, year_mask
from .config import METRICS, MODELS, PROCESSED, SEED, TRAIN_YEARS, VAL_YEARS


def main():
    rng = np.random.default_rng(SEED)
    cube, cells = load_cube()
    F, y = PR.build(cube, cells)
    n, T = y.shape
    dates = cube["dates"]
    yr = y.ravel()
    defined = ~np.isnan(yr)
    flat_year = np.broadcast_to(dates.year.to_numpy(), (n, T)).ravel()
    main_thr = joblib.load(MODELS / "fire_predictor.joblib")["threshold"]

    i_va = np.flatnonzero(np.isin(flat_year, VAL_YEARS) & defined)
    X_va, y_va = PR.frame(F, i_va), yr[i_va].astype(int)
    oof = np.full((n, T), np.nan, dtype=np.float32)
    report = {"method": "leave-one-year-out sobre 2018-2023; calibración isotónica en 2024", "folds": {}}
    for Y in TRAIN_YEARS:
        others = [t for t in TRAIN_YEARS if t != Y]
        i_tr = np.flatnonzero(np.isin(flat_year, others) & defined)
        keep = (yr[i_tr] == 1) | (rng.random(len(i_tr)) < PR.NEG_KEEP)
        i_fit = i_tr[keep]
        rf = RandomForestClassifier(n_estimators=300, min_samples_leaf=50, max_features="sqrt", max_samples=0.5,
                                    class_weight="balanced_subsample", n_jobs=-1, random_state=SEED)
        rf.fit(PR.frame(F, i_fit), yr[i_fit].astype(int))
        cal = calibrate_prefit(rf, X_va, y_va)
        cols = np.flatnonzero(year_mask(dates, [Y]))
        i_y = (np.arange(n)[:, None] * T + cols[None, :]).ravel()
        p = np.concatenate([cal.predict_proba(PR.frame(F, i_y[s:s + 1_000_000]))[:, 1]
                            for s in range(0, len(i_y), 1_000_000)])
        oof.ravel()[i_y] = p
        m = defined[i_y]
        ev = PR.evaluate(yr[i_y][m].astype(int), p[m], main_thr)
        ev.pop("calibration")
        report["folds"][str(Y)] = ev
        joblib.dump({"version": f"pred-1.0.0-fold{Y}", "model": cal, "features": PR.FEATURES, "excluded_year": Y},
                    MODELS / f"fold_{Y}.joblib", compress=3)
        print(f"[oof] {Y}: PR-AUC={ev['pr_auc']:.3f} F1={ev['f1']:.3f} Brier={ev['brier']:.4f} (fit {len(i_fit):,})", flush=True)
    np.savez_compressed(PROCESSED / "oof_prob.npz", prob=oof)
    (METRICS / "oof_metrics.json").write_text(json.dumps(report, indent=2, ensure_ascii=False))


if __name__ == "__main__":
    main()
