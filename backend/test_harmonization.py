"""Pruebas del Modelo A servido por la API (requiere data/models/harmonization_*, solo local:
python -m firesight.export_harmonization).

Run: backend/.venv/bin/python -m unittest backend.test_harmonization -v
"""
import unittest
from datetime import date

import h3
import numpy as np
import polars as pl
from fastapi.testclient import TestClient

from backend import harmonization as H
from backend.main import app

S = H.store()
DAYS = ['2024-09-06', '2024-08-15', '2024-03-10']


@unittest.skipIf(S is None, 'sin data/models/harmonization_* (python -m firesight.export_harmonization)')
class HarmonizationApi(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.client = TestClient(app)
        cls.daily = pl.read_parquet(H.SERVING / 'harmonization_2024.parquet').with_columns(pl.col('h3_id').cast(pl.String))
        cls.pilot = set(S.cells)

    def get(self, path, **params):
        r = self.client.get(path, params=params)
        self.assertEqual(r.status_code, 200, r.text[:300])
        return r.json()

    def test_region_day_matches_artifact(self):
        d = date(2024, 9, 6)
        p = self.get('/harmonization/series', **{'from': d.isoformat(), 'to': d.isoformat(), 'region': 'bolivia'})
        rows = self.daily.filter((pl.col('date') == d) & pl.col('h3_id').is_in(list(self.pilot)))
        pt = p['points'][0]
        self.assertEqual(pt['modis_count'], rows['modis_count'].sum())
        self.assertEqual(pt['viirs_snpp_count'], rows['viirs_snpp_count'].sum())
        self.assertAlmostEqual(pt['modis_viirs_eq'], rows['modis_viirs_eq'].sum(), places=1)
        self.assertEqual(p['cell_count'], len(self.pilot))
        self.assertEqual(p['status'], 'experimental')

    def test_modis_matches_observatory_download(self):
        """Mismo producto, dos descargas (archivo por país vs DL_FIRE del equipo): MODIS nominal+alta debe coincidir."""
        for d in DAYS:
            obs = self.get('/activity', date=d, confidence='nominal')['records']
            expected = sum(a['modis_detected'] or 0 for a in obs if a['h3_id'] in self.pilot)
            got = self.get('/harmonization/series', **{'from': d, 'to': d})['points'][0]['modis_count']
            self.assertEqual(got, expected, d)

    def test_snpp_is_part_of_observatory_viirs(self):
        """El globo suma tres VIIRS; S-NPP solo es una parte (de ahí que no se reemplace el índice del globo)."""
        for d in DAYS:
            obs = self.get('/activity', date=d)['records']
            viirs3 = sum(a['viirs_detected'] or 0 for a in obs if a['h3_id'] in self.pilot)
            snpp = self.get('/harmonization/series', **{'from': d, 'to': d})['points'][0]['viirs_snpp_count']
            self.assertLessEqual(snpp, viirs3, d)
            if viirs3 > 1000:
                self.assertLess(snpp, 0.6 * viirs3, d)

    def test_parent_cell_is_sum_of_children(self):
        d = '2024-09-06'
        top = (self.daily.filter((pl.col('date') == date(2024, 9, 6)) & pl.col('h3_id').is_in(list(self.pilot)))
               .sort('viirs_snpp_count', descending=True)['h3_id'][0])
        parent = h3.cell_to_parent(top, 4)
        kids = [c for c in self.pilot if h3.cell_to_parent(c, 4) == parent]
        total = sum(self.get('/harmonization/series', **{'from': d, 'to': d, 'h3_id': c})['points'][0]['viirs_snpp_count'] for c in kids)
        self.assertEqual(self.get('/harmonization/series', **{'from': d, 'to': d, 'h3_id': parent})['points'][0]['viirs_snpp_count'], total)

    def test_summary_bias_is_consistent(self):
        p = self.get('/harmonization/series', **{'from': '2024-08-01', 'to': '2024-10-31'})
        sm, pts = p['summary'], p['points']
        self.assertEqual(sm['comparable_days'], 92)
        v = sum(x['viirs_snpp_count'] for x in pts)
        e = sum(x['modis_viirs_eq'] for x in pts)
        self.assertEqual(sm['viirs_snpp_total'], v)
        self.assertAlmostEqual(sm['bias_pct'], 100 * (e - v) / v, places=0)
        self.assertLess(abs(sm['bias_pct']), 30)       # temporada 2024: el armonizado queda cerca de S-NPP

    def test_long_series(self):
        L = self.get('/harmonization/long-series')
        pts = {p['period']: p for p in L['points']}
        self.assertEqual(sorted(pts), [str(y) for y in range(2001, 2026)])
        for y, p in pts.items():
            self.assertEqual(p['viirs_snpp_count'] is None, int(y) < 2012, y)
            self.assertEqual(p['extrapolated'], int(y) < 2012, y)
            self.assertIsNotNone(p['modis_viirs_eq'], y)
        self.assertTrue(pts['2001']['terra_only'])
        self.assertFalse(pts['2003']['terra_only'])
        # 2024 anual = suma de los días 2024 (mismo armonizador, dos agregaciones)
        rows = self.daily.filter(pl.col('h3_id').is_in(list(self.pilot)))
        self.assertEqual(pts['2024']['viirs_snpp_count'], rows['viirs_snpp_count'].sum())
        self.assertEqual(pts['2024']['modis_count'], rows['modis_count'].sum())
        self.assertAlmostEqual(pts['2024']['modis_viirs_eq'] / rows['modis_viirs_eq'].sum(), 1, places=4)
        # en los años con VIIRS el armonizado sigue al observado (±35 % por año)
        ratios = [pts[str(y)]['modis_viirs_eq'] / pts[str(y)]['viirs_snpp_count'] for y in range(2012, 2026)]
        self.assertTrue(all(0.65 < r < 1.35 for r in ratios), ratios)
        months = self.get('/harmonization/long-series', step='month')['points']
        self.assertEqual(len(months), 25 * 12)
        self.assertTrue(months[17]['terra_only'] and not months[18]['terra_only'])   # Aqua desde jul-2002

    def test_coverage_errors(self):
        la_paz = h3.latlng_to_cell(-16.5, -68.15, 6)
        self.assertEqual(self.client.get('/harmonization/series', params={'from': '2024-09-01', 'to': '2024-09-02', 'h3_id': la_paz}).status_code, 404)
        self.assertEqual(self.client.get('/harmonization/long-series', params={'h3_id': la_paz}).status_code, 404)
        self.assertEqual(self.client.get('/harmonization/series', params={'from': '2023-01-01', 'to': '2023-01-02'}).status_code, 404)
        self.assertEqual(self.client.get('/harmonization/series', params={'from': '2024-09-02', 'to': '2024-09-01'}).status_code, 422)
        self.assertEqual(self.client.get('/harmonization/long-series', params={'region': 'fake'}).status_code, 422)
        self.assertEqual(self.get('/meta')['firesight_harmonization']['cell_count'], len(self.pilot))

    def test_missing_sensor_is_null_not_zero(self):
        mo = pl.read_parquet(H.SERVING / 'harmonization_monthly.parquet')
        early = mo.filter(pl.col('month') < date(2012, 1, 1))
        self.assertEqual(early['viirs_snpp_count'].null_count() + early['viirs_snpp_count'].is_nan().sum(), early.height)
        self.assertTrue(np.all(early['viirs_days'].to_numpy() == 0))


if __name__ == '__main__':
    unittest.main()
