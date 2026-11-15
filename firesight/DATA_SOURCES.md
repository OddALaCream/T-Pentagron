# FireSight — Fuentes de datos para los modelos

Todo se descarga automáticamente con `python -m firesight.fetch` (o `bash firesight/run_models.sh`).
**No se necesita MAP_KEY**: los archivos anuales por país de FIRMS son públicos.

## 1. NASA FIRMS — archivos anuales por país (Bolivia)

Patrón: `https://firms.modaps.eosdis.nasa.gov/data/country/{fuente}/{año}/{fuente}_{año}_Bolivia.csv`

| Sensor | Fuente | Producto | Enlaces |
|---|---|---|---|
| MODIS (Terra + Aqua) | `modis` | MCD14 C6.1, ~1 km | [2018](https://firms.modaps.eosdis.nasa.gov/data/country/modis/2018/modis_2018_Bolivia.csv) · [2019](https://firms.modaps.eosdis.nasa.gov/data/country/modis/2019/modis_2019_Bolivia.csv) · [2020](https://firms.modaps.eosdis.nasa.gov/data/country/modis/2020/modis_2020_Bolivia.csv) · [2021](https://firms.modaps.eosdis.nasa.gov/data/country/modis/2021/modis_2021_Bolivia.csv) · [2022](https://firms.modaps.eosdis.nasa.gov/data/country/modis/2022/modis_2022_Bolivia.csv) · [2023](https://firms.modaps.eosdis.nasa.gov/data/country/modis/2023/modis_2023_Bolivia.csv) · [2024](https://firms.modaps.eosdis.nasa.gov/data/country/modis/2024/modis_2024_Bolivia.csv) · [2025](https://firms.modaps.eosdis.nasa.gov/data/country/modis/2025/modis_2025_Bolivia.csv) |
| VIIRS S-NPP | `viirs-snpp` | VNP14IMG, ~375 m | [2018](https://firms.modaps.eosdis.nasa.gov/data/country/viirs-snpp/2018/viirs-snpp_2018_Bolivia.csv) · [2019](https://firms.modaps.eosdis.nasa.gov/data/country/viirs-snpp/2019/viirs-snpp_2019_Bolivia.csv) · [2020](https://firms.modaps.eosdis.nasa.gov/data/country/viirs-snpp/2020/viirs-snpp_2020_Bolivia.csv) · [2021](https://firms.modaps.eosdis.nasa.gov/data/country/viirs-snpp/2021/viirs-snpp_2021_Bolivia.csv) · [2022](https://firms.modaps.eosdis.nasa.gov/data/country/viirs-snpp/2022/viirs-snpp_2022_Bolivia.csv) · [2023](https://firms.modaps.eosdis.nasa.gov/data/country/viirs-snpp/2023/viirs-snpp_2023_Bolivia.csv) · [2024](https://firms.modaps.eosdis.nasa.gov/data/country/viirs-snpp/2024/viirs-snpp_2024_Bolivia.csv) · [2025](https://firms.modaps.eosdis.nasa.gov/data/country/viirs-snpp/2025/viirs-snpp_2025_Bolivia.csv) |

Tamaño aproximado: MODIS 4–20 MB/año, VIIRS 11–71 MB/año (2024 fue un año extremo). Total ≈ 300 MB.
Columnas: `latitude, longitude, brightness|bright_ti4, scan, track, acq_date, acq_time (HHMM UTC), satellite, instrument, confidence, version, bright_t31|bright_ti5, frp, daynight, type`.

Notas:
- VIIRS NOAA-20 / NOAA-21 **no** están publicados como archivo por país (404). Para incluirlos usar
  [FIRMS Archive Download](https://firms.modaps.eosdis.nasa.gov/download/) (requiere cuenta Earthdata)
  o la [Area API](https://firms.modaps.eosdis.nasa.gov/api/area/) con un `MAP_KEY` gratuito
  ([solicitar aquí](https://firms.modaps.eosdis.nasa.gov/api/map_key/)). El MVP usa solo S-NPP para que la serie VIIRS sea homogénea.
- Atributos: [MODIS](https://www.earthdata.nasa.gov/data/tools/firms/faq) ·
  [VIIRS 375 m](https://www.earthdata.nasa.gov/data/instruments/viirs/viirs-i-band-375-m-active-fire-data).
- Los años más recientes pueden venir como NRT hasta que FIRMS publique la versión SP; la columna `version` lo indica y se conserva.

## 2. NASA POWER — clima diario

Endpoint: `https://power.larc.nasa.gov/api/temporal/daily/point`
Parámetros: `PRECTOTCORR` (lluvia mm/día), `T2M_MAX` (°C), `RH2M` (%), `WS2M` (m/s), `CLOUD_AMT` (%).
Se consultan los centros de una grilla de 0.5° sobre la AOI (8 × 6 = 48 puntos), 2018-01-01 a 2025-12-31.

Ejemplo de una consulta:
`https://power.larc.nasa.gov/api/temporal/daily/point?parameters=PRECTOTCORR,T2M_MAX,RH2M,WS2M,CLOUD_AMT&community=AG&latitude=-16.25&longitude=-60.25&start=20180101&end=20251231&format=JSON`

Documentación: https://power.larc.nasa.gov/docs/services/api/temporal/daily/

## 3. Área piloto y grilla

- AOI Chiquitanía: lat −18.5 a −15.5, lon −62.5 a −58.5 (`firesight/config.py`).
- H3 resolución 6 (~36 km²/celda) — https://h3geo.org/docs/

## Entrenar en otra máquina

```bash
git clone https://github.com/OddALaCream/T-Pentagron && cd T-Pentagron
bash firesight/run_models.sh
```
Requisitos: Python 3.8–3.13, ~4 GB de RAM libre, ~1 GB de disco. Todos los pasos son idempotentes
(si los CSV ya están en `data/firesight/raw/firms_country/`, no se vuelven a descargar).
