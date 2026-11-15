"""Armonización FireSight (Modelo A: MODIS -> VIIRS S-NPP) para la API del observatorio.

Lee el artefacto que genera `python -m firesight.export_harmonization` en data/models/ (solo local):
  harmonization_<año>.parquet     por celda y día (2024, 2025): MODIS crudo, S-NPP observado, MODIS armonizado
  harmonization_monthly.parquet   por celda y mes, 2001-2025
  harmonization_card.json         versión, periodos, métricas y avisos
No necesita lightgbm. Si el artefacto falta, la API responde 'unavailable'.

Dos usos:
  series()       discrepancia diaria: lo que el Modelo A dice que vería S-NPP según MODIS, frente a lo que vio
  long_series()  serie 2001-2025 en escala S-NPP: antes de 2012 (sin VIIRS) solo existe gracias al Modelo A
"""
from functools import lru_cache
import threading
import json

import h3
import numpy as np
import polars as pl

from backend.geography import cells_touching_bolivia
from backend.predictions import SERVING

UNAVAILABLE = 'No se encontró el artefacto de armonización en data/models/ (python -m firesight.export_harmonization)'


def _r(v, nd=3):
    v = float(v)
    return None if not np.isfinite(v) else round(v, nd)


def _sum(a, axis=0):
    """Suma ignorando nulos; nulo si todos lo son (sensor no operativo, no es cero)."""
    out = np.nansum(a, axis=axis)
    return np.where(np.isfinite(a).any(axis=axis), out, np.nan)


def _matrix(df, cells, pos, col, key, keys):
    """Pivot (celda, clave) -> matriz celdas x claves, NaN donde no hay fila o el valor es nulo."""
    ci = df['h3_id'].replace_strict(pos, default=-1, return_dtype=pl.Int64).to_numpy()
    ki = df[key].replace_strict({k: i for i, k in enumerate(keys)}, return_dtype=pl.Int64).to_numpy()
    ok = ci >= 0
    out = np.full((len(cells), len(keys)), np.nan, dtype=np.float64)
    out[ci[ok], ki[ok]] = df[col].cast(pl.Float64).fill_null(np.nan).to_numpy()[ok]
    return out


class Store:
    def __init__(self, folder):
        self.card = json.loads((folder / 'harmonization_card.json').read_text(encoding='utf-8'))
        years = [y for y in self.card['daily_years'] if (folder / f'harmonization_{y}.parquet').exists()]
        daily = pl.concat([pl.read_parquet(folder / f'harmonization_{y}.parquet')
                           .with_columns(pl.col('h3_id').cast(pl.String), pl.col('method').cast(pl.String))
                           for y in years])
        cells = np.array(sorted(daily['h3_id'].unique().to_list()))
        self.cells = cells[cells_touching_bolivia(cells)]
        self.pos = {c: i for i, c in enumerate(self.cells)}
        self.dates = sorted(daily['date'].unique().to_list())
        self.date_pos = {d: i for i, d in enumerate(self.dates)}
        daily = daily.with_columns(converted=(~pl.col('method').is_in(['viirs_observed', 'missing'])).cast(pl.Float64))
        m = lambda col: _matrix(daily, self.cells, self.pos, col, 'date', self.dates)  # noqa: E731
        self.M, self.V, self.EQ = m('modis_count'), m('viirs_snpp_count'), m('modis_viirs_eq')
        self.VAR, self.CONV = m('uncertainty') ** 2, m('converted')
        mo = pl.read_parquet(folder / 'harmonization_monthly.parquet')
        self.months = sorted(mo['month'].unique().to_list())
        mm = lambda col: _matrix(mo, self.cells, self.pos, col, 'month', self.months)  # noqa: E731
        self.mM, self.mEQ, self.mVAR, self.mV = mm('modis_count'), mm('modis_viirs_eq'), mm('variance'), mm('viirs_snpp_count')
        self.parents = {r: np.array([h3.cell_to_parent(c, r) for c in self.cells]) for r in range(0, 6)}

    def cells_for(self, h3_id=None):
        if h3_id is None:
            return np.arange(len(self.cells))
        res = h3.get_resolution(h3_id)
        if res == 6:
            return np.array([self.pos[h3_id]]) if h3_id in self.pos else np.array([], dtype=int)
        return np.flatnonzero(self.parents[res] == h3_id)


_LOCK = threading.Lock()


def store():
    """Almacén único; el candado evita que dos peticiones simultáneas lo construyan a la vez."""
    with _LOCK:
        return _store()


