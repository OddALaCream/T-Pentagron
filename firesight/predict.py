"""Modelo B — P(detección térmica registrada en t+1 | información hasta t) por celda H3.

Objetivo: Y(t+1) = 1 si MODIS o VIIRS registran >= 1 detección (QA) en la celda el día t+1.
          Y(t+1) = 0 solo si VIIRS (el sensor más sensible) estaba operativo en t+1 y nadie detectó.
          Si no hay observabilidad -> etiqueta indefinida (se descarta). NO equivale a ignición.

Features (todas disponibles al cierre del día t, sin fuga): actividad armonizada (Modelo A) en t,
3/7/30 días, días desde la última detección, FRP 7d, vecinos H3, calendario, posición, clima
NASA POWER (lluvia 7/30d, días sin lluvia, Tmax, HR, viento, nubosidad) y climatología celda-mes
calculada solo con años de entrenamiento (leave-one-year-out dentro del entrenamiento).

Comparación: baseline estacional (climatología celda-mes), persistencia, regresión logística y
Random Forest. Calibración isotónica en 2024, umbral F1 elegido en 2024, reporte en 2025.
"""
import json

import joblib
import numpy as np
import pandas as pd
from sklearn.ensemble import RandomForestClassifier
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import (average_precision_score, brier_score_loss, confusion_matrix,
                             f1_score, precision_score, recall_score, roc_auc_score)
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler

from .common import calendar, calibrate_prefit, days_since, load_cube, nbr_sum, past_sum, year_mask
from .config import (HARMONIZER_VERSION, METRICS, MODELS, PREDICTOR_VERSION, PROCESSED, SEED,
                     TEST_YEARS, TRAIN_YEARS, VAL_YEARS)

NEG_KEEP = 0.10
PRIOR_STRENGTH = 20.0
FEATURES = ["act_t", "act_3d", "recent_activity_7d", "recent_activity_30d", "detected_t", "days_since_det",
            "frp_7d", "nbr_act_t", "nbr_act_7d", "month", "doy_sin", "doy_cos", "lat", "lon",
            "rain_7d", "rain_30d", "days_since_rain", "temp_7d", "rh_7d", "wind_7d", "cloud_t",
            "clim_cell_month", "clim_cell"]


def labels(cube):
    """det (n,T): detección QA de cualquier sensor operativo en t; y (n,T): etiqueta de t+1."""
    n, T = cube["modis_count"].shape
    ma = np.broadcast_to(cube["modis_avail"], (n, T))
    va = np.broadcast_to(cube["viirs_avail"], (n, T))
    det = ((cube["modis_count"] > 0) & ma) | ((cube["viirs_count"] > 0) & va)
    # etiqueta t+1 con criterio de observabilidad
    y = np.full((n, T), np.nan, dtype=np.float32)
    y[:, :-1] = np.where(det[:, 1:], 1.0, np.where(va[:, 1:], 0.0, np.nan))
    return det, y, ma, va


