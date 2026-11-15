"""Modelo A — Armonización híbrida MODIS -> escala VIIRS (baseline estadístico + LightGBM).

Magnitud de referencia (definida antes de entrenar): conteo diario de detecciones VIIRS S-NPP
por celda H3 res 6 ("VIIRS-equivalente"). No se mezcla con FRP.

Pares válidos: celda-día en que AMBOS sensores estaban operativos. Se distinguen faltantes
(sensor no operativo -> NaN) de ceros observados. Los pares 0/0 se submuestrean con peso
inverso para mantener la esperanza insesgada.

  baseline:  V^ = k_mes * M            si M > 0
             V^ = c_mes                si M = 0   (media de V cuando MODIS no detecta)
  LightGBM:  objetivo Poisson o Tweedie (elegido en validación), features de MODIS en t y
             pasado, vecinos H3, calendario, nubosidad y posición.
  híbrido:   V^ = w * LGBM + (1 - w) * baseline, w elegido en 2024 (validación), sin asumir 50/50.
Celdas con pocos pares en entrenamiento -> solo baseline + incertidumbre alta.
Regla del plan: si el híbrido no mejora al baseline en años no vistos, se conserva solo el baseline.
"""
import json

import joblib
import lightgbm as lgb
import numpy as np
import pandas as pd

from .baselines import SeasonalRatioBaseline  # noqa: F401  (módulo propio: el pickle debe ser importable)
from .common import calendar, load_cube, nbr_sum, past_sum, year_mask
from .config import (HARMONIZER_VERSION, METRICS, MODELS, PROCESSED, SEED, TEST_YEARS,
                     TRAIN_YEARS, VAL_YEARS)

ZERO_KEEP = 0.03
MIN_SUPPORT = 5
FEATURES = ["m_count", "m_frp_sum", "m_frp_max", "m_conf_mean", "m_night_frac", "m_nbr1",
            "m_prev1", "m_past7", "m_past30", "m_nbr1_past7", "doy_sin", "doy_cos", "month",
            "lat", "lon", "cloud"]


def build_features(cube, cells):
    m = cube["modis_count"]
    n, T = m.shape
    cal = calendar(cube["dates"])
    with np.errstate(invalid="ignore", divide="ignore"):
        conf_mean = np.where(m > 0, cube["modis_conf_sum"] / m, 0)
        night = np.where(m > 0, cube["modis_night"] / m, 0)
    nb = nbr_sum(m, cube["nbr1"])
    F = {
        "m_count": m, "m_frp_sum": cube["modis_frp_sum"], "m_frp_max": cube["modis_frp_max"],
        "m_conf_mean": conf_mean, "m_night_frac": night, "m_nbr1": nb,
        "m_prev1": past_sum(m, 1), "m_past7": past_sum(m, 7), "m_past30": past_sum(m, 30),
        "m_nbr1_past7": past_sum(nb, 7),
        "doy_sin": np.broadcast_to(cal["doy_sin"], (n, T)), "doy_cos": np.broadcast_to(cal["doy_cos"], (n, T)),
        "month": np.broadcast_to(cal["month"], (n, T)),
        "lat": np.broadcast_to(cells.lat.to_numpy()[:, None], (n, T)),
        "lon": np.broadcast_to(cells.lon.to_numpy()[:, None], (n, T)),
        "cloud": cube["clim_cloud_amt"],
    }
    return {k: np.asarray(v, dtype=np.float32) for k, v in F.items()}


def to_frame(F, idx):
    return pd.DataFrame({k: F[k].ravel()[idx] for k in FEATURES})


def poisson_dev(y, mu, w):
    mu = np.clip(mu, 1e-6, None)
    d = 2 * (np.where(y > 0, y * np.log(np.where(y > 0, y, 1) / mu), 0) - (y - mu))
    return float(np.average(d, weights=w))


def scores(y, p, w):
    return {"mae": float(np.average(np.abs(y - p), weights=w)),
            "rmse": float(np.sqrt(np.average((y - p) ** 2, weights=w))),
            "poisson_deviance": poisson_dev(y, p, w),
            "bias": float(np.average(p - y, weights=w)),
            "relative_bias_total": float((w * p).sum() / max((w * y).sum(), 1e-9) - 1)}