@lru_cache(maxsize=1)
def _store():
    try:
        return Store(SERVING) if (SERVING / 'harmonization_card.json').exists() else None
    except (FileNotFoundError, ValueError):
        return None


def _base(s, idx):
    return {'status': 'experimental', 'harmonizer_version': s.card['harmonizer_version'],
            'reference': s.card['reference'], 'cell_count': int(len(idx))}


def coverage():
    s = store()
    if s is None:
        return None
    return {'harmonizer_version': s.card['harmonizer_version'], 'reference': s.card['reference'],
            'cell_count': int(len(s.cells)),
            'daily': {'start': s.dates[0].isoformat(), 'end': s.dates[-1].isoformat()},
            'monthly': {'start': s.months[0].isoformat(), 'end': s.months[-1].isoformat()}}


def series(start, end, h3_id=None):
    """Discrepancia diaria. None si el objetivo está fuera de la zona piloto o de las fechas exportadas."""
    s = store()
    if s is None:
        return {'status': 'unavailable', 'reason': UNAVAILABLE, 'points': []}
    idx = s.cells_for(h3_id)
    if not len(idx) or start not in s.date_pos or end not in s.date_pos:
        return None
    cols = slice(s.date_pos[start], s.date_pos[end] + 1)
    M, V, EQ = (_sum(a[idx, cols]) for a in (s.M, s.V, s.EQ))
    unc = np.sqrt(_sum(s.VAR[idx, cols]))
    conv = np.nansum(s.CONV[idx, cols], 0)
    points = [{'date': d.isoformat(), 'modis_count': _r(M[i], 0), 'viirs_snpp_count': _r(V[i], 0),
               'modis_viirs_eq': _r(EQ[i]), 'uncertainty': _r(unc[i]), 'converted_cells': int(conv[i])}
              for i, d in enumerate(s.dates[cols])]
    both = np.isfinite(M) & np.isfinite(V)
    v, eq, mo = V[both].sum(), EQ[both].sum(), M[both].sum()
    summary = {'days': len(points), 'comparable_days': int(both.sum()),
               'viirs_snpp_total': _r(v, 0), 'modis_total': _r(mo, 0), 'modis_viirs_eq_total': _r(eq, 1),
               'bias_pct': _r(100 * (eq - v) / v, 1) if v > 0 else None,
               'raw_ratio': _r(v / mo, 2) if mo > 0 else None,
               'mean_abs_error': _r(np.abs(EQ[both] - V[both]).mean(), 2) if both.any() else None,
               'converted_cell_days': int(conv.sum())}
    return {**_base(s, idx), 'points': points, 'summary': summary,
            'notes': [s.card['notes'][0], s.card['notes'][1],
                      'Días con VIIRS: el registro armonizado usa el S-NPP observado; el MODIS armonizado sirve para medir '
                      'el error del modelo. Días sin VIIRS (converted_cells): el MODIS armonizado reemplaza al VIIRS.']}


def long_series(h3_id=None, step='year'):
    """Serie 2001-2025 en escala S-NPP. None si el objetivo está fuera de la zona piloto."""
    s = store()
    if s is None:
        return {'status': 'unavailable', 'reason': UNAVAILABLE, 'points': []}
    idx = s.cells_for(h3_id)
    if not len(idx):
        return None
    M, EQ, VAR, V = (_sum(a[idx]) for a in (s.mM, s.mEQ, s.mVAR, s.mV))
    keys = [m.year for m in s.months] if step == 'year' else [m.isoformat()[:7] for m in s.months]
    groups = {}
    for i, k in enumerate(keys):
        groups.setdefault(k, []).append(i)
    first_viirs, aqua = s.card['viirs_first_year'], s.card['aqua_first_day']
    points = []
    for k, ii in groups.items():
        year = k if step == 'year' else int(k[:4])
        period_end = f'{k}-12' if step == 'year' else k
        points.append({'period': str(k), 'modis_count': _r(_sum(M[ii]), 0), 'modis_viirs_eq': _r(_sum(EQ[ii]), 1),
                       'uncertainty': _r(np.sqrt(_sum(VAR[ii])), 1), 'viirs_snpp_count': _r(_sum(V[ii]), 0),
                       'extrapolated': year < first_viirs, 'terra_only': period_end < aqua[:7]})
    return {**_base(s, idx), 'step': step, 'points': points, 'notes': s.card['notes']}