def build(cube, cells, act_raw=None, clim_tables=None):
    """Features + etiquetas. act_raw: activity_index armonizado (por defecto, el guardado por el Modelo A).
    clim_tables: (tabla celda-mes, tabla celda) fija de entrenamiento para aplicar a datos externos."""
    if act_raw is None:
        act_raw = np.load(PROCESSED / "harmonized_cube.npz")["activity_index"]
    n, T = act_raw.shape
    dates = cube["dates"]
    det, y, ma, va = labels(cube)
    act = np.nan_to_num(act_raw)

    cal = calendar(dates)
    nb = nbr_sum(act, cube["nbr1"])
    frp = cube["modis_frp_sum"] * ma + cube["viirs_frp_sum"] * va
    rain = cube["clim_prectotcorr"]
    F = {
        "act_t": act, "act_3d": past_sum(act, 3, True), "recent_activity_7d": past_sum(act, 7, True),
        "recent_activity_30d": past_sum(act, 30, True), "detected_t": det.astype(np.float32),
        "days_since_det": days_since(det), "frp_7d": past_sum(frp, 7, True),
        "nbr_act_t": nb, "nbr_act_7d": past_sum(nb, 7, True),
        "month": np.broadcast_to(cal["month"], (n, T)),
        "doy_sin": np.broadcast_to(cal["doy_sin"], (n, T)), "doy_cos": np.broadcast_to(cal["doy_cos"], (n, T)),
        "lat": np.broadcast_to(cells.lat.to_numpy()[:, None], (n, T)),
        "lon": np.broadcast_to(cells.lon.to_numpy()[:, None], (n, T)),
        "rain_7d": past_sum(rain, 7, True), "rain_30d": past_sum(rain, 30, True),
        "days_since_rain": days_since(rain > 1.0),
        "temp_7d": past_sum(cube["clim_t2m_max"], 7, True) / 7, "rh_7d": past_sum(cube["clim_rh2m"], 7, True) / 7,
        "wind_7d": past_sum(cube["clim_ws2m"], 7, True) / 7, "cloud_t": cube["clim_cloud_amt"],
    }
    if clim_tables is None:
        F["clim_cell_month"], F["clim_cell"] = climatology(y, dates, n, T)
    else:
        cm_tab, cc_tab = clim_tables
        F["clim_cell_month"] = cm_tab[:, dates.month.to_numpy() - 1]
        F["clim_cell"] = np.broadcast_to(cc_tab[:, None], (n, T))
    F = {k: np.asarray(v, dtype=np.float32) for k, v in F.items()}
    return F, y


def climatology(y, dates, n, T):
    """Frecuencia de Y=1 por celda-mes usando SOLO años de entrenamiento.

    Filas de entrenamiento: leave-one-year-out (se excluye su propio año) para no filtrar la etiqueta.
    Filas de validación/prueba: todos los años de entrenamiento. Suavizado hacia la media del mes."""
    years = dates.year.to_numpy()
    months = dates.month.to_numpy() - 1
    ty = TRAIN_YEARS
    pos = np.zeros((n, 12, len(ty)))
    obs = np.zeros((n, 12, len(ty)))
    for k, yr in enumerate(ty):
        for mo in range(12):
            s = (years == yr) & (months == mo)
            yy = y[:, s]
            pos[:, mo, k] = np.nansum(yy, axis=1)
            obs[:, mo, k] = np.sum(~np.isnan(yy), axis=1)
    P, O = pos.sum(2), obs.sum(2)
    cm = np.zeros((n, T), dtype=np.float32)
    cc = np.zeros((n, T), dtype=np.float32)
    for t in range(T):
        mo, yr = months[t], years[t]
        if yr in ty:
            k = ty.index(yr)
            p_m, o_m = P[:, mo] - pos[:, mo, k], O[:, mo] - obs[:, mo, k]
            p_a, o_a = P.sum(1) - pos[:, :, k].sum(1), O.sum(1) - obs[:, :, k].sum(1)
        else:
            p_m, o_m, p_a, o_a = P[:, mo], O[:, mo], P.sum(1), O.sum(1)
        prior = p_m.sum() / max(o_m.sum(), 1)
        cm[:, t] = (p_m + PRIOR_STRENGTH * prior) / (o_m + PRIOR_STRENGTH)
        cc[:, t] = (p_a + 1) / (o_a + 2)
    return cm, cc


def climatology_table(y, dates):
    """Tablas fijas (celda x mes, celda) con TODOS los años de entrenamiento: idénticas a las que
    climatology() usa para filas fuera de entrenamiento (validación, prueba, datos externos)."""
    years, months = dates.year.to_numpy(), dates.month.to_numpy() - 1
    tr = np.isin(years, TRAIN_YEARS)
    n = y.shape[0]
    P, O = np.zeros((n, 12)), np.zeros((n, 12))
    for mo in range(12):
        yy = y[:, tr & (months == mo)]
        P[:, mo], O[:, mo] = np.nansum(yy, axis=1), np.sum(~np.isnan(yy), axis=1)
    prior = P.sum(0) / np.maximum(O.sum(0), 1)
    cm = ((P + PRIOR_STRENGTH * prior) / (O + PRIOR_STRENGTH)).astype(np.float32)
    cc = ((P.sum(1) + 1) / (O.sum(1) + 2)).astype(np.float32)
    return cm, cc


