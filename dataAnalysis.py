from pathlib import Path

import pandas as pd


DATASETS = sorted(Path(__file__).parent.glob("DL_FIRE_*/fire_archive_*.csv"))

if not DATASETS:
    raise FileNotFoundError("No se encontraron archivos CSV en las carpetas DL_FIRE_*.")

for dataset_path in DATASETS:
    df = pd.read_csv(dataset_path)

    print(f"\n{'=' * 60}")
    print(f"Dataset: {dataset_path.parent.name} / {dataset_path.name}")
    print("Columnas:", df.columns.tolist())
    print("Registros:", len(df))
    print("\nTipos de datos:")
    print(df.dtypes)
    print("\nPrimeras filas:")
    print(df.head())
    print("\nValores nulos:")
    print(df.isnull().sum())
    print("\nSatélites:")
    print(df["satellite"].value_counts())
    print("\nConfianza:")
    print(df["confidence"].value_counts())
    print("\nTipos de detección:")
    print(df["type"].value_counts())
    print("\nVersiones:")
    print(df["version"].value_counts())
    print("\nPeriodo real:")
    print(df["acq_date"].min(), df["acq_date"].max())
    print("\nFRP:")
    print(df["frp"].describe())
    print("\nDuplicados exactos:")
    print(df.duplicated().sum())
    print("\nDetecciones por día:")
    daily = df.groupby("acq_date").size()
    print("Días con detecciones:", len(daily))
    print("Mínimo diario:", daily.min())
    print("Máximo diario:", daily.max())
    print("\nDía con más detecciones:")
    print(daily.idxmax(), daily.max())
    print("\nDetecciones diurnas/nocturnas:")
    print(df["daynight"].value_counts())
    print("\nValores FRP iguales a cero:")
    print((df["frp"] == 0).sum())