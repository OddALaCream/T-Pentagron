"""Predicción experimental FireSight (Modelo B) para la API del observatorio.

Lee el artefacto que genera `python -m firesight.export_serving` en data/models/:
  predictions_2024.parquet   probabilidad calibrada t+1 de cada celda H3 res 6 de la zona piloto, cada día
  explanations_2024.parquet  explicación local exacta del Random Forest para las celdas relevantes
  model_card.json            versión, métricas, umbral y cobertura
No necesita sklearn ni los modelos entrenados. Si el artefacto falta, la API responde 'unavailable'.
"""
from datetime import timedelta
from functools import lru_cache
from pathlib import Path
import json

import h3
import numpy as np
import polars as pl
from shapely import intersects
from shapely.geometry import Polygon

from backend.geography import BOLIVIA

SERVING = Path(__file__).resolve().parents[1] / 'data/models'
TOP_FEATURES = 10
REGION_SAMPLE = 30   # celdas de mayor probabilidad usadas para explicar una región o celda agregada

FEATURE_INFO = {   # las 23 variables del Modelo B (firesight/predict.py FEATURES)
    'act_t': ('Actividad del día t', 'det. eq.', 'Actividad VIIRS-equivalente (Modelo A) el día de emisión.'),
    'act_3d': ('Actividad 3 días', 'det. eq.', 'Suma de actividad VIIRS-equivalente en t-2..t.'),
    'recent_activity_7d': ('Actividad previa 7 días', 'det. eq.', 'Suma de actividad VIIRS-equivalente (Modelo A) en t-6..t.'),
    'recent_activity_30d': ('Actividad previa 30 días', 'det. eq.', 'Suma de actividad VIIRS-equivalente en t-29..t.'),
    'detected_t': ('Detección el día t', '0/1', '1 si MODIS o VIIRS registraron un foco en la celda el día t.'),
    'days_since_det': ('Días desde la última detección', 'días', 'Días desde el último foco en la celda (tope 365).'),
    'frp_7d': ('Potencia radiativa (FRP) 7 días', 'MW', 'Suma de FRP MODIS + VIIRS en t-6..t.'),
    'nbr_act_t': ('Vecinos H3 (anillo 1) día t', 'det. eq.', 'Actividad de las 6 celdas adyacentes el día t.'),
    'nbr_act_7d': ('Vecinos H3 (anillo 1) 7 días', 'det. eq.', 'Actividad de las celdas adyacentes en t-6..t.'),
    'month': ('Mes', '1–12', 'Mes del día de emisión.'),
    'doy_sin': ('Estacionalidad (seno)', '−1..1', 'Seno del día del año.'),
    'doy_cos': ('Estacionalidad (coseno)', '−1..1', 'Coseno del día del año.'),
    'lat': ('Latitud de la celda', '°', 'Centro de la celda H3.'),
    'lon': ('Longitud de la celda', '°', 'Centro de la celda H3.'),
    'rain_7d': ('Lluvia acumulada 7 días', 'mm', 'NASA POWER PRECTOTCORR (grilla ~0,5°, más gruesa que H3 res 6).'),
    'rain_30d': ('Lluvia acumulada 30 días', 'mm', 'NASA POWER PRECTOTCORR.'),
    'days_since_rain': ('Días sin lluvia (>1 mm)', 'días', 'NASA POWER PRECTOTCORR.'),
    'temp_7d': ('Temperatura máxima media 7 días', '°C', 'NASA POWER T2M_MAX.'),
    'rh_7d': ('Humedad relativa media 7 días', '%', 'NASA POWER RH2M.'),
    'wind_7d': ('Viento medio 7 días', 'm/s', 'NASA POWER WS2M.'),
    'cloud_t': ('Nubosidad del día t', '%', 'NASA POWER CLOUD_AMT.'),
    'clim_cell_month': ('Frecuencia histórica celda-mes', '0–1', 'Fracción de días con foco al día siguiente en ese mes, 2018-2023.'),
    'clim_cell': ('Frecuencia histórica de la celda', '0–1', 'Fracción de días con foco al día siguiente, 2018-2023.'),
}
UNAVAILABLE = 'No se encontró el artefacto data/models/ (ejecutar firesight/run_models.sh)'


def _round(v, nd=4):
    v = float(v)
    return None if not np.isfinite(v) else round(v, nd)


