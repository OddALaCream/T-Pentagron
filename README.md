# T-Pentagron — NASA Space Apps 2026

Observatorio de actividad térmica de Bolivia: NASA FIRMS → Parquet → DuckDB/FastAPI → Next.js.

Este repositorio contiene el proyecto completo y el historial integrado del frontend.
El frontend es una carpeta del proyecto, no un submódulo ni un repositorio independiente.

## Contenido

- `FRONTEND/NasaAppChallenge2026-Frontend/`: globo 3D, H3, calendario y paneles.
- `backend/`: API, dependencias y pruebas de integración.
- `pipelines/`: procesamiento reproducible y metodología.
- `firesight/`: modelos FireSight (A: armonización MODIS→VIIRS; B: predicción experimental t+1). Ver [firesight/README.md](firesight/README.md).
- `data/models/`: predicciones 2024 del Modelo B que sirve la API (sin sklearn).
- `DL_FIRE_*/`: cuatro archivos FIRMS de Bolivia de 2024.
- `data/processed/`: datos canónicos y agregados en Parquet, calidad y manifiesto.
- `dataAnalysis.py` y `dataAnalysis.ipynb`: análisis inicial.

Se conservan 2.946.799 observaciones. La visualización principal usa `type=0`, filtro
por el polígono de Bolivia y un índice exploratorio sin calibración física entre
instrumentos. Una detección no equivale a un incendio único. Cobertura satelital
desconocida. La capa de predicción usa el Modelo B FireSight (Random Forest calibrado):
probabilidad experimental de detección al día siguiente, solo en la zona piloto Chiquitanía.
No es una alerta operativa.

## Ejecutar en PowerShell

Requisitos: Python 3.14, Node.js >=20.9 y npm. Ejecutar desde la raíz del clon.

```powershell
python -m venv backend/.venv
./backend/.venv/Scripts/python.exe -m pip install -r backend/requirements.txt

# Opcional: reconstruir los Parquet incluidos en el repositorio.
./backend/.venv/Scripts/python.exe pipelines/build_dataset.py

# API: mantener esta terminal abierta.
./backend/.venv/Scripts/python.exe -m uvicorn backend.main:app --reload --port 8000
```

En otra terminal, desde la raíz:

```powershell
Set-Location FRONTEND/NasaAppChallenge2026-Frontend
Copy-Item .env.example .env.local
npm ci
npm run dev
```

Abrir http://localhost:3000/?date=2024-09-06. Swagger: http://localhost:8000/docs.
El ejemplo de configuración usa datos reales de la API; `mock` es un modo independiente.
Las teselas externas requieren conexión; pueden desactivarse en `.env.local`.

## Verificar

```powershell
# Desde la raíz:
./backend/.venv/Scripts/python.exe -m unittest backend.test_integration backend.test_predictions -v

Set-Location FRONTEND/NasaAppChallenge2026-Frontend
npm run lint
npm run typecheck
npm run build
```

Metodología de datos: [pipelines/README.md](pipelines/README.md).
Modelos, métricas y reentrenamiento: [firesight/README.md](firesight/README.md)
(`bash firesight/run_models.sh`; entorno aparte en `firesight/requirements.txt`).
Si el frontend corre en otro puerto: `CORS_ORIGINS=http://localhost:3010` al lanzar uvicorn.
Frontera cartográfica: Natural Earth 1:10m, dominio público; no es un deslinde legal.
