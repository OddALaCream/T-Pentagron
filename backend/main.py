"""Local FIRMS API. All public activity counts use type=0, never deduplicated."""
from datetime import date as Date, timedelta
from pathlib import Path
from typing import Literal
from functools import lru_cache
import json
import os
import duckdb
import h3
from fastapi import FastAPI, HTTPException, Query, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from backend.geography import FEATURE, BOLIVIA, inside_bolivia
from backend import predictions as forecast

DATA = Path(__file__).resolve().parents[1] / 'data/processed'
app = FastAPI(title='Bolivia FIRMS 2024', version='0.1.0')
# CORS_ORIGINS='http://localhost:3010,...' permite servir el frontend en otro puerto
ORIGINS = os.environ.get('CORS_ORIGINS','http://localhost:3000,http://127.0.0.1:3000').split(',')
app.add_middleware(CORSMiddleware, allow_origins=ORIGINS,
                   allow_methods=['GET'], allow_headers=['*'])
app.add_middleware(GZipMiddleware, minimum_size=2000)  # /predictions devuelve ~3.600 celdas

def query(sql, params=()):
    if not (DATA/'manifest.json').exists():
        raise HTTPException(503, 'Run pipelines/build_dataset.py first')
    with duckdb.connect(config={'threads': 2}) as db:
        for name, filename in [('grid','grid_daily_2024'),('hotspots','hotspots_2024'),('quality','source_quality_2024')]:
            db.read_parquet(str(DATA/f'{filename}.parquet')).create_view(name)
        result = db.execute(sql, params)
        return [dict(zip([c[0] for c in result.description], row)) for row in result.fetchall()]

def validate_date(value):
    if value.year != 2024:
        raise HTTPException(422, 'Only Bolivia archive dates in 2024 are available')

def validate_region(region):
    if region and any(r != 'bolivia' for r in region.split(',')):
        raise HTTPException(422, 'Only region=bolivia is supported; no administrative boundaries supplied')

def validate_cell(cell):
    if cell and (not h3.is_valid_cell(cell) or h3.get_resolution(cell) > 6):
        raise HTTPException(422, 'h3_id must be a valid cell at resolution 0–6')

@lru_cache(maxsize=512)
def child_cells(cell):
    resolution = h3.get_resolution(cell)
    return [c for c in known_cells() if h3.cell_to_parent(c, resolution) == cell]

@lru_cache(maxsize=1)
def manifest():
    return json.loads((DATA/'manifest.json').read_text(encoding='utf-8'))

@app.get('/health')
def health():
    ready = all((DATA/f'{p}_2024.parquet').exists() for p in ['hotspots','grid_daily','source_quality'])
    if not ready:
        raise HTTPException(503, 'Processed datasets missing')
    return {'status':'ok','data_mode':'archive','year':2024}

@app.get('/meta')
def meta():
    return {'date_range':{'start':'2024-01-01','end':'2024-12-31'}, **manifest(),
            'scope':'Detections filtered by Natural Earth 1:10m Bolivia GeoJSON; original rows retained',
            'main_type':0, 'coverage':'unknown; absent detections do not establish absent fire or valid satellite observation',
            'confidence':'MODIS <30/30-79/>=80; VIIRS l/n/h. Labels are not scientifically equivalent.',
            'harmonization':{'method':'sensor_log_count_q95_v1',
                'formula':'I_s=min(1,log(1+n_s)/log(1+q95_s)); I=mean(I_s for sensors with detections)',
                'baseline':'2024 positive type=0 H3-6 daily counts per instrument family; linear 95th percentile',
                'aggregation':'Month and series: mean daily cell indices over cells/days with detections. Parent H3: mean child indices.',
                'notes':'Exploratory relative activity, not physical calibration, fire count, burned area or coverage. Confidence filters keep the fixed baseline.'},
            'prediction':forecast.coverage() or {'status':'unavailable'}}

