#!/usr/bin/env bash
# Pipeline completo de los modelos FireSight (Modelo A: armonización, Modelo B: predicción t+1).
# Uso, desde la raíz del repo:  bash firesight/run_models.sh
# Requiere Python 3.8–3.13 (ver firesight/requirements.txt). ~300 MB de descargas, ~30 min en 4 núcleos.
# Opcional: FIRMS_MAP_KEY=<clave> para validar con el año en curso (Area API); la clave nunca se guarda.
set -euo pipefail
cd "$(dirname "$0")/.."
PYBIN=${PYTHON:-python3}
if [ ! -d firesight/.venv ]; then "$PYBIN" -m venv firesight/.venv && firesight/.venv/bin/pip install -q -r firesight/requirements.txt; fi
PY=firesight/.venv/bin/python
$PY -m firesight.fetch            # 1. FIRMS (MODIS + VIIRS SNPP) 2018-2025 y NASA POWER → data/firesight/raw
$PY -m firesight.index_h3         # 2. QA + H3 res 6 + cubo diario
$PY -m firesight.harmonize        # 3. Modelo A: MODIS → VIIRS-equivalente (baseline + LightGBM)
$PY -m firesight.predict          # 4. Modelo B: Random Forest t+1 (+ baselines)
$PY -m firesight.oof              # 4b. modelos leave-one-year-out 2018-2023
$PY -m firesight.tests.test_no_leakage
$PY -m firesight.tests.test_integrity
# 5. validación externa con años nunca vistos (2012 solo aporta historial)
FIRESIGHT_DATA=data/firesight_holdout FIRESIGHT_YEARS=2012-2017 $PY -m firesight.fetch
FIRESIGHT_DATA=data/firesight_holdout FIRESIGHT_YEARS=2012-2017 $PY -m firesight.index_h3
$PY -m firesight.evaluate_external data/firesight_holdout/processed 2013-2017
# 6. artefacto liviano que sirve backend/predictions.py (sin sklearn)
$PY -m firesight.export_serving 2024
echo "Listo. Métricas en firesight/metrics/, artefacto en data/models/"
