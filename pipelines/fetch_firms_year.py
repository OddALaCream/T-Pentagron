"""Descarga un año del archivo FIRMS de Bolivia por la Area API, en el mismo formato que las descargas DL_FIRE.

Uso:  FIRMS_MAP_KEY=... python pipelines/fetch_firms_year.py AÑO

Alternativa a pedir el archivo en https://firms.modaps.eosdis.nasa.gov/download/ (que llega por correo).
Baja los cuatro productos del observatorio en Standard Processing (SP), el mismo nivel de procesamiento que el
archivo: MODIS C6.1, VIIRS S-NPP, NOAA-20 y NOAA-21. La Area API recorta por caja, así que se conservan solo las
detecciones dentro del polígono de Bolivia (como el archivo por país). Los nombres de columna de VIIRS se adaptan
al formato del archivo (bright_ti4 -> brightness, bright_ti5 -> bright_t31).

Salida: data/raw/firms/<año>/DL_FIRE_<producto>_api<año>/fire_archive_<producto>_api<año>.csv (no se versiona).
Luego: python pipelines/build_dataset.py AÑO
La MAP_KEY se lee de la variable de entorno y nunca se escribe en archivos ni en la salida.
"""
from datetime import date, timedelta
from pathlib import Path
import io
import os
import sys
import time
import urllib.error
import urllib.request

import polars as pl

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from backend.geography import inside_bolivia  # noqa: E402

API = 'https://firms.modaps.eosdis.nasa.gov/api/area/csv/{key}/{source}/{bbox}/{days}/{day}'
BBOX = '-69.7,-22.95,-57.4,-9.6'   # caja de Bolivia; luego se filtra por el polígono
DAYS = 5
PRODUCTS = {'M-C61': 'MODIS_SP', 'SV-C2': 'VIIRS_SNPP_SP', 'J1V-C2': 'VIIRS_NOAA20_SP', 'J2V-C2': 'VIIRS_NOAA21_SP'}
COLUMNS = ['latitude', 'longitude', 'brightness', 'scan', 'track', 'acq_date', 'acq_time', 'satellite', 'instrument',
           'confidence', 'version', 'bright_t31', 'frp', 'daynight', 'type']


def get(url, key):
    for i in range(5):
        try:
            with urllib.request.urlopen(url, timeout=180) as r:
                text = r.read().decode()
            if not text.lower().startswith(('invalid', 'exceeding')):
                return text
            msg = text[:80]
        except (urllib.error.URLError, TimeoutError) as e:
            msg = str(e)
        print(f'  reintento {i + 1}: {msg.replace(key, "MAP_KEY")}', flush=True)
        time.sleep(30 * (i + 1))
    raise RuntimeError('La Area API no respondió')


def fetch(year, product, source, key):
    frames, d, end = [], date(year, 1, 1), date(year, 12, 31)
    while d <= end:
        days = min(DAYS, (end - d).days + 1)
        text = get(API.format(key=key, source=source, bbox=BBOX, days=days, day=d.isoformat()), key)
        if 'latitude' in text[:200]:
            frames.append(pl.read_csv(io.StringIO(text), infer_schema=False))
        d += timedelta(days=days)
    df = pl.concat(frames, how='diagonal_relaxed').rename({'bright_ti4': 'brightness', 'bright_ti5': 'bright_t31'}, strict=False)
    missing = set(COLUMNS) - set(df.columns)
    if missing:
        raise ValueError(f'{source}: faltan columnas {missing}')
    df = df.select(COLUMNS).unique(maintain_order=True).with_columns(pl.col('acq_time').str.zfill(4))
    df = df.filter(pl.col('acq_date').str.starts_with(str(year)))
    lon, lat = df['longitude'].cast(pl.Float64).to_numpy(), df['latitude'].cast(pl.Float64).to_numpy()
    df = df.filter(pl.Series(inside_bolivia(lon, lat))).sort(['acq_date', 'acq_time'])
    tag = f'{product}_api{year}'
    out = ROOT / 'data/raw/firms' / str(year) / f'DL_FIRE_{tag}'
    out.mkdir(parents=True, exist_ok=True)
    df.write_csv(out / f'fire_archive_{tag}.csv')
    (out / 'Readme.txt').write_text(
        f'FIRMS Area API, fuente {source} (Standard Processing), {year}-01-01 a {year}-12-31, caja {BBOX},\n'
        f'filtrado al polígono de Bolivia (Natural Earth 1:10m). Descargado el {date.today()} con '
        f'pipelines/fetch_firms_year.py.\nReadme de los productos: https://firms.modaps.eosdis.nasa.gov/download/Readme.txt\n',
        encoding='utf-8')
    print(f'{tag}: {df.height:,} detecciones en Bolivia', flush=True)


if __name__ == '__main__':
    key = os.environ.get('FIRMS_MAP_KEY', '').strip()
    if not key:
        raise SystemExit('Definir FIRMS_MAP_KEY (https://firms.modaps.eosdis.nasa.gov/api/map_key/)')
    year = int(sys.argv[1])
    for product, source in PRODUCTS.items():
        fetch(year, product, source, key)