@app.get('/regions')
def regions():
    cells = region_cells('bolivia')['h3_ids']
    return [{'id':'bolivia','name':'Bolivia · archivo 2024','country':'Bolivia','country_code':'BO',
             'admin':'País · Natural Earth 1:10m', 'biome':'No clasificado',
             'center':{'lat':-16.5,'lng':-64.5},'is_pilot':True,'resolution':6,
             'cell_count':len(cells),'bbox':list(BOLIVIA.bounds),'utc_offset':-4,
             'season_label':'Archivo histórico 2024',
             'description':'Detecciones dentro del polígono de Bolivia (Natural Earth 1:10m). Frontera cartográfica, no deslinde legal.'}]

@app.get('/regions/bolivia/boundary')
def boundary():
    return FEATURE

@lru_cache(maxsize=1)
def known_cells():
    return [r['h3_id'] for r in query('SELECT DISTINCT h3_id FROM grid WHERE h3_id IS NOT NULL AND in_bolivia ORDER BY h3_id')]

@app.get('/regions/{region_id}/cells')
def region_cells(region_id: str):
    validate_region(region_id)
    return {'h3_ids':known_cells(), 'scope':'Cells with archive detections; not satellite coverage or administrative boundary'}

def daily_cells(start, end, confidence='all', cell=None):
    clauses = ['date BETWEEN ? AND ?', 'type=0', 'in_bolivia', 'h3_id IS NOT NULL']
    params = [start,end]
    if confidence == 'nominal':
        clauses.append("confidence_class IN ('nominal','high')")
    elif confidence == 'high':
        clauses.append("confidence_class='high'")
    if cell:
        clauses.append('h3_id IN (SELECT unnest(?))')
        params.append([cell] if h3.get_resolution(cell) == 6 else child_cells(cell))
    # Sum confidence strata before normalizing. Separate sensor totals stay original.
    sql = '''WITH sensor_days AS (
        SELECT date,h3_id,sensor,sum(detections)::BIGINT n,sum(frp_sum) frp,
          first(latitude) latitude,first(longitude) longitude,
          least(1.0,ln(1+sum(detections))/ln(1+max(q95_count))) idx,
          sum(CASE WHEN confidence_class='low' THEN detections ELSE 0 END)::BIGINT low,
          sum(CASE WHEN confidence_class='nominal' THEN detections ELSE 0 END)::BIGINT nominal,
          sum(CASE WHEN confidence_class='high' THEN detections ELSE 0 END)::BIGINT high
        FROM grid WHERE ''' + ' AND '.join(clauses) + ''' GROUP BY date,h3_id,sensor)
        SELECT date,h3_id,first(latitude) latitude,first(longitude) longitude,
          sum(n) FILTER(WHERE sensor='MODIS')::BIGINT modis_detected,
          sum(n) FILTER(WHERE sensor='VIIRS')::BIGINT viirs_detected,
          sum(frp) FILTER(WHERE sensor='MODIS') modis_frp_sum,
          sum(frp) FILTER(WHERE sensor='VIIRS') viirs_frp_sum,
          avg(idx) activity_index,
          [sum(low) FILTER(WHERE sensor='MODIS'),sum(nominal) FILTER(WHERE sensor='MODIS'),sum(high) FILTER(WHERE sensor='MODIS')] modis_by_confidence,
          [sum(low) FILTER(WHERE sensor='VIIRS'),sum(nominal) FILTER(WHERE sensor='VIIRS'),sum(high) FILTER(WHERE sensor='VIIRS')] viirs_by_confidence
        FROM sensor_days GROUP BY date,h3_id'''
    return sql, params

def decorate(row):
    if 'h3_id' in row:
        center = h3.cell_to_latlng(row['h3_id'])
        if not inside_bolivia(center[1], center[0]):
            row['display_center'] = {'lat':row.get('latitude',center[0]),'lng':row.get('longitude',center[1])}
    row['availability_flag'] = 'observed' if row['modis_detected'] is not None and row['viirs_detected'] is not None else 'partial'
    row['coverage'] = None  # availability describes detections, never observation coverage
    row['region_id'] = 'bolivia'
    for sensor in ['modis','viirs']:
        key = f'{sensor}_by_confidence'
        if key in row and row[f'{sensor}_detected'] is None:
            row[key] = None
    return row

