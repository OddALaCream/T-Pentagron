"""Exporta el Modelo A (armonización MODIS -> VIIRS S-NPP) a un artefacto liviano para el backend, sin lightgbm.

Uso:  python -m firesight.export_harmonization [DIR_SALIDA]        (por defecto data/models/)

Lee los cubos diarios de la zona piloto y les aplica el armonizador guardado:
  2001-2011  data/firesight_early/processed     solo MODIS (VIIRS S-NPP empieza en 2012)
  2012-2017  data/firesight_holdout/processed   validación externa
  2018-2025  data/firesight/processed           entrenamiento, validación (2024) y prueba (2025)
Para crear el cubo 2001-2011:
  FIRESIGHT_DATA=data/firesight_early FIRESIGHT_YEARS=2001-2011 python -m firesight.fetch      (y luego index_h3)

Salidas en DIR_SALIDA (todas las celdas de la zona; el backend se queda con las que tocan Bolivia):
  harmonization_{2024,2025}.parquet   por celda y día: MODIS crudo, VIIRS S-NPP observado, MODIS armonizado
                                      (VIIRS-equivalente), incertidumbre heurística y método
  harmonization_monthly.parquet       por celda y mes, 2001-2025: sumas de lo anterior y días con cada sensor
  harmonization_card.json             versión, periodos, métricas de validación y avisos
Un sensor no operativo ese día queda como nulo (no es cero). MODIS armonizado existe aunque MODIS cuente 0:
es lo que VIIRS habría visto en promedio (VIIRS detecta fuegos chicos que MODIS no ve).
"""
import json
import sys
from pathlib import Path

import firesight  # noqa: F401  (sklearn antes que lightgbm en ARM)
import joblib
import numpy as np
import pandas as pd

from . import harmonize as HM
from .common import load_cube
from .config import HARMONIZER_VERSION, METRICS, MODELS, ROOT, SERVING, VIIRS_FIRST_YEAR

SOURCES = [("2001-2011", ROOT / "data" / "firesight_early" / "processed"),
           ("2012-2017", ROOT / "data" / "firesight_holdout" / "processed"),
           ("2018-2025", ROOT / "data" / "firesight" / "processed")]
DAILY_YEARS = (2024, 2025)
AQUA_FIRST_DAY = "2002-07-04"   # antes solo Terra: MODIS ve menos y el armonizador lo subestima


def harmonize_cube(processed, H):
    """(cells, dates, M, V, eq, unc, method) con NaN donde el sensor no operó."""
    cube, cells = load_cube(processed)
    F = HM.build_features(cube, cells)
    n, T = cube["modis_count"].shape
    eq, unc, method = HM.apply_harmonizer(F, H, n, T)
    ma = np.broadcast_to(cube["modis_avail"], (n, T))
    va = np.broadcast_to(cube["viirs_avail"], (n, T))
    nan = np.float32(np.nan)
    M = np.where(ma, cube["modis_count"], nan).astype(np.float32)
    V = np.where(va, cube["viirs_count"], nan).astype(np.float32)
    eq = np.where(ma, eq, nan).astype(np.float32)
    unc = np.where(ma, unc, nan).astype(np.float32)
    method = np.where(ma, method, "missing")
    return cells, pd.DatetimeIndex(cube["dates"]), M, V, eq, unc, method


def monthly(cells, dates, M, V, eq, unc):
    """Suma por celda y mes; la incertidumbre se suma como varianza (celdas-día independientes)."""
    month = dates.to_period("M")
    out = []
    for m in month.unique():
        c = np.flatnonzero(month == m)
        out.append(pd.DataFrame({
            "h3_id": cells.h3_id.to_numpy(), "month": m.to_timestamp().date(),
            "modis_count": np.nansum(M[:, c], 1), "modis_viirs_eq": np.nansum(eq[:, c], 1),
            "variance": np.nansum(unc[:, c] ** 2, 1), "viirs_snpp_count": np.nansum(V[:, c], 1),
            "modis_days": np.isfinite(M[:, c]).sum(1).astype(np.int16),
            "viirs_days": np.isfinite(V[:, c]).sum(1).astype(np.int16)}))
    df = pd.concat(out, ignore_index=True)
    df.loc[df.viirs_days == 0, "viirs_snpp_count"] = np.nan    # sin VIIRS ese mes (antes de 2012)
    df.loc[df.modis_days == 0, ["modis_count", "modis_viirs_eq", "variance"]] = np.nan
    return df


