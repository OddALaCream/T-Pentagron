# T-Pentagron — NASA Space Apps 2026

Observatorio de actividad térmica de Bolivia: NASA FIRMS → Parquet → DuckDB/FastAPI → Next.js.

Este repositorio contiene el proyecto completo y el historial integrado del frontend.
El frontend es una carpeta del proyecto, no un submódulo ni un repositorio independiente.

## Contenido

- `FRONTEND/NasaAppChallenge2026-Frontend/`: globo 3D, H3, calendario y paneles.
- `backend/`: API, dependencias y pruebas de integración.
- `pipelines/`: procesamiento reproducible y metodología.
- `firesight/`: modelos FireSight (A: armonización MODIS→VIIRS; B: predicción experimental t+1). Ver [firesight/README.md](firesight/README.md).
- `scripts/descargar_datos.py`: baja del release de GitHub los datos que no están en git (2025 y Modelo A).
- `data/models/`: predicciones 2024 del Modelo B que sirve la API (sin sklearn).
- `DL_FIRE_*/`: cuatro archivos FIRMS de Bolivia de 2024.
- `data/processed/`: datos canónicos y agregados en Parquet, calidad y manifiesto.
- `dataAnalysis.py` y `dataAnalysis.ipynb`: análisis inicial.

Se conservan 2.946.799 observaciones de 2024 y 454.473 de 2025. La visualización principal usa `type=0`,
filtro por el polígono de Bolivia y un índice exploratorio sin calibración física entre instrumentos.
Una detección no equivale a un incendio único. Cobertura satelital desconocida. La capa de predicción usa el
Modelo B FireSight (Random Forest calibrado): probabilidad experimental de detección al día siguiente, solo en
la zona piloto Chiquitanía. No es una alerta operativa.

### Qué está en git y qué se descarga aparte