class Store:
    """Probabilidades en una matriz celdas × días y explicaciones indexadas por (celda, día)."""

    def __init__(self, folder: Path):
        self.card = json.loads((folder / 'model_card.json').read_text(encoding='utf-8'))
        year = self.card['year']
        pred = pl.read_parquet(folder / f'predictions_{year}.parquet')
        self.cells = np.array(sorted(pred['h3_id'].unique().to_list()))
        self.dates = np.array(sorted(pred['issue_date'].unique().to_list()))
        self.cell_pos = {c: i for i, c in enumerate(self.cells)}
        self.date_pos = {d: i for i, d in enumerate(self.dates)}
        ci = pred['h3_id'].replace_strict(self.cell_pos, return_dtype=pl.Int64).to_numpy()
        di = pred['issue_date'].replace_strict(self.date_pos, return_dtype=pl.Int64).to_numpy()
        prob = np.full((len(self.cells), len(self.dates)), np.nan, dtype=np.float32)
        prob[ci, di] = pred['probability'].to_numpy()
        # El recuadro de entrenamiento cruza a Brasil, donde los archivos FIRMS de Bolivia no tienen detecciones:
        # solo se sirven las celdas que tocan el polígono de Bolivia.
        keep = intersects(BOLIVIA, [Polygon([(lng, lat) for lat, lng in h3.cell_to_boundary(c)]) for c in self.cells])
        self.dropped_outside = int((~keep).sum())
        self.cells, self.prob = self.cells[keep], prob[keep]
        self.cell_pos = {c: i for i, c in enumerate(self.cells)}
        ex = pl.read_parquet(folder / f'explanations_{year}.parquet')
        self.features = [k for k in self.card['feature_order'] if k in FEATURE_INFO]
        self.values = ex.select([f'v_{k}' for k in self.features]).to_numpy()
        self.contrib = ex.select([f'c_{k}' for k in self.features]).to_numpy()
        self.bias = ex['forest_bias'].to_numpy()
        self.raw = ex['forest_raw'].to_numpy()
        self.ex_row = {(c, d): i for i, (c, d) in enumerate(zip(ex['h3_id'].to_list(), ex['issue_date'].to_list()))}
        self.parents = {r: np.array([h3.cell_to_parent(c, r) for c in self.cells]) for r in range(0, 6)}
        self.version = self.card['model_version']
        self.split = self.card['evaluation_split']

    def cells_for(self, h3_id=None):
        """Índices de celdas del modelo bajo un objetivo: celda res 6, celda padre (res 0-5) o toda la región."""
        if h3_id is None:
            return np.arange(len(self.cells))
        res = h3.get_resolution(h3_id)
        if res == 6:
            return np.array([self.cell_pos[h3_id]]) if h3_id in self.cell_pos else np.array([], dtype=int)
        return np.flatnonzero(self.parents[res] == h3_id)

    def explain(self, cells, day):
        rows = [self.ex_row[(self.cells[c], self.dates[day])] for c in cells if (self.cells[c], self.dates[day]) in self.ex_row]
        if not rows:
            return [], {}
        c = self.contrib[rows].mean(0)
        v = self.values[rows].mean(0)
        out = []
        for j in np.argsort(-np.abs(c))[:TOP_FEATURES]:
            key = self.features[j]
            label, unit, desc = FEATURE_INFO[key]
            out.append({'key': key, 'label': label, 'unit': unit, 'description': desc,
                        'value': _round(v[j], 3), 'contribution': _round(c[j])})
        return out, {'forest_bias': _round(self.bias[rows].mean()), 'forest_probability_raw': _round(self.raw[rows].mean()),
                     'explained_cells': len(rows)}


@lru_cache(maxsize=1)
def store():
    return Store(SERVING) if (SERVING / 'model_card.json').exists() else None


def coverage():
    s = store()
    if s is None:
        return None
    r = s.card['region']
    return {'name': r['name'], 'h3_resolution': r['h3_resolution'], 'cell_count': int(len(s.cells)), 'bbox': r['bbox'],
            'dates': {'start': s.dates[0].isoformat(), 'end': s.dates[-1].isoformat()},
            'cells_outside_bolivia_dropped': s.dropped_outside,
            'note': 'El modelo cubre solo la zona piloto; fuera de ella no hay predicción.'}


def predictions(day):
    s = store()
    if s is None:
        return {'status': 'unavailable', 'reason': UNAVAILABLE, 'predictions': []}
    if day not in s.date_pos:
        return {'status': 'experimental', 'coverage': coverage(), 'predictions': []}
    di = s.date_pos[day]
    issued, forecast = day.isoformat(), (day + timedelta(days=1)).isoformat()
    p = s.prob[:, di]
    thr = s.card['threshold_f1']
    return {'status': 'experimental', 'coverage': coverage(), 'predictions': [
        {'h3_id': c, 'issued_for_date': issued, 'forecast_date': forecast, 'probability': _round(p[i]),
         'above_threshold': bool(p[i] >= thr), 'model_version': s.version, 'evaluation_split': s.split, 'region_id': 'bolivia'}
        for i, c in enumerate(s.cells) if np.isfinite(p[i])]}


