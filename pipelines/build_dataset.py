"""Build the FIRMS archive for one or more years. Run from any working directory.

Uso:  python pipelines/build_dataset.py [AÑO ...]        (por defecto 2024)

Busca las descargas de archivo FIRMS (carpetas DL_FIRE_<producto>_<id>/fire_archive_*.csv) en la raíz del
repo (2024, versionado) y en data/raw/firms/<año>/ (otros años, solo local). Cada año produce
hotspots_<año>, grid_daily_<año>, source_quality_<año> y manifest_<año>.json (2024: manifest.json) en data/processed/.
El índice exploratorio usa siempre la base q95 de 2024, para que los años sean comparables entre sí.
"""
from pathlib import Path
from datetime import date
import json
import sys
import h3
import polars as pl
import polars.selectors as cs

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from backend.geography import inside_bolivia
OUT = ROOT / 'data/processed'
RAW = ROOT / 'data/raw/firms'
BASELINE_YEAR = 2024
# producto FIRMS (prefijo de la carpeta DL_FIRE_) -> (familia instrumental, satélite fijo o None si viene en el CSV)
PRODUCTS = {'J1V-C2': ('VIIRS', 'NOAA-20'), 'J2V-C2': ('VIIRS', 'NOAA-21'),
            'M-C61': ('MODIS', None), 'SV-C2': ('VIIRS', 'Suomi NPP')}
# filas esperadas por descarga conocida (control de integridad; las descargas nuevas solo se informan)
EXPECTED = {'J1V-C2_849932': 937638, 'J2V-C2_849933': 911404, 'M-C61_849931': 213817, 'SV-C2_849934': 883940}
REQUIRED = {'latitude','longitude','brightness','scan','track','acq_date','acq_time',
            'satellite','instrument','confidence','version','bright_t31','frp','daynight','type'}

def discover(year):
    """Descargas de archivo que contienen fechas del año pedido: [(clave, sensor, satélite, ruta)]."""
    found = []
    for folder in sorted([*ROOT.glob('DL_FIRE_*'), *RAW.glob('*/DL_FIRE_*')]):
        key = folder.name.removeprefix('DL_FIRE_')
        product = key.rsplit('_', 1)[0]
        if product not in PRODUCTS:
            raise ValueError(f'{folder}: producto FIRMS desconocido {product!r} (esperado: {", ".join(PRODUCTS)})')
        if any(folder.glob('fire_nrt_*.csv')):
            print(f'{folder.name}: se ignora fire_nrt_*.csv (NRT no trae la columna type)', flush=True)
        path = folder / f'fire_archive_{key}.csv'
        if not path.exists():
            continue
        lo, hi = pl.scan_csv(path, schema_overrides={'acq_date': pl.String}).select(
            pl.col('acq_date').min().alias('lo'), pl.col('acq_date').max().alias('hi')).collect().row(0)
        if lo and int(lo[:4]) <= year <= int(hi[:4]):
            found.append((key, *PRODUCTS[product], path))
    products = [s[0].rsplit('_', 1)[0] for s in found]
    if len(set(products)) != len(products):
        raise ValueError(f'{year}: hay más de una descarga del mismo producto: {[s[0] for s in found]}')
    if not found:
        raise SystemExit(f'{year}: no hay descargas FIRMS (poner DL_FIRE_* en {RAW / str(year)})')
    return found

def baseline_q95():
    """q95 por familia instrumental del año base, leído de su manifest."""
    path = OUT / 'manifest.json'
    if path.exists():
        return json.loads(path.read_text(encoding='utf-8'))['index_q95']
    raise SystemExit(f'Construir primero {BASELINE_YEAR}: el índice de otros años usa su base q95')

