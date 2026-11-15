# FireSight: modelos de armonización y predicción

Dos modelos sobre la zona piloto **Chiquitanía (Santa Cruz)**, grilla H3 res 6, con datos NASA FIRMS y NASA POWER:

- **Modelo A, armonización:** convierte el conteo diario MODIS de cada celda a la escala VIIRS S-NPP (VIIRS-equivalente). Usa un baseline estacional más LightGBM Tweedie.
- **Modelo B, predicción experimental:** probabilidad de que FIRMS registre al menos una detección en la celda **al día siguiente**. Es un Random Forest calibrado con regresión isotónica.

> **Uso experimental.** Predice detecciones satelitales registradas, no ignición física. No es una alerta operativa y FIRMS no debe ser el único recurso para proteger vidas o bienes.

## Cómo encaja en el observatorio

```
firesight/run_models.sh ─► data/firesight/   (descargas, cubos, modelos entrenados; ignorado por git, ~1,5 GB)
                       └─► data/models/      (artefacto liviano, versionado, ~17 MB)
                                 │
backend/predictions.py ◄─────────┘   lee el artefacto con polars, sin sklearn
backend/main.py        ─► /predictions · /predictions/detail · /model · /meta.prediction
FRONTEND/…             ─► capa «Predicción» del globo y pestaña «Predicción» del inspector
```

El backend **no necesita** el entorno de entrenamiento. Basta con `data/models/`, que ya viene en el repo con las predicciones de 2024, el mismo año del archivo del observatorio:

| Archivo | Contenido |
|---|---|
| `predictions_2024.parquet` | Probabilidad calibrada t+1 de las 4.067 celdas de la zona, cada día de 2024 |
| `explanations_2024.parquet` | Explicación local exacta del bosque: sesgo + Σ aportes de las 23 variables = probabilidad del bosque (error < 1e-14). Cubre las celdas con p ≥ 5 % o entre las 30 más altas del día (≈104 mil celdas-día) |
| `model_card.json` | Versión, umbral F1, métricas (validación, prueba y validación externa), cobertura y años exportados (`years`) |
| `predictions_2025.parquet`, `explanations_2025.parquet` | Lo mismo para 2025, el año de prueba. Fuera de git (release `datos-2025-v1`, `python scripts/descargar_datos.py`); el backend los sirve si están |

| `harmonization_2024.parquet`, `harmonization_2025.parquet`, `harmonization_monthly.parquet`, `harmonization_card.json` | Modelo A para el inspector del globo: MODIS crudo, S-NPP observado y MODIS armonizado por celda y día (2024–2025) y por celda y mes (2001–2025). Fuera de git (release `datos-2025-v1`, `python scripts/descargar_datos.py`). Se generan con `python -m firesight.export_harmonization` |

### Modelo A en el observatorio

El globo sigue usando el índice exploratorio del equipo: el Modelo A convierte MODIS a la escala de **un solo** VIIRS
(S-NPP), mientras que el globo suma tres (S-NPP, NOAA-20, NOAA-21), que detectan unas 3 veces más. Reemplazar el índice
dejaba en cero un tercio de las celdas activas de la zona piloto en 2024. Por eso el Modelo A aparece en la pestaña
**Sensores** del inspector, para celdas y regiones de la zona piloto:

- **Discrepancia diaria** (`/harmonization/series`): lo que S-NPP habría visto según MODIS, frente a lo que vio.
  En ago–oct 2024 el armonizado queda un 11 % por debajo de S-NPP (MODIS crudo: 5,2 veces por debajo).
- **Serie 2001–2025** (`/harmonization/long-series`): un solo registro en escala S-NPP. Antes de 2012 no hay VIIRS y la
  serie es una extrapolación; hasta julio de 2002 solo operaba Terra. Entre 2015 y 2025 el armonizado anual queda a
  ±10 % del S-NPP observado; en 2012–2014, entre 24 % y 30 % por encima.

Los conteos MODIS del Modelo A (archivo por país) coinciden exactamente con los del observatorio (descarga `DL_FIRE`)
en las mismas celdas: lo verifica `backend/test_harmonization.py`.

`export_serving` acumula años en `model_card.json` y se niega a agregar un año exportado con otro modelo (otra versión o umbral). Al reentrenar, `run_models.sh` borra la tarjeta y reexporta 2024 y 2025.

La API sirve solo las **3.642 celdas que tocan Bolivia**. El recuadro de la zona piloto cruza a Brasil, donde los archivos FIRMS de Bolivia no tienen detecciones, así que esas celdas se descartan.

## Reentrenar

```bash
bash firesight/run_models.sh     # crea firesight/.venv, descarga ~300 MB, entrena A y B, valida y exporta
```