| Qué | Dónde está | Tamaño |
|---|---|---|
| Código, datos 2024 y predicción 2024 | en el repositorio | — |
| Datos 2025, predicción 2025 y Modelo A (serie 2001–2025) | release [`datos-2025-v1`](https://github.com/OddALaCream/T-Pentagron/releases/tag/datos-2025-v1), `firesight-datos-v1.zip` | ~50 MB |
| Modelos entrenados (solo para generar años nuevos) | mismo release, `firesight-modelos-v1.zip` | ~60 MB |

`scripts/descargar_datos.py` baja los zips, verifica su huella SHA-256 y los deja en su carpeta. Sin ellos la app
funciona igual, pero solo con 2024 y sin la sección del Modelo A.

## Instalar desde cero (PowerShell)

Requisitos: Python 3.13 o 3.14, Node.js >=20.9, npm y git. Ejecutar desde la raíz del clon.

```powershell
git clone https://github.com/OddALaCream/T-Pentagron
Set-Location T-Pentagron

python -m venv backend/.venv
./backend/.venv/Scripts/python.exe -m pip install -r backend/requirements.txt

# Datos 2025 y Modelo A (~50 MB, desde el release de GitHub)
./backend/.venv/Scripts/python.exe scripts/descargar_datos.py

# API: mantener esta terminal abierta
./backend/.venv/Scripts/python.exe -m uvicorn backend.main:app --port 8000
```

En otra terminal, desde la raíz:

```powershell
Set-Location FRONTEND/NasaAppChallenge2026-Frontend
Copy-Item .env.example .env.local
npm ci
npm run dev
```

Abrir http://localhost:3000/?date=2024-09-06 (o `?date=2025-09-06`). Swagger: http://localhost:8000/docs.
El ejemplo de configuración usa datos reales de la API; `mock` es un modo independiente.
Las teselas externas requieren conexión; pueden desactivarse en `.env.local`.

En macOS o Linux, los mismos pasos cambian `./backend/.venv/Scripts/python.exe` por `backend/.venv/bin/python`
y `Copy-Item` por `cp`.

## Actualizar una copia que ya tienes

Si ya clonaste el proyecto antes, desde la raíz:

```powershell
git pull
./backend/.venv/Scripts/python.exe -m pip install -r backend/requirements.txt
./backend/.venv/Scripts/python.exe scripts/descargar_datos.py

Set-Location FRONTEND/NasaAppChallenge2026-Frontend
npm ci
```

Luego **reiniciar el backend** (Ctrl+C y volver a lanzar uvicorn): los años disponibles se detectan al arrancar.
Si tenías `--reload`, igual conviene reiniciarlo una vez después de bajar los datos.

## Qué deberías ver

- Arriba, «NASA FIRMS · Bolivia 2024–2025»; el calendario llega hasta el 31-dic-2025.
- Capas (teclas 1 a 4): MODIS, VIIRS, Armonizado (índice exploratorio) y Predicción (Modelo B, zona piloto).
- Al seleccionar la región Bolivia o una celda de la Chiquitanía, en el inspector:
  - **Sensores → Modelo A**: MODIS armonizado frente a VIIRS S-NPP día por día, y la serie 2001–2025 en una sola escala;
  - **Predicción**: probabilidad para el día siguiente, aportes por variable y el aviso de uso experimental.
- `GET http://localhost:8000/health` responde `"years": [2024, 2025]`.

## Problemas frecuentes

| Síntoma | Solución |
|---|---|
| El calendario termina en 2024 | Faltan los datos 2025: correr `scripts/descargar_datos.py` y reiniciar el backend |
| En Sensores no aparece el Modelo A | Mismo caso: faltan `data/models/harmonization_*` |
| `descargar_datos.py`: «la huella SHA-256 no coincide» | Descarga incompleta: volver a correrlo con `--forzar` |
| El frontend no conecta con la API | Revisar `NEXT_PUBLIC_API_BASE_URL` en `.env.local`; si el frontend corre en otro puerto: `CORS_ORIGINS=http://localhost:3010` al lanzar uvicorn |

## Verificar

```powershell
# Desde la raíz (34 pruebas; con los datos del release no se salta ninguna):
./backend/.venv/Scripts/python.exe -m unittest backend.test_integration backend.test_predictions backend.test_years backend.test_harmonization -v

Set-Location FRONTEND/NasaAppChallenge2026-Frontend
npm run lint
npm run typecheck
npm run build
```

## Avanzado: regenerar los datos o los modelos

No hace falta para usar la app; el release ya trae todo.

- **Datos FIRMS de un año** (por ejemplo 2025), con una MAP_KEY gratis de FIRMS:
  `FIRMS_MAP_KEY=... python pipelines/fetch_firms_year.py 2025` (Area API, ~10 min) y luego
  `python pipelines/build_dataset.py 2025`. También se puede pedir el archivo en
  https://firms.modaps.eosdis.nasa.gov/download/ y descomprimir las carpetas `DL_FIRE_*` en `data/raw/firms/2025/`.
  Las dos vías dan los mismos datos (Standard Processing).
- **Predicción de un año nuevo** con el modelo publicado: `python scripts/descargar_datos.py --modelos` y un entorno
  Python 3.8 con `firesight/requirements-py38.txt` (con scikit-learn nuevo, el Modelo B da resultados equivocados);
  luego `python -m firesight.export_serving AÑO`. Detalles en [firesight/README.md](firesight/README.md).
- **Reentrenar todo**: `bash firesight/run_models.sh` (~300 MB de descarga, 30–40 min). Produce un modelo nuevo:
  hay que reexportar 2024 y 2025 y publicar un release nuevo con `-v2`.

Metodología de datos: [pipelines/README.md](pipelines/README.md).
Modelos, métricas y reentrenamiento: [firesight/README.md](firesight/README.md).
Frontera cartográfica: Natural Earth 1:10m, dominio público; no es un deslinde legal.
