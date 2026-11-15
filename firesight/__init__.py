"""FireSight — modelos de armonización (A) y predicción (B).

En Linux ARM (aarch64), cargar lightgbm antes que scikit-learn provoca
"libgomp ... cannot allocate memory in static TLS block". Importar sklearn primero lo evita.
"""
import sklearn  # noqa: F401  (debe ir antes que lightgbm)