def build(year=BASELINE_YEAR):
    OUT.mkdir(parents=True, exist_ok=True)
    first, last = date(year,1,1), date(year,12,31)
    sources = discover(year)
    frames = []
    counts = {}
    for key, sensor, satellite, path in sources:
        frame = pl.read_csv(path, schema_overrides={k: pl.String for k in
                            ['acq_date','acq_time','confidence','satellite','instrument','version']})
        if not REQUIRED <= set(frame.columns):
            raise ValueError(f'{path.name}: missing {REQUIRED - set(frame.columns)}')
        # source_row = línea del CSV original, también si la descarga abarca varios años
        frame = frame.with_row_index('source_row', offset=2).filter(pl.col('acq_date').str.starts_with(str(year)))
        counts[key] = frame.height
        expected = EXPECTED.get(key)
        print(f'{key}: {frame.height:,} rows' + (f' (expected {expected:,})' if expected else ''), flush=True)
        frame = frame.with_columns(
            pl.lit(path.relative_to(ROOT).as_posix()).alias('source_file'),
            pl.lit(key).alias('source_id'), pl.lit(sensor).alias('sensor'),
            pl.col('satellite').alias('satellite_original'),
            pl.col('instrument').alias('instrument_original'),
            pl.col('confidence').alias('confidence_original'),
            pl.lit(sensor).alias('instrument'),
            (pl.lit(satellite) if satellite else pl.col('satellite')).alias('satellite'),
            pl.lit('MODIS C6.1' if sensor == 'MODIS' else 'VIIRS C2 375 m').alias('product'),
            pl.lit(1000 if sensor == 'MODIS' else 375).alias('nominal_resolution_m'),
            pl.lit('B21/22 (~4 um); B31 (~11 um)' if sensor == 'MODIS'
                   else 'I4 (~3.74 um); I5 (~11.45 um)').alias('brightness_bands'),
            pl.col('type').cast(pl.Int16),
            pl.col('acq_date').str.to_date().alias('date'),
            pl.col('confidence').cast(pl.Float64, strict=False).alias('confidence_modis'),
        ).with_columns(
            (pl.col('acq_date') + ' ' + pl.col('acq_time').str.zfill(4)).str.strptime(
                pl.Datetime('us', 'UTC'), '%Y-%m-%d %H%M', strict=False).alias('date_utc'),
            (pl.when(pl.col('confidence_modis') >= 80).then(pl.lit('high'))
             .when(pl.col('confidence_modis') >= 30).then(pl.lit('nominal'))
             .when(pl.col('confidence_modis') >= 0).then(pl.lit('low'))
             .otherwise(pl.col('confidence').replace({'l':'low','n':'nominal','h':'high'}))
            ).alias('confidence_class'),
        )
        cells = [h3.latlng_to_cell(lat, lon, 6) if lat is not None and lon is not None
                 and -90 <= lat <= 90 and -180 <= lon <= 180 else None
                 for lat, lon in frame.select('latitude', 'longitude').iter_rows()]
        frame = frame.with_columns(pl.Series('h3_id', cells),
            pl.Series('in_bolivia', inside_bolivia(frame['longitude'].to_numpy(), frame['latitude'].to_numpy()))).with_columns(
            (pl.col('h3_id').is_null() | pl.col('date_utc').is_null() |
             ~pl.col('date').is_between(first, last) |
             ~pl.col('confidence_class').is_in(['low','nominal','high']) |
             pl.col('frp').is_null() | (pl.col('frp') < 0)).fill_null(True).alias('quality_warning'))
        frames.append(frame)
    all_rows = pl.concat(frames, how='diagonal_relaxed').sort(['date','sensor','h3_id'])
    all_rows.write_parquet(OUT / f'hotspots_{year}.parquet', compression='zstd', row_group_size=100000)
    grid = all_rows.group_by(['h3_id','date','sensor','type','confidence_class','in_bolivia']).agg(
        pl.len().alias('detections'), pl.col('frp').sum().alias('frp_sum'),
        pl.col('latitude').first().alias('latitude'), pl.col('longitude').first().alias('longitude'),
        pl.col('quality_warning').sum().alias('quality_warnings'),
        pl.col('source_id').n_unique().alias('sources_with_detections'))
    if year == BASELINE_YEAR:
        baseline = grid.filter((pl.col('type') == 0) & pl.col('in_bolivia') & pl.col('h3_id').is_not_null()).group_by(
            ['h3_id','date','sensor']).agg(pl.col('detections').sum()).group_by('sensor').agg(
            pl.col('detections').quantile(.95, interpolation='linear').alias('q95_count'))
    else:
        q95 = baseline_q95()
        baseline = pl.DataFrame({'sensor': list(q95), 'q95_count': [float(v) for v in q95.values()]})
    grid = grid.join(baseline, on='sensor', how='left').with_columns(
        (pl.col('detections').cast(pl.Float64).log1p() / pl.col('q95_count').log1p()).clip(0,1).alias('exploratory_index'))
    grid.sort(['date','h3_id','sensor']).write_parquet(OUT/f'grid_daily_{year}.parquet', compression='zstd')
    days = pl.DataFrame({'date': pl.date_range(first, last, eager=True)})
    observed = all_rows.group_by(['source_id','date']).agg(
        pl.len().alias('detections'), (pl.col('type') == 0).sum().alias('vegetation_detections'),
        pl.col('quality_warning').sum().alias('quality_warnings'),
        pl.col('h3_id').is_null().sum().alias('invalid_coordinates'),
        pl.col('date_utc').is_null().sum().alias('invalid_datetime'),
        (pl.col('frp') == 0).sum().alias('zero_frp'))
    quality = days.join(pl.DataFrame({'source_id':[s[0] for s in sources]}), how='cross').join(
        observed, on=['date','source_id'], how='left').with_columns(
        cs.integer().fill_null(0), pl.lit('unknown').alias('satellite_coverage'),
        pl.lit('Archive detections only; no swath/cloud/overpass coverage supplied').alias('coverage_note')
    ).with_columns(pl.when(pl.col('detections') > 0).then(pl.lit('detections_present')).otherwise(
        pl.lit('no_detections_in_archive_coverage_unknown')).alias('availability'))
    quality.sort(['date','source_id']).write_parquet(OUT/f'source_quality_{year}.parquet', compression='zstd')
    manifest = {'year':year, 'records':all_rows.height, 'inside_bolivia':int(all_rows['in_bolivia'].sum()),
                'outside_bolivia':int((~all_rows['in_bolivia']).sum()),
                'boundary':'Natural Earth 1:10m Admin 0; point-in-polygon incl. boundary; canonical rows retained',
                'sources':counts, 'quality_warnings':int(all_rows['quality_warning'].sum()),
                'index_q95':dict(baseline.iter_rows()), 'index_baseline_year':BASELINE_YEAR, 'h3_resolution':6,
                'bounds':all_rows.select(pl.col('longitude').min().alias('west'),pl.col('latitude').min().alias('south'),
                    pl.col('longitude').max().alias('east'),pl.col('latitude').max().alias('north')).row(0)}
    # 2024 conserva su nombre histórico (manifest.json, versionado); los demás años, manifest_<año>.json
    name = 'manifest.json' if year == BASELINE_YEAR else f'manifest_{year}.json'
    (OUT/name).write_text(json.dumps(manifest, indent=2), encoding='utf-8')
    print(json.dumps(manifest), flush=True)

if __name__ == '__main__':
    for y in sorted({int(a) for a in sys.argv[1:]} or {BASELINE_YEAR}):
        build(y)
