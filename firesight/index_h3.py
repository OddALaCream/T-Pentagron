"""QA + asignación H3 + cubo diario celda x día por sensor.

Salidas (data/processed/):
  detections_indexed.parquet  una fila = detección (con procedencia y versión)
  cells.parquet / cells.geojson  celdas H3 res 6 de la AOI
  cube.npz                     arrays densos (n_celdas, n_días) para armonización y features
"""
import json

import h3
import numpy as np
import pandas as pd

from .config import (AOI, H3_RES, KEEP_TYPES, MODIS_MIN_CONF, POWER_STEP, PROCESSED, RAW,
                     VIIRS_DROP_CONF, YEARS)


def load_detections():
    frames = []
    for sensor in ("MODIS", "VIIRS"):
        df = pd.read_csv(RAW / f"{sensor.lower()}_raw.csv",
                         dtype={"acq_time": str, "confidence": str, "version": str})
        n0 = len(df)
        if "type" in df.columns:   # NRT no trae 'type' (NaN): se conserva, no se puede filtrar
            df = df[df["type"].isin(KEEP_TYPES) | df["type"].isna()]
        if sensor == "MODIS":
            conf = pd.to_numeric(df["confidence"], errors="coerce")
            df = df[conf >= MODIS_MIN_CONF].copy()
            df["confidence_num"] = conf[df.index]
        else:
            df = df[~df["confidence"].str.lower().isin(VIIRS_DROP_CONF)].copy()
            df["confidence_num"] = df["confidence"].str.lower().map({"n": 50, "h": 90})
        print(f"[QA] {sensor}: {n0:,} -> {len(df):,}")
        t = df["acq_time"].str.zfill(4)
        df["datetime_utc"] = pd.to_datetime(df["acq_date"] + " " + t.str[:2] + ":" + t.str[2:], utc=True)
        df["date_utc"] = pd.to_datetime(df["acq_date"])
        frames.append(df)
    det = pd.concat(frames, ignore_index=True)
    det["h3_id"] = [h3.latlng_to_cell(a, b, H3_RES) for a, b in zip(det.latitude, det.longitude)]
    return det


def build_cells():
    a = AOI
    poly = h3.LatLngPoly([(a["lat_min"], a["lon_min"]), (a["lat_min"], a["lon_max"]),
                          (a["lat_max"], a["lon_max"]), (a["lat_max"], a["lon_min"])])
    ids = sorted(h3.polygon_to_cells(poly, H3_RES))
    cen = np.array([h3.cell_to_latlng(c) for c in ids])
    cells = pd.DataFrame({"h3_id": ids, "lat": cen[:, 0], "lon": cen[:, 1]})
    cells["zone_h3_res3"] = [h3.cell_to_parent(c, 3) for c in ids]
    # punto NASA POWER más cercano (grilla 0.5° centrada en la AOI)
    nlat = int(round((a["lat_max"] - a["lat_min"]) / POWER_STEP))
    nlon = int(round((a["lon_max"] - a["lon_min"]) / POWER_STEP))
    i = np.clip(((cells.lat - a["lat_min"]) / POWER_STEP).astype(int), 0, nlat - 1)
    j = np.clip(((cells.lon - a["lon_min"]) / POWER_STEP).astype(int), 0, nlon - 1)
    cells["power_lat"] = np.round(a["lat_min"] + POWER_STEP / 2 + i * POWER_STEP, 3)
    cells["power_lon"] = np.round(a["lon_min"] + POWER_STEP / 2 + j * POWER_STEP, 3)
    return cells


def neighbor_index(cells, k=1):
    pos = {c: n for n, c in enumerate(cells.h3_id)}
    out = np.full((len(cells), 6 * k), -1, dtype=np.int32)
    for n, c in enumerate(cells.h3_id):
        nb = [pos[x] for x in h3.grid_ring(c, k) if x in pos]
        out[n, :len(nb)] = nb
    return out