def frame(F, idx):
    return pd.DataFrame({k: F[k].ravel()[idx] for k in FEATURES})


def evaluate(y, p, thr):
    yhat = (p >= thr).astype(int)
    tn, fp, fn, tp = confusion_matrix(y, yhat, labels=[0, 1]).ravel()
    bins = np.clip((p * 10).astype(int), 0, 9)
    calib = [{"bin": f"{b / 10:.1f}-{(b + 1) / 10:.1f}", "n": int((bins == b).sum()),
              "mean_pred": float(p[bins == b].mean()) if (bins == b).any() else None,
              "obs_rate": float(y[bins == b].mean()) if (bins == b).any() else None} for b in range(10)]
    return {"threshold": float(thr), "precision": float(precision_score(y, yhat, zero_division=0)),
            "recall": float(recall_score(y, yhat, zero_division=0)), "f1": float(f1_score(y, yhat, zero_division=0)),
            "pr_auc": float(average_precision_score(y, p)), "roc_auc": float(roc_auc_score(y, p)),
            "brier": float(brier_score_loss(y, np.clip(p, 0, 1))),
            "confusion_matrix": {"tn": int(tn), "fp": int(fp), "fn": int(fn), "tp": int(tp)},
            "base_rate": float(y.mean()), "n": int(len(y)), "calibration": calib}


def best_threshold(y, p):
    grid = np.unique(np.quantile(p, np.linspace(0.5, 0.999, 200)))
    f1s = [f1_score(y, p >= g, zero_division=0) for g in grid]
    return float(grid[int(np.argmax(f1s))])


