"""Pruebas del observatorio con varios años (2024 en git; 2025 en el release de datos, scripts/descargar_datos.py).

Las pruebas de 2025 se saltan si faltan sus archivos:
  - predicción: data/models/predictions_2025.parquet y explanations_2025.parquet (firesight.export_serving 2025)
  - observado:  data/processed/*_2025.parquet (pipelines/build_dataset.py 2025, con DL_FIRE_* en data/raw/firms/2025/)

Run: backend/.venv/bin/python -m unittest backend.test_years -v
"""
import json
import shutil
import tempfile
import unittest
from datetime import date, timedelta
from pathlib import Path

import duckdb
import h3
import numpy as np
import polars as pl
from fastapi.testclient import TestClient

from backend import main as M
from backend import predictions as P
from pipelines import build_dataset as B

S = P.store()
HAS_PRED_2025 = S is not None and 2025 in S.years
HAS_OBS_2025 = 2025 in M.years()


class ModelCard(unittest.TestCase):
    def test_card_lists_years_of_one_model(self):
        card = json.loads((P.SERVING / 'model_card.json').read_text(encoding='utf-8'))
        self.assertEqual(card['years']['2024']['evaluation_split'], 'validation')
        if '2025' in card['years']:
            self.assertEqual(card['years']['2025']['evaluation_split'], 'test')
        for y in card['years'].values():
            self.assertLess(y['max_decomposition_error'], 1e-9)

    def test_legacy_single_year_card_still_loads(self):
        """Tarjeta del formato anterior (un solo 'year'): el backend la sigue leyendo."""
        card = json.loads((P.SERVING / 'model_card.json').read_text(encoding='utf-8'))
        legacy = {k: v for k, v in card.items() if k != 'years'}
        legacy.update(year=2024, evaluation_split='validation')
        with tempfile.TemporaryDirectory() as tmp:
            for name in ('predictions_2024.parquet', 'explanations_2024.parquet'):
                shutil.copy(P.SERVING / name, tmp)
            (Path(tmp) / 'model_card.json').write_text(json.dumps(legacy), encoding='utf-8')
            s = P.Store(Path(tmp))
        self.assertEqual(s.years, [2024])
        self.assertEqual(s.split_of(date(2024, 9, 6)), 'validation')

    def test_listed_year_without_files_is_skipped(self):
        card = json.loads((P.SERVING / 'model_card.json').read_text(encoding='utf-8'))
        card['years']['2031'] = {'evaluation_split': 'external'}
        with tempfile.TemporaryDirectory() as tmp:
            for name in ('predictions_2024.parquet', 'explanations_2024.parquet'):
                shutil.copy(P.SERVING / name, tmp)
            (Path(tmp) / 'model_card.json').write_text(json.dumps(card), encoding='utf-8')
            self.assertEqual(P.Store(Path(tmp)).years, [2024])


@unittest.skipUnless(HAS_PRED_2025, 'sin data/models/*_2025.parquet')
class Prediction2025(unittest.TestCase):
    def test_dates_are_contiguous_across_years(self):
        d = S.dates
        self.assertEqual((d[0], d[-1]), (date(2024, 1, 1), date(2025, 12, 31)))
        self.assertEqual(len(d), 366 + 365)
        self.assertTrue(all((b - a) == timedelta(days=1) for a, b in zip(d[:-1], d[1:])))

    def test_split_and_probabilities_match_artifact(self):
        day = date(2025, 9, 6)
        self.assertEqual(S.split_of(day), 'test')
        self.assertEqual(S.split_of(date(2024, 9, 6)), 'validation')
        saved = dict(pl.read_parquet(P.SERVING / 'predictions_2025.parquet')
                     .filter(pl.col('issue_date') == day).select('h3_id', 'probability').iter_rows())
        body = P.predictions(day)
        self.assertEqual(len(body['predictions']), len(S.cells))
        self.assertTrue(all(r['evaluation_split'] == 'test' for r in body['predictions']))
        self.assertLess(max(abs(r['probability'] - saved[r['h3_id']]) for r in body['predictions']), 1e-4)

    def test_2025_explanation_is_exact(self):
        day = date(2025, 9, 6)
        top = max(P.predictions(day)['predictions'], key=lambda r: r['probability'])
        d = P.detail(day, top['h3_id'])
        self.assertEqual(d['evaluation_split'], 'test')
        self.assertTrue(d['features'])
        ex = pl.read_parquet(P.SERVING / 'explanations_2025.parquet').filter(
            (pl.col('h3_id') == top['h3_id']) & (pl.col('issue_date') == day))
        total = ex.select([f'c_{k}' for k in S.features]).to_numpy().sum() + ex['forest_bias'][0]
        self.assertAlmostEqual(float(total), float(ex['forest_raw'][0]), places=5)

    def test_model_notes_name_the_test_year(self):
        notes = P.model_info()['notes']
        self.assertTrue(any(n.startswith('2025 es el año de prueba') for n in notes))
        self.assertEqual(P.coverage()['years'], {'2024': 'validation', '2025': 'test'})