Funciona con Python 3.8 a 3.13. En la PC con Windows, usar Git Bash o WSL, o correr los módulos uno por uno:
`python -m firesight.fetch`, `index_h3`, `harmonize`, `predict`, `oof`, `evaluate_external`, `export_serving`.
No hace falta MAP_KEY: los archivos anuales por país de FIRMS son públicos. Fuentes y enlaces en [DATA_SOURCES.md](DATA_SOURCES.md).

| Paso | Módulo | Salida |
|---|---|---|
| Descarga | `firesight.fetch` | CSV FIRMS originales (MODIS, VIIRS S-NPP 2018–2025) y NASA POWER (48 puntos de 0,5°) |
| QA + H3 | `firesight.index_h3` | Detecciones con QA (MODIS conf ≥ 30, VIIRS ≠ «l», `type = 0`) y cubo diario celda × día |
| Modelo A | `firesight.harmonize` | `harmonizer.joblib`, registro armonizado diario |
| Modelo B | `firesight.predict` | `fire_predictor.joblib`, predicciones 2025, métricas |
| OOF | `firesight.oof` | Un modelo por año 2018–2023 que no vio ese año |
| Validación externa | `firesight.evaluate_external` | Métricas 2013–2017 con los modelos sin reentrenar |
| Exportación | `firesight.export_serving [año]` | `data/models/` |

Partición temporal: **entrenamiento 2018–2023, validación 2024, prueba 2025**. Las features son causales: solo usan datos hasta el cierre del día t, y la prueba `test_no_leakage` lo verifica.

## Resultados

La referencia es Python 3.8. En Python 3.13, con sklearn 1.9, se reproducen dentro de la variación aleatoria del bosque: PR-AUC de prueba 0,368 frente a 0,367.

**Modelo A**, desviación Poisson (menor es mejor):

| | MODIS crudo | Baseline | LightGBM |
|---|---|---|---|
| Validación 2024 | 1,525 | 0,534 | **0,288** |
| Prueba 2025 | 0,284 | 0,130 | **0,078** |
| Externo 2013–2017 | 0,319 | 0,138 | **0,085** |

**Modelo B.** Base de positivos en 2025: 0,76 % de las celdas-día.

| | PR-AUC | F1 | Brier |
|---|---|---|---|
| **Random Forest, prueba 2025** | **0,367** | 0,401 | 0,0058 |
| Persistencia (detectó en t) | 0,162 | 0,397 | 0,0092 |
| Baseline estacional | 0,044 | 0,080 | 0,0077 |
| RF, externo 2013–2017 | 0,348 | 0,387 | 0,0062 |
| RF, externo 2026 (FIRMS Area API) | 0,371 | 0,396 | 0,0066 |
| RF, 2018–2023 fuera de muestra | 0,36–0,53 por año | | |

**Lectura honesta:**
- El RF supera claramente al baseline estacional y a la persistencia en ranking (PR-AUC) y en calibración (Brier).
- En F1 queda empatado con la persistencia.
- Las fechas que sirve el observatorio son de 2024, el año de **validación**. El bosque no lo vio, pero la calibración y el umbral se eligieron con él. La medida honesta es la de 2025.

**Comprobación independiente con el archivo del observatorio.** Las predicciones 2024 se compararon con `data/processed/grid_daily_2024.parquet`, una descarga distinta que además incluye NOAA-20 y NOAA-21:
- PR-AUC 0,658.
- En celdas con p ≥ 0,8, el 96 % tuvo detecciones al día siguiente; con p < 0,05, el 0,9 %.
- Las probabilidades quedan algo por debajo de lo observado, porque ese archivo suma dos satélites que el modelo no usa.

## Pruebas

```bash
firesight/.venv/bin/python -m firesight.tests.test_no_leakage    # features causales
firesight/.venv/bin/python -m firesight.tests.test_integrity     # 7 pruebas: etiquetas vs. detecciones crudas, armonización, modelos
backend/.venv/bin/python -m unittest backend.test_predictions -v  # 8 pruebas de la API de predicción
```

El backend no depende de sklearn: sus 12 pruebas (`test_integration` + `test_predictions`) pasan con Python 3.13 y 3.14.6.
El reentrenamiento (`firesight/.venv`) está probado con Python 3.8 y 3.13.

## Limitaciones

- **Una sola zona:** Chiquitanía, unos 400 × 330 km. Fuera de ella la API responde 404 en `/predictions/detail` y el globo no dibuja predicción.
- **Solo VIIRS S-NPP y MODIS.** NOAA-20 y NOAA-21 no tienen archivo anual por país. La capa del globo usa el índice exploratorio del observatorio; el Modelo B usa el registro armonizado del Modelo A.
- **Clima grueso:** NASA POWER tiene una resolución de unos 0,5°, mucho más gruesa que H3 res 6. Fechas en UTC.
- **Escala de los aportes:** están en la escala del bosque, antes de la calibración. Explican el orden entre celdas, no el valor calibrado exacto.
- **Explicaciones parciales:** se exportan solo para celdas con p ≥ 5 % o entre las 30 más altas del día. Las demás muestran la probabilidad sin desglose.
