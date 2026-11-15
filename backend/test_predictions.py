"""Pruebas de la predicción FireSight servida por la API (requiere data/models/, ver firesight/README.md).

Run: backend/.venv/bin/python -m unittest backend.test_predictions -v
"""
import unittest
from datetime import date, timedelta

import h3
import numpy as np
import polars as pl
from fastapi.testclient import TestClient

from backend import predictions as P
from backend.geography import BOLIVIA
from backend.main import app
from shapely.geometry import Polygon

D = '2024-09-06'


@unittest.skipIf(P.store() is None, 'artefacto data/models/ ausente')
class PredictionApi(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.client = TestClient(app)
        cls.s = P.store()
        cls.pred = pl.read_parquet(P.SERVING / 'predictions_2024.parquet')
        cls.ex = pl.read_parquet(P.SERVING / 'explanations_2024.parquet')

    def get(self, path, **params):
        r = self.client.get(path, params=params)
        self.assertEqual(r.status_code, 200, r.text[:300])
        return r.json()

    def test_predictions_match_artifact(self):
        body = self.get('/predictions', date=D, region='bolivia')
        rows = body['predictions']
        self.assertEqual(body['status'], 'experimental')
        self.assertEqual(len(rows), self.s.card['region']['cell_count'] - body['coverage']['cells_outside_bolivia_dropped'])
        self.assertTrue(all(r['forecast_date'] == '2024-09-07' and r['issued_for_date'] == D for r in rows))
        self.assertTrue(all(0 <= r['probability'] <= 1 and r['evaluation_split'] == 'validation' for r in rows))
        saved = dict(self.pred.filter(pl.col('issue_date') == date(2024, 9, 6)).select('h3_id', 'probability').iter_rows())
        diff = max(abs(r['probability'] - saved[r['h3_id']]) for r in rows)
        self.assertLess(diff, 1e-4)                                   # la API redondea a 4 decimales
        thr = self.s.card['threshold_f1']
        self.assertTrue(all(r['above_threshold'] == (saved[r['h3_id']] >= thr) for r in rows))

    def test_cells_are_bolivian_h3_res6(self):
        rows = self.get('/predictions', date=D)['predictions']
        for r in rows[::50]:
            self.assertEqual(h3.get_resolution(r['h3_id']), 6)
            poly = Polygon([(lng, lat) for lat, lng in h3.cell_to_boundary(r['h3_id'])])
            self.assertTrue(poly.intersects(BOLIVIA), r['h3_id'])

    def test_cell_detail_exact_decomposition(self):
        rows = self.get('/predictions', date=D)['predictions']
        top = max(rows, key=lambda r: r['probability'])
        d = self.get('/predictions/detail', h3_id=top['h3_id'], date=D)
        self.assertAlmostEqual(d['probability'], top['probability'], places=6)
        self.assertEqual(len(d['features']), P.TOP_FEATURES)
        c = [f['contribution'] for f in d['features']]
        self.assertEqual(c, sorted(c, key=abs, reverse=True))
        # sesgo + suma de los 23 aportes = probabilidad del bosque (exacto en el artefacto)
        row = self.ex.filter((pl.col('h3_id') == top['h3_id']) & (pl.col('issue_date') == date(2024, 9, 6)))
        full = row.select([f'c_{k}' for k in self.s.features]).to_numpy().sum()
        self.assertAlmostEqual(float(row['forest_bias'][0] + full), float(row['forest_raw'][0]), places=5)
        self.assertAlmostEqual(d['forest_probability_raw'], float(row['forest_raw'][0]), places=3)
        other = self.get('/predictions/detail', h3_id=top['h3_id'], date='2024-08-15')
        self.assertNotEqual([f['contribution'] for f in other['features']], c)

    def test_region_and_parent_detail(self):
        rows = self.get('/predictions', date=D)['predictions']
        r = self.get('/predictions/detail', region='bolivia', date=D)
        self.assertEqual(sum(r['distribution']), len(rows))
        self.assertAlmostEqual(r['probability'], max(x['probability'] for x in rows), places=6)
        self.assertAlmostEqual(r['mean_probability'], np.mean([x['probability'] for x in rows]), places=3)
        self.assertEqual(r['explained_cells'], P.REGION_SAMPLE)
        top = r['top_cells'][0]['h3']
        par = self.get('/predictions/detail', h3_id=h3.cell_to_parent(top, 4), date=D)
        self.assertGreaterEqual(par['probability'], r['top_cells'][0]['probability'] - 1e-9)
        self.assertEqual(sum(par['distribution']), par['cell_count'])

    def test_low_probability_cell_has_probability_but_no_explanation(self):
        rows = self.get('/predictions', date='2024-02-10')['predictions']
        lows = sorted(rows, key=lambda x: x['probability'])[:5]
        d = self.get('/predictions/detail', h3_id=lows[0]['h3_id'], date='2024-02-10')
        self.assertIsNotNone(d['probability'])
        self.assertEqual(d['features'], [])
        self.assertIn('note', d)

    def test_out_of_coverage_and_dates(self):
        la_paz = h3.latlng_to_cell(-16.5, -68.15, 6)                  # Bolivia, fuera de la zona piloto
        self.assertEqual(self.client.get('/predictions/detail', params={'h3_id': la_paz, 'date': D}).status_code, 404)
        self.assertEqual(self.client.get('/predictions', params={'date': '2023-01-01'}).status_code, 422)  # año sin archivo
        self.assertEqual(self.client.get('/predictions', params={'date': D, 'region': 'fake'}).status_code, 422)
        self.assertEqual(self.client.get('/predictions/detail', params={'h3_id': 'x', 'date': D}).status_code, 422)
        last = self.get('/predictions', date='2024-12-31')['predictions']
        self.assertEqual(last[0]['forecast_date'], '2025-01-01')

    def test_model_and_meta(self):
        m = self.get('/model')
        self.assertEqual(m['status'], 'experimental')
        self.assertGreater(m['metrics']['pr_auc'], m['baseline_metrics']['pr_auc'])
        self.assertTrue(any('No es una alerta operativa' in n for n in m['notes']))
        self.assertEqual(self.get('/meta')['prediction']['cell_count'], len(self.s.cells))

    def test_predicted_probability_is_informative_in_2024(self):
        """Contra lo observado: las celdas con p alta deben tener mucha más actividad al día siguiente."""
        rows = self.get('/predictions', date=D)['predictions']
        acts = self.get('/activity', date=(date(2024, 9, 6) + timedelta(days=1)).isoformat())['records']
        active = {a['h3_id'] for a in acts if (a['viirs_detected'] or 0) + (a['modis_detected'] or 0) > 0}
        hi = [r for r in rows if r['probability'] >= 0.5]
        lo = [r for r in rows if r['probability'] < 0.05]
        rate = lambda xs: np.mean([x['h3_id'] in active for x in xs])  # noqa: E731
        self.assertGreater(len(hi), 20)
        self.assertGreater(rate(hi), 0.5)
        self.assertLess(rate(lo), 0.05)


if __name__ == '__main__':
    unittest.main()
