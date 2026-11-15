"""Configuración compartida de FireSight (modelos de armonización y predicción)."""
import os
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
# FIRESIGHT_DATA / FIRESIGHT_YEARS permiten construir conjuntos de evaluación externos sin tocar los de entrenamiento
# Todo lo generado por el pipeline de modelos vive en data/firesight/ (ignorado por git), separado de
# data/processed/ del observatorio. El artefacto liviano que sirve el backend va en data/models/.
DATA = Path(os.environ.get("FIRESIGHT_DATA", ROOT / "data" / "firesight"))
RAW = DATA / "raw"
FIRMS_COUNTRY = RAW / "firms_country"   # CSV originales intactos, tal como los publica FIRMS
PROCESSED = DATA / "processed"
MODELS = ROOT / "data" / "firesight" / "models"   # modelos entrenados (~400 MB, no se versionan)
METRICS = ROOT / "firesight" / "metrics"          # métricas (pequeñas, versionadas)
SERVING = ROOT / "data" / "models"                # artefacto que lee backend/predictions.py

for _p in (RAW, FIRMS_COUNTRY, PROCESSED, MODELS, METRICS):
    _p.mkdir(parents=True, exist_ok=True)

# Zona piloto: Chiquitanía (Santa Cruz, Bolivia). Caja lat/lon aproximada.
AOI = {"lat_min": -18.5, "lat_max": -15.5, "lon_min": -62.5, "lon_max": -58.5}
H3_RES = 6

_y = os.environ.get("FIRESIGHT_YEARS")  # p.ej. "2012-2017"
YEARS = (list(range(int(_y.split("-")[0]), int(_y.split("-")[1]) + 1)) if _y
         else list(range(2018, 2026)))   # 2018..2025
TRAIN_YEARS = list(range(2018, 2024))     # 2018-2023 entrenamiento
VAL_YEARS = [2024]                        # validación (selección de pesos / umbrales / calibración)
TEST_YEARS = [2025]                       # prueba: solo se usa para reportar

# Fuentes FIRMS (archivo anual por país, Standard Processing cuando está disponible)
FIRMS_SOURCES = {"MODIS": "modis", "VIIRS": "viirs-snpp"}
FIRMS_URL = "https://firms.modaps.eosdis.nasa.gov/data/country/{src}/{year}/{src}_{year}_Bolivia.csv"

# NASA POWER (diario). Grilla ~0.5°, más gruesa que H3 res 6.
POWER_URL = "https://power.larc.nasa.gov/api/temporal/daily/point"
POWER_PARAMS = ["PRECTOTCORR", "T2M_MAX", "RH2M", "WS2M", "CLOUD_AMT"]
POWER_STEP = 0.5

# QA de detecciones
MODIS_MIN_CONF = 30          # MODIS: confianza 0-100; < 30 = baja
VIIRS_DROP_CONF = {"l"}      # VIIRS: l / n / h; se descarta 'l'
KEEP_TYPES = {0}             # 0 = presunto incendio de vegetación (excluye volcán / fuente estática / offshore)

HARMONIZER_VERSION = "harm-1.0.0"
PREDICTOR_VERSION = "pred-1.0.0"
SEED = 42