def main():
    rng = np.random.default_rng(SEED)
    cube, cells = load_cube()
    F, y = build(cube, cells)
    n, T = y.shape
    dates = cube["dates"]
    yr = y.ravel()
    defined = ~np.isnan(yr)

    def split_idx(years):
        m = np.broadcast_to(year_mask(dates, years), (n, T)).ravel() & defined
        return np.flatnonzero(m)

    i_tr, i_va, i_te = split_idx(TRAIN_YEARS), split_idx(VAL_YEARS), split_idx(TEST_YEARS)
    # desbalance: todos los positivos + fracción de negativos en entrenamiento
    keep = (yr[i_tr] == 1) | (rng.random(len(i_tr)) < NEG_KEEP)
    i_fit = i_tr[keep]
    print(f"[B] train {len(i_tr):,} (fit {len(i_fit):,}, pos {int(yr[i_fit].sum()):,}) | val {len(i_va):,} | test {len(i_te):,}")

    write_training_dataset(F, y, cells, dates, n, T, defined)

    X_fit, y_fit = frame(F, i_fit), yr[i_fit].astype(int)
    X_va, y_va = frame(F, i_va), yr[i_va].astype(int)
    X_te, y_te = frame(F, i_te), yr[i_te].astype(int)

    rf = RandomForestClassifier(n_estimators=300, min_samples_leaf=50, max_features="sqrt", max_samples=0.5,
                                class_weight="balanced_subsample", n_jobs=-1, random_state=SEED)
    rf.fit(X_fit, y_fit)
    rf_cal = calibrate_prefit(rf, X_va, y_va)

    lr = make_pipeline(StandardScaler(), LogisticRegression(max_iter=2000, class_weight="balanced"))
    lr.fit(X_fit, y_fit)
    lr_cal = calibrate_prefit(lr, X_va, y_va)

    report = {"predictor_version": PREDICTOR_VERSION, "harmonizer_version": HARMONIZER_VERSION,
              "target": "Y=1 si FIRMS (MODIS o VIIRS, QA) registra >=1 detección en la celda H3 res6 el día t+1; "
                        "Y=0 solo si VIIRS operativo en t+1. No es ignición física.",
              "splits": {"train": TRAIN_YEARS, "val": VAL_YEARS, "test": TEST_YEARS},
              "negative_subsampling": NEG_KEEP, "features": FEATURES,
              "rf_params": rf.get_params(), "calibration": "isotonic sobre validación 2024",
              "models": {}}
    p_val = {"random_forest": rf_cal.predict_proba(X_va)[:, 1], "logistic_regression": lr_cal.predict_proba(X_va)[:, 1],
             "seasonal_baseline": X_va.clim_cell_month.values, "persistence": X_va.detected_t.values}
    p_te = {"random_forest": rf_cal.predict_proba(X_te)[:, 1], "logistic_regression": lr_cal.predict_proba(X_te)[:, 1],
            "seasonal_baseline": X_te.clim_cell_month.values, "persistence": X_te.detected_t.values}
    for name in p_val:
        thr = 0.5 if name == "persistence" else best_threshold(y_va, p_val[name])
        report["models"][name] = {"val": evaluate(y_va, p_val[name], thr), "test": evaluate(y_te, p_te[name], thr)}
        t = report["models"][name]["test"]
        print(f"[B] {name:20s} test PR-AUC={t['pr_auc']:.3f} F1={t['f1']:.3f} Brier={t['brier']:.4f} "
              f"P={t['precision']:.3f} R={t['recall']:.3f}")
    rf_t, sb_t = report["models"]["random_forest"]["test"], report["models"]["seasonal_baseline"]["test"]
    report["rf_beats_seasonal_baseline_on_test"] = bool(rf_t["pr_auc"] > sb_t["pr_auc"] and rf_t["brier"] < sb_t["brier"])
    imp = pd.Series(rf.feature_importances_, index=FEATURES).sort_values(ascending=False)
    report["rf_feature_importance"] = imp.round(5).to_dict()

    (METRICS / "prediction_metrics.json").write_text(json.dumps(report, indent=2, ensure_ascii=False, default=str))
    thr_rf = report["models"]["random_forest"]["val"]["threshold"]
    joblib.dump({"version": PREDICTOR_VERSION, "harmonizer_version": HARMONIZER_VERSION, "model": rf_cal,
                 "features": FEATURES, "threshold": thr_rf}, MODELS / "fire_predictor.joblib", compress=3)

    # predicciones: todo el periodo de prueba + pronóstico desde el último día disponible
    last = np.flatnonzero(np.broadcast_to(np.arange(T) == T - 1, (n, T)).ravel())
    i_out = np.concatenate([np.flatnonzero(np.broadcast_to(year_mask(dates, TEST_YEARS), (n, T)).ravel()), last])
    i_out = np.unique(i_out)
    X_out = frame(F, i_out)
    prob = np.zeros(len(i_out))
    for s in range(0, len(i_out), 500_000):
        prob[s:s + 500_000] = rf_cal.predict_proba(X_out.iloc[s:s + 500_000])[:, 1]
    t_idx = i_out % T
    pred = pd.DataFrame({
        "h3_id": pd.Categorical(cells.h3_id.values[i_out // T]),
        "issue_date": dates.values[t_idx],
        "forecast_date": dates.values[t_idx] + np.timedelta64(1, "D"),
        "probability": prob.astype(np.float32),
        "above_threshold": prob >= thr_rf,
        "seasonal_baseline_probability": X_out.clim_cell_month.values,
        "observed": yr[i_out],
        "model_version": PREDICTOR_VERSION, "harmonizer_version": HARMONIZER_VERSION,
    })
    pred.to_parquet(PROCESSED / "predictions.parquet", index=False)
    print(f"[B] predictions.parquet: {len(pred):,} filas (último pronóstico: {pred.forecast_date.max().date()})")


def write_training_dataset(F, y, cells, dates, n, T, defined):
    idx = np.flatnonzero(defined)
    df = frame(F, idx)
    df.insert(0, "h3_id", pd.Categorical(cells.h3_id.values[idx // T]))
    df.insert(1, "date", dates.values[idx % T])
    df["target_next_day"] = y.ravel()[idx].astype(np.int8)
    df.to_parquet(PROCESSED / "training_dataset.parquet", index=False)
    print(f"[B] training_dataset.parquet: {len(df):,} filas")


if __name__ == "__main__":
    main()
