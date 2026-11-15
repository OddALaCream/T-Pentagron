"""Etapa 1 (mínima para los modelos): descarga FIRMS (MODIS C6.1 + VIIRS S-NPP) y NASA POWER.

- Los CSV anuales de FIRMS por país se guardan intactos en data/raw/firms_country/.
- modis_raw.csv / viirs_raw.csv: recorte a la AOI + metadatos de procedencia (sin otro cambio).
- power_daily.parquet: series diarias NASA POWER en puntos de una grilla de 0.5° sobre la AOI.
"""
import datetime as dt
import io
import os
import time

import numpy as np
import pandas as pd
import requests

from .config import (AOI, FIRMS_COUNTRY, FIRMS_SOURCES, FIRMS_URL, POWER_PARAMS, POWER_STEP,
                     POWER_URL, RAW, YEARS)

BUF = 0.1  # pequeño margen para no perder celdas H3 del borde


def _download(url, dest, retries=3):
    if dest.exists() and dest.stat().st_size > 0:
        return dest
    for i in range(retries):
        try:
            with requests.get(url, stream=True, timeout=120) as r:
                r.raise_for_status()
                tmp = dest.with_suffix(".part")
                with open(tmp, "wb") as f:
                    for chunk in r.iter_content(1 << 20):
                        f.write(chunk)
                tmp.rename(dest)
            return dest
        except Exception as e:  # noqa: BLE001
            print(f"  reintento {i + 1}/{retries} {url}: {e}")
            time.sleep(5 * (i + 1))
    raise RuntimeError(f"No se pudo descargar {url}")


# --- Año en curso (sin archivo por país): FIRMS Area API con MAP_KEY (variable de entorno FIRMS_MAP_KEY)
AREA_API = "https://firms.modaps.eosdis.nasa.gov/api/area/csv/{key}/{source}/{bbox}/{days}/{date}"
AVAIL_API = "https://firms.modaps.eosdis.nasa.gov/api/data_availability/csv/{key}/ALL"
API_SOURCES = {"modis": ("MODIS_SP", "MODIS_NRT"), "viirs-snpp": ("VIIRS_SNPP_SP", "VIIRS_SNPP_NRT")}
BOLIVIA_BBOX = "-69.7,-22.95,-57.4,-9.6"   # caja de Bolivia (también sirve para el proxy de operatividad)
API_DAYS = 5


def _fetch_area_year(src, year, dest, key):
    """Construye un CSV equivalente al archivo anual por país usando la Area API (SP si existe, si no NRT)."""
    av = pd.read_csv(io.StringIO(requests.get(AVAIL_API.format(key=key), timeout=60).text))
    sp, nrt = API_SOURCES[src]
    sp_max = pd.to_datetime(av.loc[av.data_id == sp, "max_date"]).max()
    start = dt.date(year, 1, 1)
    end = min(dt.date(year, 12, 31), dt.date.today() - dt.timedelta(days=1))
    frames, d = [], start
    while d <= end:
        if pd.notna(sp_max) and pd.Timestamp(d) <= sp_max:   # SP hasta su última fecha, sin cruzarla
            source, ndays = sp, min(API_DAYS, (sp_max.date() - d).days + 1)
        else:
            source, ndays = nrt, API_DAYS
        url = AREA_API.format(key=key, source=source, bbox=BOLIVIA_BBOX, days=ndays, date=d.isoformat())
        for i in range(4):
            r = requests.get(url, timeout=120)
            if r.status_code == 200 and not r.text.lower().startswith(("invalid", "exceeding")):
                break
            print(f"  reintento {i + 1} {source} {d}: {r.status_code} {r.text[:80]}")
            time.sleep(30 * (i + 1))
        else:
            raise RuntimeError(f"Area API falló en {d}: {r.text[:200]}")
        if r.text.strip() and "latitude" in r.text[:200]:
            frames.append(pd.read_csv(io.StringIO(r.text), dtype={"acq_time": str, "confidence": str, "version": str}))
        d += dt.timedelta(days=ndays)
    df = pd.concat(frames, ignore_index=True).drop_duplicates()
    df["acq_time"] = df["acq_time"].str.zfill(4)
    df = df[pd.to_datetime(df.acq_date).dt.year == year]
    df.to_csv(dest, index=False)
    print(f"  Area API {src} {year}: {len(df):,} detecciones ({start}..{end}; SP hasta {sp_max})")
    return AREA_API.format(key="MAP_KEY", source=f"{sp}|{nrt}", bbox=BOLIVIA_BBOX, days=API_DAYS, date=f"{year}")