@app.get('/activity')
def activity(date: Date, granularity: Literal['day','month']='day', region: str | None=None,
             confidence: Literal['all','nominal','high']='all'):
    validate_date(date)
    validate_region(region)
    start = date.replace(day=1) if granularity == 'month' else date
    end = ((start.replace(day=28)+timedelta(days=4)).replace(day=1)-timedelta(days=1)) if granularity == 'month' else date
    sql, params = daily_cells(start,end,confidence)
    if granularity == 'month':
        sql = f'''SELECT h3_id,first(latitude) latitude,first(longitude) longitude, sum(modis_detected)::BIGINT modis_detected,
          sum(viirs_detected)::BIGINT viirs_detected, sum(modis_frp_sum) modis_frp_sum,
          sum(viirs_frp_sum) viirs_frp_sum, avg(activity_index) activity_index
          FROM ({sql}) GROUP BY h3_id'''
    rows = query(sql+' ORDER BY h3_id',params)
    for row in rows:
        row['date'] = date.isoformat()
        decorate(row)
    return {'date':date,'granularity':granularity,'records':rows,'scope':'Bolivia archive; type=0',
            'coverage':'unknown','record_count':len(rows)}

@app.get('/activity/series')
def series(from_: Date=Query(alias='from'), to: Date=Query(), h3_id: str | None=None, region: str | None=None):
    validate_date(from_); validate_date(to); validate_cell(h3_id); validate_region(region)
    if from_ > to:
        raise HTTPException(422,'from must be <= to')
    sql, params = daily_cells(from_,to,cell=h3_id)
    rows = query(f'''SELECT date,sum(modis_detected)::BIGINT modis_detected,
        sum(viirs_detected)::BIGINT viirs_detected,sum(modis_frp_sum) modis_frp_sum,
        sum(viirs_frp_sum) viirs_frp_sum,avg(activity_index) activity_index,
        count(*) active_cells FROM ({sql}) GROUP BY date ORDER BY date''',params)
    indexed = {r['date']:decorate(r) for r in rows}
    points = []
    for day in range((to-from_).days+1):
        d = from_+timedelta(days=day)
        points.append(indexed.get(d, {'date':d,'modis_detected':None,'viirs_detected':None,
            'activity_index':None,'availability_flag':'missing','active_cells':0,'coverage':None,
            'note':'No type=0 detections in archive; satellite coverage unknown'}))
    return {'points':points}

@app.get('/detections')
def detections(response: Response, date: Date, h3_id: str | None=None,
               limit: int=Query(500,ge=1,le=5000), offset: int=Query(0,ge=0)):
    validate_date(date); validate_cell(h3_id)
    clause = ' AND h3_id IN (SELECT unnest(?))' if h3_id else ''
    params = [date]
    if h3_id:
        params.append([h3_id] if h3.get_resolution(h3_id) == 6 else child_cells(h3_id))
    response.headers['X-Total-Count'] = str(query('SELECT count(*) n FROM hotspots WHERE in_bolivia AND date=?'+clause,params)[0]['n'])
    rows = query('''SELECT h3_id,strftime(date_utc, '%Y-%m-%dT%H:%M:%SZ') date_utc,sensor,satellite,frp,confidence_original confidence,
        latitude,longitude,product,version,daynight,type,source_id,source_row
        FROM hotspots WHERE in_bolivia AND date=?'''+clause+' ORDER BY date_utc,source_id,source_row LIMIT ? OFFSET ?',params+[limit,offset])
    for row in rows:
        if row['sensor']=='MODIS':
            row['confidence'] = int(row['confidence'])
    return rows

@app.get('/predictions')
def predictions(date: Date, region: str | None=None):
    """Probabilidad experimental t+1 (Modelo B FireSight). Solo cubre la zona piloto del modelo."""
    validate_date(date); validate_region(region)
    return forecast.predictions(date)

@app.get('/predictions/detail')
def prediction_detail(date: Date, h3_id: str | None=None, region: str | None=None):
    validate_date(date); validate_cell(h3_id); validate_region(region)
    result = forecast.detail(date, h3_id)
    if result is None:
        raise HTTPException(404, 'Sin predicción: el objetivo está fuera de la zona piloto del modelo (Chiquitanía)')
    return result

@app.get('/model')
def model():
    return forecast.model_info()

@app.get('/weather')
@app.get('/news')
def unsupported_optional_data():
    return []
