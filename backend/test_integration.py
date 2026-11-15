"""Run: backend/.venv/Scripts/python -m unittest backend.test_integration -v"""
import unittest
from datetime import date
import math
import duckdb
import h3
from fastapi.testclient import TestClient
from backend.main import app, DATA
from backend.geography import inside_bolivia, BOLIVIA

class ArchiveIntegration(unittest.TestCase):
    def test_polygon_filter(self):
        self.assertTrue(inside_bolivia(-68.15,-16.5))
        self.assertFalse(inside_bolivia(-69.5,-10.0))  # Inside bbox, outside country (Peru).
        self.assertFalse(inside_bolivia(-46.63,-23.55))
        rows = self.client.get('/activity?date=2024-09-06').json()['records']
        for row in rows:
            lat,lng = h3.cell_to_latlng(row['h3_id'])
            center = row.get('display_center',{'lat':lat,'lng':lng})
            self.assertTrue(inside_bolivia(center['lng'],center['lat']))
        self.assertEqual(self.client.get('/regions/bolivia/boundary').status_code,200)
    @classmethod
    def setUpClass(cls):
        cls.client = TestClient(app)
        cls.db = duckdb.connect()
        cls.db.read_parquet(str(DATA/'hotspots_2024.parquet')).create_view('h')
        cls.db.read_parquet(str(DATA/'grid_daily_2024.parquet')).create_view('g')

    def test_archive(self):
        self.assertEqual(self.db.execute('select count(*) from h').fetchone()[0],2946799)
        self.assertEqual(self.db.execute('select sum(detections) from g').fetchone()[0],2946799)
        self.assertEqual(self.db.execute('select count(*) from h where date_utc is null or quality_warning').fetchone()[0],0)
        cells = self.db.execute('select distinct h3_id from h').fetchall()
        self.assertTrue(all(h3.is_valid_cell(c[0]) and h3.get_resolution(c[0])==6 for c in cells))
        self.assertGreater(self.db.execute('select count(*) from h where frp=0').fetchone()[0],0)
        self.assertGreater(self.db.execute('select count(*) from h where type<>0').fetchone()[0],0)
        self.assertEqual(self.db.execute('select count(*) from read_parquet(?)',[str(DATA/'source_quality_2024.parquet')]).fetchone()[0],1464)
        self.assertEqual(self.db.execute("select sum(detections) from read_parquet(?)",[str(DATA/'source_quality_2024.parquet')]).fetchone()[0],2946799)

    def test_api_counts_filters_month(self):
        for confidence, condition in [('all','true'),('nominal',"confidence_class in ('nominal','high')"),('high',"confidence_class='high'")]:
            for granularity, condition_date in [('day',"date='2024-09-06'"),('month',"date between '2024-09-01' and '2024-09-30'")]:
                response = self.client.get('/activity',params={'date':'2024-09-06','granularity':granularity,'confidence':confidence,'region':'bolivia'})
                self.assertEqual(response.status_code,200,response.text[:250])
                rows = response.json()['records']
                for sensor in ['modis','viirs']:
                    expected = self.db.execute(f"select count(*) from h where type=0 and {condition_date} and {condition} and sensor=?",[sensor.upper()]).fetchone()[0]
                    self.assertEqual(sum(r[sensor+'_detected'] or 0 for r in rows),expected)
                self.assertTrue(all(0<=r['activity_index']<=1 and r['coverage'] is None for r in rows))

    def test_series_and_pagination(self):
        activity = self.client.get('/activity?date=2024-09-06').json()['records']
        cell = activity[0]['h3_id']
        series = self.client.get('/activity/series',params={'from':'2024-01-01','to':'2024-12-31','region':'bolivia'}).json()['points']
        self.assertEqual(len(series),366)
        day = next(p for p in series if p['date']=='2024-09-06')
        self.assertEqual(day['viirs_detected'],sum(r['viirs_detected'] or 0 for r in activity))
        pages = [self.client.get('/detections',params={'date':'2024-09-06','limit':2,'offset':n}).json() for n in [0,2]]
        self.assertEqual(len(pages[0]),2)
        self.assertNotEqual(pages[0],pages[1])
        original = self.client.get('/detections',params={'date':'2024-09-06','h3_id':cell}).json()
        self.assertTrue(all(r['h3_id']==cell for r in original))
        parent = h3.cell_to_parent(cell,4)
        parent_series = self.client.get('/activity/series',params={'from':'2024-09-06','to':'2024-09-06','h3_id':parent})
        self.assertEqual(parent_series.status_code,200)
        expected = sum(r['viirs_detected'] or 0 for r in activity if h3.cell_to_parent(r['h3_id'],4)==parent)
        self.assertEqual(parent_series.json()['points'][0]['viirs_detected'],expected)
        self.assertEqual(self.client.get('/activity?date=2025-01-01').status_code,422)
        self.assertEqual(self.client.get('/activity?date=2024-09-06&region=fake').status_code,422)
        self.assertEqual(self.client.get('/detections?date=2024-09-06&h3_id=invalid').status_code,422)
        for endpoint in ['/health','/meta','/regions','/regions/bolivia/cells','/docs','/openapi.json','/model']:
            self.assertEqual(self.client.get(endpoint).status_code,200,endpoint)
        self.assertEqual(self.client.get('/predictions').json()['status'],'unavailable')
        self.assertIsNone(self.client.get('/predictions/detail').json()['probability'])
        self.assertEqual(self.client.get('/health',headers={'Origin':'http://localhost:3000'}).headers['access-control-allow-origin'],'http://localhost:3000')

if __name__ == '__main__':
    unittest.main()