def fetch_firms():
    today = dt.date.today().isoformat()
    for sensor, src in FIRMS_SOURCES.items():
        parts = []
        for y in YEARS:
            url = FIRMS_URL.format(src=src, year=y)
            dest = FIRMS_COUNTRY / f"{src}_{y}_Bolivia.csv"
            print(f"[FIRMS] {sensor} {y}")
            try:
                _download(url, dest)
            except RuntimeError:
                key = os.environ.get("FIRMS_MAP_KEY")
                if not key:
                    raise RuntimeError(f"{y}: no hay archivo por país (año en curso). Defina FIRMS_MAP_KEY "
                                       "para usar la Area API: https://firms.modaps.eosdis.nasa.gov/api/map_key/")
                url = _fetch_area_year(src, y, dest, key)   # la clave nunca se guarda en los datos
            df = pd.read_csv(dest, dtype={"acq_time": str, "confidence": str, "version": str})
            df["country_detections_on_day"] = df.groupby("acq_date")["latitude"].transform("size")
            m = ((df.latitude.between(AOI["lat_min"] - BUF, AOI["lat_max"] + BUF))
                 & (df.longitude.between(AOI["lon_min"] - BUF, AOI["lon_max"] + BUF)))
            sub = df[m].copy()
            sub["sensor"] = sensor
            sub["source_file"] = dest.name
            sub["source_url"] = url
            sub["download_date"] = today
            parts.append(sub)
            # registro de días con datos del sensor en todo el país (proxy de operatividad)
            days = df.groupby("acq_date").size().rename("n_country").reset_index()
            days["sensor"] = sensor
            parts_days.append(days)
        out = pd.concat(parts, ignore_index=True)
        out.to_csv(RAW / f"{sensor.lower()}_raw.csv", index=False)
        print(f"  -> {sensor.lower()}_raw.csv: {len(out):,} detecciones en AOI")


parts_days = []


def fetch_power():
    lats = np.arange(AOI["lat_min"] + POWER_STEP / 2, AOI["lat_max"], POWER_STEP)
    lons = np.arange(AOI["lon_min"] + POWER_STEP / 2, AOI["lon_max"], POWER_STEP)
    dest = RAW / "power_daily.parquet"
    if dest.exists():
        print("[POWER] ya existe", dest.name)
        return
    last = min(dt.date(YEARS[-1], 12, 31), dt.date.today() - dt.timedelta(days=2))
    start, end = f"{YEARS[0]}0101", last.strftime("%Y%m%d")
    frames = []
    for la in lats:
        for lo in lons:
            print(f"[POWER] {la:.2f},{lo:.2f}")
            params = {"parameters": ",".join(POWER_PARAMS), "community": "AG", "latitude": round(la, 3),
                      "longitude": round(lo, 3), "start": start, "end": end, "format": "JSON"}
            for i in range(4):
                try:
                    r = requests.get(POWER_URL, params=params, timeout=180)
                    r.raise_for_status()
                    break
                except Exception as e:  # noqa: BLE001
                    print("  reintento", i + 1, e)
                    time.sleep(10 * (i + 1))
            else:
                raise RuntimeError("POWER no respondió")
            p = r.json()["properties"]["parameter"]
            df = pd.DataFrame(p)
            df.index = pd.to_datetime(df.index, format="%Y%m%d")
            df = df.replace(-999.0, np.nan)
            df["power_lat"], df["power_lon"] = round(la, 3), round(lo, 3)
            frames.append(df.rename_axis("date").reset_index())
    pd.concat(frames, ignore_index=True).to_parquet(dest, index=False)
    print("  -> power_daily.parquet")


def main():
    parts_days.clear()
    fetch_firms()
    if parts_days:
        pd.concat(parts_days, ignore_index=True).to_csv(RAW / "sensor_days_country.csv", index=False)
    fetch_power()


if __name__ == "__main__":
    main()