def sensor_availability(dates):
    """Proxy de operatividad: el sensor tiene alguna detección en Bolivia en d-1..d+1.

    Es metadato de la etiqueta / del registro, no se usa como feature. No modela nubes ni
    geometría de barrido (limitación documentada)."""
    sd = pd.read_csv(RAW / "sensor_days_country.csv", parse_dates=["acq_date"])
    av = {}
    for s in ("MODIS", "VIIRS"):
        days = set(sd.loc[sd.sensor == s, "acq_date"])
        has = np.array([d in days for d in dates])
        win = has.copy()
        win[1:] |= has[:-1]
        win[:-1] |= has[1:]
        av[s] = win
    return av


def main():
    det = load_detections()
    cells = build_cells()
    cpos = pd.Series(np.arange(len(cells)), index=cells.h3_id)
    det = det[det.h3_id.isin(cpos.index)].copy()
    cols = ["h3_id", "date_utc", "datetime_utc", "sensor", "satellite", "instrument", "version", "frp",
            "confidence", "confidence_num", "daynight", "latitude", "longitude", "source_file", "download_date"]
    det[[c for c in cols if c in det.columns]].to_parquet(PROCESSED / "detections_indexed.parquet", index=False)
    print(f"[H3] {len(cells):,} celdas, {len(det):,} detecciones en AOI")

    dates = pd.date_range(f"{YEARS[0]}-01-01", f"{YEARS[-1]}-12-31", freq="D")
    dpos = pd.Series(np.arange(len(dates)), index=dates)
    shape = (len(cells), len(dates))
    cube = {}
    for s in ("MODIS", "VIIRS"):
        d = det[det.sensor == s]
        ci, ti = cpos[d.h3_id].to_numpy(), dpos[d.date_utc].to_numpy()
        p = s.lower()
        for name, w in [("count", np.ones(len(d))), ("frp_sum", d.frp.fillna(0).to_numpy()),
                        ("conf_sum", d.confidence_num.fillna(0).to_numpy()),
                        ("night", (d.daynight == "N").to_numpy().astype(float))]:
            arr = np.zeros(shape, dtype=np.float32)
            np.add.at(arr, (ci, ti), w)
            cube[f"{p}_{name}"] = arr
        mx = np.zeros(shape, dtype=np.float32)
        np.maximum.at(mx, (ci, ti), d.frp.fillna(0).to_numpy())
        cube[f"{p}_frp_max"] = mx
    av = sensor_availability(dates)
    cube["modis_avail"], cube["viirs_avail"] = av["MODIS"], av["VIIRS"]

    # clima NASA POWER -> (n_celdas, n_días) por variable, vía punto más cercano
    pw = pd.read_parquet(RAW / "power_daily.parquet")
    pw["key"] = list(zip(pw.power_lat.round(3), pw.power_lon.round(3)))
    keys = list(zip(cells.power_lat, cells.power_lon))
    for var in ("PRECTOTCORR", "T2M_MAX", "RH2M", "WS2M", "CLOUD_AMT"):
        piv = pw.pivot(index="date", columns="key", values=var).reindex(dates).ffill().bfill()
        cube[f"clim_{var.lower()}"] = piv[keys].to_numpy().T.astype(np.float32)

    cube["nbr1"] = neighbor_index(cells, 1)
    cube["dates"] = dates.values.astype("datetime64[D]")
    np.savez_compressed(PROCESSED / "cube.npz", **cube)
    cells.to_parquet(PROCESSED / "cells.parquet", index=False)

    feats = [{"type": "Feature", "properties": {"h3_id": c},
              "geometry": {"type": "Polygon",
                           "coordinates": [[[lo, la] for la, lo in h3.cell_to_boundary(c)]
                                           + [[h3.cell_to_boundary(c)[0][1], h3.cell_to_boundary(c)[0][0]]]]}}
             for c in cells.h3_id]
    (PROCESSED / "cells.geojson").write_text(json.dumps({"type": "FeatureCollection", "features": feats}))
    print("[H3] cube.npz, cells.parquet, cells.geojson, detections_indexed.parquet")


if __name__ == "__main__":
    main()