@unittest.skipUnless(HAS_OBS_2025, 'sin data/processed/*_2025.parquet')
class Observatory2025(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.client = TestClient(M.app)
        cls.db = duckdb.connect()
        cls.db.read_parquet(str(M.DATA / 'hotspots_2025.parquet')).create_view('h')

    def get(self, path, **params):
        r = self.client.get(path, params=params)
        self.assertEqual(r.status_code, 200, r.text[:300])
        return r.json()

    def test_meta_range_covers_both_years(self):
        meta = self.get('/meta')
        self.assertEqual(meta['date_range'], {'start': '2024-01-01', 'end': '2025-12-31'})
        self.assertEqual(meta['years'], [2024, 2025])
        self.assertEqual(meta['by_year']['2025']['index_q95'], meta['by_year']['2024']['index_q95'])  # base fija
        self.assertEqual(self.get('/regions')[0]['name'], 'Bolivia · archivo 2024–2025')

    def test_2025_counts_match_hotspots(self):
        rows = self.get('/activity', date='2025-09-06')['records']
        for sensor in ['modis', 'viirs']:
            expected = self.db.execute("select count(*) from h where type=0 and in_bolivia and date='2025-09-06' and sensor=?",
                                       [sensor.upper()]).fetchone()[0]
            self.assertEqual(sum(r[sensor + '_detected'] or 0 for r in rows), expected)
        self.assertEqual(self.db.execute("select count(*) from h where year(date)<>2025").fetchone()[0], 0)

    def test_series_crosses_new_year(self):
        pts = self.get('/activity/series', **{'from': '2024-12-30', 'to': '2025-01-02', 'region': 'bolivia'})['points']
        self.assertEqual([p['date'] for p in pts], ['2024-12-30', '2024-12-31', '2025-01-01', '2025-01-02'])

    def test_prediction_api_serves_test_year(self):
        if not HAS_PRED_2025:
            self.skipTest('sin predicción 2025')
        rows = self.get('/predictions', date='2025-09-06')['predictions']
        self.assertTrue(rows and all(r['evaluation_split'] == 'test' for r in rows))
        acts = self.get('/activity', date='2025-09-07')['records']
        active = {a['h3_id'] for a in acts if (a['viirs_detected'] or 0) + (a['modis_detected'] or 0) > 0}
        hi = [r for r in rows if r['probability'] >= 0.5]
        lo = [r for r in rows if r['probability'] < 0.05]
        if hi:
            self.assertGreater(np.mean([r['h3_id'] in active for r in hi]), 0.5)
        self.assertLess(np.mean([r['h3_id'] in active for r in lo]), 0.05)


class Concurrency(unittest.TestCase):
    def test_parallel_cold_builds_share_one_store(self):
        """Regresión: /meta, /predictions y /activity cargaban en paralelo los almacenes y GEOS hacía segfault."""
        import concurrent.futures as cf
        from backend import harmonization as H
        from backend import geography as G
        P._store.cache_clear()
        H._store.cache_clear()
        sample = [h3.latlng_to_cell(-17 + i * 0.01, -61 + i * 0.01, 6) for i in range(300)]
        jobs = [P.store, H.store, lambda: G.cells_touching_bolivia(sample),
                lambda: G.inside_bolivia(np.linspace(-63, -59, 500), np.linspace(-18, -16, 500))] * 8
        with cf.ThreadPoolExecutor(16) as ex:
            out = [f.result() for f in [ex.submit(j) for j in jobs]]
        self.assertTrue(all(o is out[0] for o in out[0::4]))     # un solo almacén de predicción
        self.assertTrue(all(o is out[1] for o in out[1::4]))     # un solo almacén de armonización
        self.assertTrue(all((o == out[2]).all() for o in out[2::4]))


class Pipeline(unittest.TestCase):
    def test_discover_2024_finds_the_four_products(self):
        found = B.discover(2024)
        self.assertEqual(sorted(k for k, *_ in found), sorted(B.EXPECTED))
        self.assertEqual({s for _, s, _, _ in found}, {'MODIS', 'VIIRS'})

    def test_year_without_downloads_stops(self):
        with self.assertRaises(SystemExit):
            B.discover(2019)


if __name__ == '__main__':
    unittest.main()
