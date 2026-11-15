"""Build the complete 2024 FIRMS archive. Run from any working directory."""
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
SOURCES = [('J1V-C2_849932', 'VIIRS', 'NOAA-20', 937638),
           ('J2V-C2_849933', 'VIIRS', 'NOAA-21', 911404),
           ('M-C61_849931', 'MODIS', None, 213817),
           ('SV-C2_849934', 'VIIRS', 'Suomi NPP', 883940)]
REQUIRED = {'latitude','longitude','brightness','scan','track','acq_date','acq_time',
            'satellite','instrument','confidence','version','bright_t31','frp','daynight','type'}

def build():
    OUT.mkdir(parents=True, exist_ok=True)
    frames = []
    counts = {}
    for key, sensor, satellite, expected in SOURCES:
        path = ROOT / f'DL_FIRE_{key}' / f'fire_archive_{key}.csv'
        frame = pl.read_csv(path, schema_overrides={k: pl.String for k in
                            ['acq_date','acq_time','confidence','satellite','instrument','version']})
        if not REQUIRED <= set(frame.columns):
            raise ValueError(f'{path.name}: missing {REQUIRED - set(frame.columns)}')
        counts[key] = frame.height
        print(f'{key}: {frame.height:,} rows (expected {expected:,})', flush=True)
        frame = frame.with_row_index('source_row', offset=2).with_columns(
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
             ~pl.col('date').is_between(date(2024,1,1), date(2024,12,31)) |
             ~pl.col('confidence_class').is_in(['low','nominal','high']) |
             pl.col('frp').is_null() | (pl.col('frp') < 0)).fill_null(True).alias('quality_warning'))
        frames.append(frame)
    all_rows = pl.concat(frames, how='diagonal_relaxed').sort(['date','sensor','h3_id'])
    all_rows.write_parquet(OUT / 'hotspots_2024.parquet', compression='zstd', row_group_size=100000)
    grid = all_rows.group_by(['h3_id','date','sensor','type','confidence_class','in_bolivia']).agg(
        pl.len().alias('detections'), pl.col('frp').sum().alias('frp_sum'),
        pl.col('latitude').first().alias('latitude'), pl.col('longitude').first().alias('longitude'),
        pl.col('quality_warning').sum().alias('quality_warnings'),
        pl.col('source_id').n_unique().alias('sources_with_detections'))
    baseline = grid.filter((pl.col('type') == 0) & pl.col('in_bolivia') & pl.col('h3_id').is_not_null()).group_by(
        ['h3_id','date','sensor']).agg(pl.col('detections').sum()).group_by('sensor').agg(
        pl.col('detections').quantile(.95, interpolation='linear').alias('q95_count'))
    grid = grid.join(baseline, on='sensor', how='left').with_columns(
        (pl.col('detections').cast(pl.Float64).log1p() / pl.col('q95_count').log1p()).clip(0,1).alias('exploratory_index'))
    grid.sort(['date','h3_id','sensor']).write_parquet(OUT/'grid_daily_2024.parquet', compression='zstd')
    days = pl.DataFrame({'date': pl.date_range(date(2024,1,1),date(2024,12,31), eager=True)})
    observed = all_rows.group_by(['source_id','date']).agg(
        pl.len().alias('detections'), (pl.col('type') == 0).sum().alias('vegetation_detections'),
        pl.col('quality_warning').sum().alias('quality_warnings'),
        pl.col('h3_id').is_null().sum().alias('invalid_coordinates'),
        pl.col('date_utc').is_null().sum().alias('invalid_datetime'),
        (pl.col('frp') == 0).sum().alias('zero_frp'))
    quality = days.join(pl.DataFrame({'source_id':[s[0] for s in SOURCES]}), how='cross').join(
        observed, on=['date','source_id'], how='left').with_columns(
        cs.integer().fill_null(0), pl.lit('unknown').alias('satellite_coverage'),
        pl.lit('Archive detections only; no swath/cloud/overpass coverage supplied').alias('coverage_note')
    ).with_columns(pl.when(pl.col('detections') > 0).then(pl.lit('detections_present')).otherwise(
        pl.lit('no_detections_in_archive_coverage_unknown')).alias('availability'))
    quality.sort(['date','source_id']).write_parquet(OUT/'source_quality_2024.parquet', compression='zstd')
    manifest = {'records':all_rows.height, 'inside_bolivia':int(all_rows['in_bolivia'].sum()),
                'outside_bolivia':int((~all_rows['in_bolivia']).sum()),
                'boundary':'Natural Earth 1:10m Admin 0; point-in-polygon incl. boundary; canonical rows retained',
                'sources':counts, 'quality_warnings':int(all_rows['quality_warning'].sum()),
                'index_q95':dict(baseline.iter_rows()), 'h3_resolution':6,
                'bounds':all_rows.select(pl.col('longitude').min().alias('west'),pl.col('latitude').min().alias('south'),
                    pl.col('longitude').max().alias('east'),pl.col('latitude').max().alias('north')).row(0)}
    (OUT/'manifest.json').write_text(json.dumps(manifest, indent=2), encoding='utf-8')
    print(json.dumps(manifest), flush=True)

if __name__ == '__main__':
    build()