def main(out=SERVING):
    out = Path(out)
    out.mkdir(parents=True, exist_ok=True)
    H = joblib.load(MODELS / "harmonizer.joblib")
    months, ref_cells, periods = [], None, {}
    for label, processed in SOURCES:
        if not (processed / "cube.npz").exists():
            raise SystemExit(f"Falta {processed}/cube.npz (ver la ayuda de este módulo)")
        cells, dates, M, V, eq, unc, method = harmonize_cube(processed, H)
        if ref_cells is None:
            ref_cells = cells.h3_id.tolist()
        if cells.h3_id.tolist() != ref_cells:
            raise SystemExit(f"{processed}: las celdas no coinciden con las de {SOURCES[0][1]}")
        months.append(monthly(cells, dates, M, V, eq, unc))
        periods[label] = {"start": str(dates[0].date()), "end": str(dates[-1].date()),
                          "converted_cell_days": int(((method != "viirs_observed") & (method != "missing")).sum())}
        print(f"[A] {label}: {len(cells):,} celdas x {len(dates):,} días")
        for y in DAILY_YEARS:
            cols = np.flatnonzero(dates.year == y)
            if not len(cols):
                continue
            n = len(cells)
            meth = method[:, cols]
            df = pd.DataFrame({
                "h3_id": pd.Categorical(np.repeat(cells.h3_id.to_numpy(), len(cols))),
                "date": np.tile(dates[cols].date, n),
                "modis_count": M[:, cols].ravel(), "viirs_snpp_count": V[:, cols].ravel(),
                "modis_viirs_eq": eq[:, cols].ravel(), "uncertainty": unc[:, cols].ravel(),
                # método del armonizador; con VIIRS operativo el registro armonizado usa VIIRS observado
                "method": pd.Categorical(np.where(np.isfinite(V[:, cols]), "viirs_observed", meth).ravel()),
            })
            df.to_parquet(out / f"harmonization_{y}.parquet", index=False, compression="zstd")
            print(f"[A] harmonization_{y}.parquet: {len(df):,} filas")
    mo = pd.concat(months, ignore_index=True).sort_values(["month", "h3_id"])
    if mo.duplicated(["h3_id", "month"]).any():
        raise SystemExit("Meses repetidos entre cubos: revisar FIRESIGHT_YEARS de cada fuente")
    mo.to_parquet(out / "harmonization_monthly.parquet", index=False, compression="zstd")
    metrics = json.loads((METRICS / "harmonization_metrics.json").read_text())
    card = {
        "harmonizer_version": HARMONIZER_VERSION, "reference": "VIIRS S-NPP 375 m (un solo satélite)",
        "periods": periods, "daily_years": list(DAILY_YEARS), "viirs_first_year": VIIRS_FIRST_YEAR,
        "aqua_first_day": AQUA_FIRST_DAY, "metrics": metrics,
        "notes": [
            "VIIRS-equivalente = detecciones que VIIRS S-NPP habría registrado según el MODIS de ese día (Modelo A).",
            "La referencia es S-NPP solo. El globo suma tres VIIRS (S-NPP, NOAA-20, NOAA-21), que detectan ~3 veces más: "
            "no son la misma escala.",
            f"Antes de {VIIRS_FIRST_YEAR} no hay VIIRS para comparar: esos años son una extrapolación del modelo "
            "(validado con años no vistos 2013-2017, 2025 y 2026).",
            f"Hasta el {AQUA_FIRST_DAY} solo operaba MODIS Terra; el modelo se entrenó con Terra + Aqua y subestima ese tramo.",
            "La incertidumbre es heurística (ruido Poisson + desacuerdo baseline/LightGBM), no un intervalo calibrado.",
        ],
    }
    (out / "harmonization_card.json").write_text(json.dumps(card, indent=1, ensure_ascii=False, default=float))
    print(f"[A] harmonization_monthly.parquet: {len(mo):,} filas ({mo.month.min()} a {mo.month.max()}) -> {out}")


if __name__ == "__main__":
    main(*(sys.argv[1:2]))