def sample_pairs(cube, years, rng):
    M, V = cube["modis_count"], cube["viirs_count"]
    both = cube["modis_avail"] & cube["viirs_avail"] & year_mask(cube["dates"], years)
    valid = np.broadcast_to(both, M.shape)
    active = (M > 0) | (V > 0)
    keep = valid & (active | (rng.random(M.shape) < ZERO_KEEP))
    idx = np.flatnonzero(keep.ravel())
    w = np.where(active.ravel()[idx], 1.0, 1.0 / ZERO_KEEP)
    return idx, w


def main():
    rng = np.random.default_rng(SEED)
    cube, cells = load_cube()
    F = build_features(cube, cells)
    V_all = cube["viirs_count"]
    n, T = V_all.shape

    sets = {}
    for name, yrs in [("train", TRAIN_YEARS), ("val", VAL_YEARS), ("test", TEST_YEARS)]:
        idx, w = sample_pairs(cube, yrs, rng)
        X = to_frame(F, idx)
        sets[name] = (idx, X, V_all.ravel()[idx].astype(float), w)
        print(f"[A] {name}: {len(idx):,} pares (activos {int((w == 1).sum()):,})")

    idx_tr, X_tr, y_tr, w_tr = sets["train"]
    idx_va, X_va, y_va, w_va = sets["val"]

    # soporte por celda (pares activos en entrenamiento)
    cell_of = idx_tr // T
    support = np.bincount(cell_of[w_tr == 1], minlength=n)

    base = SeasonalRatioBaseline().fit(X_tr.m_count.values, y_tr, X_tr.month.values, w_tr)

    # LightGBM: comparar objetivos Poisson y Tweedie en validación
    cands = {}
    for obj, extra in [("poisson", {}), ("tweedie", {"tweedie_variance_power": 1.3})]:
        params = dict(objective=obj, learning_rate=0.05, num_leaves=63, min_child_samples=50,
                      feature_fraction=0.9, bagging_fraction=0.8, bagging_freq=1, lambda_l2=1.0,
                      verbose=-1, seed=SEED, **extra)
        dtr = lgb.Dataset(X_tr, y_tr, weight=w_tr, categorical_feature=["month"])
        dva = lgb.Dataset(X_va, y_va, weight=w_va, reference=dtr)
        mdl = lgb.train(params, dtr, 2000, valid_sets=[dva],
                        callbacks=[lgb.early_stopping(100, verbose=False)])
        dev = poisson_dev(y_va, mdl.predict(X_va, num_iteration=mdl.best_iteration), w_va)
        cands[obj] = (mdl, dev, params)
        print(f"[A] LightGBM {obj}: dev val={dev:.4f} iters={mdl.best_iteration}")
    best_obj = min(cands, key=lambda k: cands[k][1])
    lgbm, _, lgb_params = cands[best_obj]

    def predict_parts(X, idx):
        pb = base.predict(X.m_count.values, X.month.values)
        pl = lgbm.predict(X, num_iteration=lgbm.best_iteration)
        low = support[idx // T] < MIN_SUPPORT
        return pb, pl, low

    # peso del híbrido: SOLO validación
    # y si conviene forzar baseline en celdas con poco soporte (decisión empírica, no supuesta)
    pb, pl, low_va = predict_parts(X_va, idx_va)
    grid = np.round(np.arange(0, 1.0001, 0.05), 2)
    search = {}
    for fb in (True, False):
        lw = low_va if fb else np.zeros_like(low_va)
        search[fb] = [poisson_dev(y_va, np.where(lw, pb, wgt * pl + (1 - wgt) * pb), w_va) for wgt in grid]
    fallback = min(search, key=lambda k: min(search[k]))
    devs = search[fallback]
    w_star = float(grid[int(np.argmin(devs))])
    print(f"[A] peso híbrido w={w_star}, fallback baseline en celdas sin soporte={fallback} (dev val {min(devs):.4f})")

    # evaluación por periodo
    report = {"harmonizer_version": HARMONIZER_VERSION, "reference_quantity": "VIIRS S-NPP daily detection count per H3 res6",
              "lgbm_objective": best_obj, "lgbm_best_iteration": lgbm.best_iteration, "lgbm_params": lgb_params,
              "hybrid_weight_lgbm": w_star, "weight_grid_val_deviance": dict(zip(map(str, grid), devs)),
              "low_support_fallback_to_baseline": bool(fallback),
              "weight_grid_val_deviance_other_fallback": dict(zip(map(str, grid), search[not fallback])),
              "min_support_pairs": MIN_SUPPORT, "cells_low_support": int((support < MIN_SUPPORT).sum()),
              "zero_pair_sampling": ZERO_KEEP, "splits": {"train": TRAIN_YEARS, "val": VAL_YEARS, "test": TEST_YEARS},
              "periods": {}}
    rows_metric = []
    for name in ("train", "val", "test"):
        idx, X, y, w = sets[name]
        pb, pl, low = predict_parts(X, idx)
        low = low & fallback
        ph = np.where(low, pb, w_star * pl + (1 - w_star) * pb)
        res = {"raw_modis": scores(y, X.m_count.values, w), "baseline": scores(y, pb, w),
               "lgbm": scores(y, pl, w), "hybrid": scores(y, ph, w)}
        # sesgo por mes y por zona (H3 res 3)
        dfm = pd.DataFrame({"y": y * w, "b": pb * w, "h": ph * w, "month": X.month.values,
                            "zone": cells.zone_h3_res3.values[idx // T]})
        res["bias_by_month"] = {int(k): {"baseline": float(g.b.sum() / max(g.y.sum(), 1e-9) - 1),
                                         "hybrid": float(g.h.sum() / max(g.y.sum(), 1e-9) - 1)}
                                for k, g in dfm.groupby("month")}
        res["bias_by_zone"] = {k: {"baseline": float(g.b.sum() / max(g.y.sum(), 1e-9) - 1),
                                   "hybrid": float(g.h.sum() / max(g.y.sum(), 1e-9) - 1)}
                               for k, g in dfm.groupby("zone")}
        # serie diaria agregada de la AOI (estabilidad temporal)
        day = idx % T
        agg = pd.DataFrame({"d": day, "y": y * w, "h": ph * w, "m": X.m_count.values * w}).groupby("d").sum()
        res["aoi_daily_corr"] = {"raw_modis": float(agg.y.corr(agg.m)), "hybrid": float(agg.y.corr(agg.h))}
        report["periods"][name] = res
        rows_metric.append({"validation_period": name, "baseline_error": res["baseline"]["poisson_deviance"],
                            "lgbm_error": res["lgbm"]["poisson_deviance"], "hybrid_error": res["hybrid"]["poisson_deviance"],
                            "weight": w_star, "method_version": HARMONIZER_VERSION})
        print(f"[A] {name}: dev raw={res['raw_modis']['poisson_deviance']:.4f} base={res['baseline']['poisson_deviance']:.4f} "
              f"lgbm={res['lgbm']['poisson_deviance']:.4f} hyb={res['hybrid']['poisson_deviance']:.4f}")

    # regla del plan: si en años no vistos el híbrido no mejora al baseline -> solo baseline
    unseen_ok = all(report["periods"][p]["hybrid"]["poisson_deviance"] < report["periods"][p]["baseline"]["poisson_deviance"]
                    for p in ("val", "test"))
    final_w = w_star if (unseen_ok and w_star > 0) else 0.0
    report["final_method"] = "hybrid" if final_w > 0 else "baseline"
    report["final_weight_lgbm"] = final_w
    report["note"] = ("w elegido solo en validación 2024; test 2025 solo se reporta. La regla 'conservar solo "
                      "baseline si LightGBM no mejora en años no vistos' se aplica sobre val y test.")
    print(f"[A] método final: {report['final_method']} (w={final_w})")

    harmonizer = {"version": HARMONIZER_VERSION, "baseline": base, "lgbm": lgbm, "weight": final_w,
                  "features": FEATURES, "support": support, "min_support": MIN_SUPPORT, "fallback": bool(fallback),
                  "cells": cells.h3_id.tolist()}
    joblib.dump(harmonizer, MODELS / "harmonizer.joblib")
    (METRICS / "harmonization_metrics.json").write_text(json.dumps(report, indent=2, ensure_ascii=False))
    pd.DataFrame(rows_metric).to_csv(METRICS / "harmonization_metrics.csv", index=False)
    lgbm.save_model(str(MODELS / "harmonizer_lgbm.txt"))
    imp = pd.Series(lgbm.feature_importance("gain"), index=FEATURES).sort_values(ascending=False)
    imp.to_csv(METRICS / "harmonizer_feature_importance.csv", header=["gain"])

    # ---------------------------------------------------------- registro diario armonizado
    write_harmonized_daily(cube, cells, F, harmonizer)


def apply_harmonizer(F, H, n, T):
    """Devuelve (modis_viirs_eq, incertidumbre, método) en forma (n, T)."""
    X = pd.DataFrame({k: F[k].ravel() for k in FEATURES})
    pb = H["baseline"].predict(X.m_count.values, X.month.values)
    low_support = np.repeat(H["support"] < H["min_support"], T)
    low = low_support & H["fallback"]
    if H["weight"] > 0:
        pl = np.zeros(len(X))
        chunk = 2_000_000
        for s in range(0, len(X), chunk):
            pl[s:s + chunk] = H["lgbm"].predict(X.iloc[s:s + chunk], num_iteration=H["lgbm"].best_iteration)
        ph = np.where(low, pb, H["weight"] * pl + (1 - H["weight"]) * pb)
        disagree = np.abs(pl - pb)
    else:
        ph, disagree = pb, np.zeros(len(X))
    # incertidumbre heurística: ruido Poisson + desacuerdo baseline/LGBM, inflada sin soporte
    unc = np.sqrt(np.clip(ph, 0, None)) + disagree
    unc = np.where(low_support, unc * 2, unc)
    method = np.where(low, "baseline_low_support",
                      np.where(low_support, "hybrid_low_support", "hybrid" if H["weight"] > 0 else "baseline"))
    return ph.reshape(n, T).astype(np.float32), unc.reshape(n, T).astype(np.float32), method.reshape(n, T)


def write_harmonized_daily(cube, cells, F, H):
    M, V = cube["modis_count"], cube["viirs_count"]
    n, T = M.shape
    eq, unc, method = apply_harmonizer(F, H, n, T)
    ma = np.broadcast_to(cube["modis_avail"], (n, T))
    va = np.broadcast_to(cube["viirs_avail"], (n, T))
    # activity_index en escala VIIRS: VIIRS observado si disponible; si no, MODIS armonizado
    act = np.where(va, V, np.where(ma, eq, np.nan)).astype(np.float32)
    avail = np.select([ma & va, ma, va], ["both", "modis_only", "viirs_only"], "none")
    meth = np.where(va, "viirs_observed", np.where(ma, method, "missing"))
    df = pd.DataFrame({
        "h3_id": pd.Categorical(np.repeat(cells.h3_id.values, T)),
        "date": np.tile(cube["dates"].values, n),
        "modis_count": np.where(ma, M, np.nan).ravel().astype(np.float32),
        "viirs_count": np.where(va, V, np.nan).ravel().astype(np.float32),
        "modis_detected": pd.array(np.where(ma, M > 0, False).ravel(), dtype="boolean"),
        "viirs_detected": pd.array(np.where(va, V > 0, False).ravel(), dtype="boolean"),
        "modis_viirs_eq": np.where(ma, eq, np.nan).ravel(),
        "activity_index": act.ravel(),
        "uncertainty": np.where(va, 0, unc).ravel().astype(np.float32),
        "availability_flag": pd.Categorical(avail.ravel()),
        "harmonization_method": pd.Categorical(meth.ravel()),
        "harmonizer_version": H["version"],
    })
    df.loc[~ma.ravel(), "modis_detected"] = pd.NA
    df.loc[~va.ravel(), "viirs_detected"] = pd.NA
    df.to_parquet(PROCESSED / "harmonized_daily.parquet", index=False)
    np.savez_compressed(PROCESSED / "harmonized_cube.npz", activity_index=act, modis_viirs_eq=eq, uncertainty=unc)
    print(f"[A] harmonized_daily.parquet: {len(df):,} filas")


if __name__ == "__main__":
    main()