def detail(day, h3_id=None):
    """None si el objetivo está fuera de la zona del modelo o de las fechas exportadas."""
    s = store()
    if s is None:
        return {'status': 'unavailable', 'reason': UNAVAILABLE, 'probability': None,
                'model_version': 'No disponible', 'features': []}
    cells = s.cells_for(h3_id)
    if day not in s.date_pos or not len(cells):
        return None
    di = s.date_pos[day]
    p = s.prob[cells, di]
    single = h3_id is not None and h3.get_resolution(h3_id) == 6
    sample = cells if single else cells[np.argsort(-p)[:REGION_SAMPLE]]
    features, decomp = s.explain(sample, di)
    base = {'status': 'experimental', 'issued_for_date': day.isoformat(),
            'forecast_date': (day + timedelta(days=1)).isoformat(),
            'model_version': s.version, 'harmonizer_version': s.card['harmonizer_version'],
            'evaluation_split': s.split, 'features': features, **decomp,
            'contribution_meaning': ('Aporte local de cada variable a la probabilidad del bosque (antes de la calibración '
                                     'isotónica) para ' + ('esta celda y fecha.' if single else
                                     f'las {REGION_SAMPLE} celdas de mayor probabilidad (media).'))}
    if not features:
        base['note'] = (f"Explicación por variable solo para celdas con probabilidad ≥ "
                        f"{s.card['explanations']['min_probability']:.0%} o entre las {REGION_SAMPLE} más altas del día.")
    if single:
        return {**base, 'probability': _round(p[0])}
    order = np.argsort(-p)[:6]
    return {**base, 'probability': _round(p.max()), 'mean_probability': _round(p.mean()),
            'cell_count': int(len(cells)),
            'distribution': np.bincount(np.minimum((p * 10).astype(int), 9), minlength=10).tolist(),
            'top_cells': [{'h3': str(s.cells[cells[j]]), 'probability': _round(p[j])} for j in order]}


def model_info():
    s = store()
    if s is None:
        return {'status': 'unavailable', 'model_version': 'No disponible', 'algorithm': 'Sin modelo entrenado',
                'metrics': {}, 'baseline_metrics': {}, 'features': [], 'notes': [UNAVAILABLE]}
    pm = s.card['prediction_metrics']['models']
    t, sb, pe = pm['random_forest']['test'], pm['seasonal_baseline']['test'], pm['persistence']['test']
    v = pm['random_forest']['val']
    pick = lambda m: {k: _round(m[k]) for k in ('precision', 'recall', 'f1', 'pr_auc', 'brier')}  # noqa: E731
    cov = coverage()
    notes = [f"Cobertura: {cov['name']} ({cov['cell_count']:,} celdas H3 res 6), fechas de emisión "
             f"{cov['dates']['start']} a {cov['dates']['end']}. Fuera de esa zona no hay predicción.",
             f"Prueba 2025: RF PR-AUC {t['pr_auc']:.3f} vs baseline estacional {sb['pr_auc']:.3f} y persistencia {pe['pr_auc']:.3f}.",
             f"En F1 el RF ({t['f1']:.3f}) es similar a la persistencia ({pe['f1']:.3f}); su ventaja está en el ranking y la calibración.",
             f"Las fechas servidas son de 2024, el año de validación: el bosque no lo vio, pero la calibración isotónica y "
             f"el umbral F1 se eligieron con él (PR-AUC 2024 {v['pr_auc']:.3f}). La prueba honesta es 2025."]
    for k, ext in sorted(s.card.get('external_validation', {}).items()):
        rf = ext['models']['random_forest']
        notes.append(f"Validación externa {k} (sin reentrenar): RF PR-AUC {rf['pr_auc']:.3f}, F1 {rf['f1']:.3f}.")
    notes += ['Aportes por variable: descomposición exacta del bosque por árbol (antes de calibrar), por celda y fecha.',
              'Las variables usan el registro armonizado del Modelo A (MODIS → VIIRS-equivalente), no el índice exploratorio del globo.',
              'Predice detección satelital registrada al día siguiente, no ignición física. No es una alerta operativa.']
    return {'model_version': s.version, 'status': 'experimental',
            'algorithm': 'Random Forest (300 árboles) + calibración isotónica; features del registro armonizado (Modelo A) y NASA POWER',
            'target': 'Y = 1 si FIRMS (MODIS o VIIRS) registra ≥1 detección en la celda H3 res 6 el día t+1',
            'training_period': '2018 – 2023', 'validation_period': '2024', 'test_period': '2025 (+ externo 2013–2017 y 2026)',
            'metrics': pick(t), 'baseline_metrics': pick(sb), 'threshold_f1': _round(s.card['threshold_f1']),
            'coverage': cov,
            'features': [{'key': k, 'label': v[0], 'description': v[2]} for k, v in FEATURE_INFO.items()],
            'notes': notes}
