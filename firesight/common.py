"""Utilidades compartidas: carga del cubo, sumas móviles sin fuga y vecinos H3."""
import numpy as np
import pandas as pd

from .config import PROCESSED


def load_cube(processed=PROCESSED):
    z = np.load(processed / "cube.npz", allow_pickle=False)
    cube = {k: z[k] for k in z.files}
    cube["dates"] = pd.to_datetime(cube["dates"])
    cells = pd.read_parquet(processed / "cells.parquet")
    return cube, cells


def past_sum(a, w, include_today=False):
    """Suma de a en la ventana [t-w, t-1] (o [t-w+1, t] si include_today). Solo pasado: sin fuga."""
    a = np.nan_to_num(a.astype(np.float64))
    cs = np.concatenate([np.zeros((a.shape[0], 1)), np.cumsum(a, axis=1)], axis=1)
    t = np.arange(a.shape[1])
    hi = t + 1 if include_today else t
    lo = np.maximum(hi - w, 0)
    return (cs[:, hi] - cs[:, lo]).astype(np.float32)


def nbr_sum(a, nbr):
    """Suma sobre los vecinos H3 (índices -1 = fuera de la AOI)."""
    pad = np.vstack([a, np.zeros((1, a.shape[1]), dtype=a.dtype)])
    return pad[nbr].sum(axis=1)


def days_since(mask, cap=365):
    """Días desde el último True (incluyendo hoy => 0). cap si nunca."""
    n, T = mask.shape
    out = np.empty((n, T), dtype=np.float32)
    last = np.full(n, -10**9)
    for t in range(T):
        last = np.where(mask[:, t], t, last)
        out[:, t] = np.minimum(t - last, cap)
    return out


def year_mask(dates, years):
    return np.isin(dates.year, years)


def calendar(dates):
    doy = dates.dayofyear.to_numpy()
    return {"month": dates.month.to_numpy(),
            "doy_sin": np.sin(2 * np.pi * doy / 365.25).astype(np.float32),
            "doy_cos": np.cos(2 * np.pi * doy / 365.25).astype(np.float32)}


def calibrate_prefit(est, X, y, method="isotonic"):
    """Calibra un clasificador YA entrenado con (X, y) sin reentrenarlo.
    sklearn < 1.6 usa cv="prefit"; desde 1.6 se envuelve en FrozenEstimator (cv="prefit" se eliminó en 1.8)."""
    from sklearn.calibration import CalibratedClassifierCV
    try:
        from sklearn.frozen import FrozenEstimator
    except ImportError:
        return CalibratedClassifierCV(est, method=method, cv="prefit").fit(X, y)
    return CalibratedClassifierCV(FrozenEstimator(est), method=method).fit(X, y)


def base_estimator(cal):
    """Modelo original (p. ej. el Random Forest) dentro de un CalibratedClassifierCV de calibrate_prefit."""
    est = cal.calibrated_classifiers_[0].estimator
    return est.estimator if type(est).__name__ == "FrozenEstimator" else est
