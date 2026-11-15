"""Pruebas de integridad sobre las salidas reales del pipeline (requiere haber corrido firesight/run_models.sh).

Ejecutar:  firesight/.venv/bin/python -m firesight.tests.test_integrity
"""
import json

import joblib
import numpy as np
import pandas as pd

from firesight import harmonize as HA
from firesight.common import load_cube
from firesight.config import METRICS, MODELS, PROCESSED, TEST_YEARS, TRAIN_YEARS, VAL_YEARS

rng = np.random.default_rng(0)


def test_labels_match_raw_detections():
    """La etiqueta t+1 se recalcula desde detections_indexed (camino independiente al cubo)."""
    det = pd.read_parquet(PROCESSED / "detections_indexed.parquet", columns=["h3_id", "date_utc"])
    det_set = set(zip(det.h3_id, det.date_utc.dt.normalize()))
    td = pd.read_parquet(PROCESSED / "training_dataset.parquet", columns=["h3_id", "date", "target_next_day"])
    pos = td[td.target_next_day == 1].sample(5000, random_state=0)
    neg = td[td.target_next_day == 0].sample(20000, random_state=0)
    nxt = lambda d: pd.Timestamp(d) + pd.Timedelta(days=1)  # noqa: E731
    assert all((h, nxt(d)) in det_set for h, d in zip(pos.h3_id.astype(str), pos.date))
    assert not any((h, nxt(d)) in det_set for h, d in zip(neg.h3_id.astype(str), neg.date))


def test_harmonized_daily_consistency():
    h = pd.read_parquet(PROCESSED / "harmonized_daily.parquet",
                        columns=["viirs_count", "modis_viirs_eq", "activity_index", "availability_flag", "modis_count"])
    v = h.viirs_count.notna()
    assert np.allclose(h.activity_index[v], h.viirs_count[v])
    mo = h.availability_flag == "modis_only"
    assert np.allclose(h.activity_index[mo], h.modis_viirs_eq[mo])
    assert (h.modis_viirs_eq.dropna() >= 0).all() and (h.activity_index.dropna() >= 0).all()
    assert h.activity_index[h.availability_flag != "none"].notna().all()


def test_harmonizer_monotonic_in_modis_count():
    """Más detecciones MODIS (todo lo demás igual) => más actividad VIIRS-equivalente, en promedio y casi siempre."""
    cube, cells = load_cube()
    H = joblib.load(MODELS / "harmonizer.joblib")
    F = HA.build_features(cube, cells)
    idx = rng.choice(np.flatnonzero(cube["modis_count"].ravel() > 0), 20000, replace=False)
    X = pd.DataFrame({k: F[k].ravel()[idx] for k in HA.FEATURES})
    X2 = X.copy()
    X2["m_count"] += 2
    p1, p2 = H["lgbm"].predict(X), H["lgbm"].predict(X2)
    assert p2.mean() > p1.mean()
    frac = float((p2 >= p1 - 1e-9).mean())
    print(f"   monotonía individual: {frac:.1%} de filas")
    assert frac > 0.9


def test_predictions_valid():
    p = pd.read_parquet(PROCESSED / "predictions.parquet")
    assert p.probability.between(0, 1).all() and p.probability.notna().all()
    assert (p.forecast_date - p.issue_date == pd.Timedelta(days=1)).all()
    last = p.forecast_date == p.forecast_date.max()
    assert p.observed[~last].notna().all() and p.observed[last].isna().all()
    assert set(p.model_version) == {"pred-1.0.0"} and set(p.harmonizer_version) == {"harm-1.0.0"}


def test_splits_disjoint_and_ordered():
    assert max(TRAIN_YEARS) < min(VAL_YEARS) and max(VAL_YEARS) < min(TEST_YEARS)
    m = json.loads((METRICS / "prediction_metrics.json").read_text())
    for name, v in m["models"].items():
        assert 0 <= v["test"]["pr_auc"] <= 1 and v["test"]["n"] > 0, name


def test_training_dataset_no_missing():
    td = pd.read_parquet(PROCESSED / "training_dataset.parquet")
    assert td.drop(columns=["h3_id", "date"]).isna().sum().sum() == 0
    assert td.target_next_day.isin([0, 1]).all()


def test_models_load_and_versions():
    H = joblib.load(MODELS / "harmonizer.joblib")
    P = joblib.load(MODELS / "fire_predictor.joblib")
    assert H["version"] == P["harmonizer_version"]
    assert 0 < P["threshold"] < 1 and len(P["features"]) == P["model"].n_features_in_


if __name__ == "__main__":
    fails = 0
    for name, fn in list(globals().items()):
        if name.startswith("test_") and callable(fn):
            try:
                fn()
                print(f"OK    {name}")
            except Exception as e:  # noqa: BLE001
                fails += 1
                print(f"FALLA {name}: {type(e).__name__} {e}")
    raise SystemExit(fails)
