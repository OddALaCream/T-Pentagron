# Archivo FIRMS Bolivia 2024

`build_dataset.py` conserva cada fila, columnas originales, fuente y número de línea CSV.
Sin deduplicación entre satélites. Las consultas principales usan `type=0`; el Parquet
canónico y `/detections` conservan todos los tipos. UTC proviene de fecha + HHMM.

MODIS C6.1: píxel nominal 1 km; brillo B21/22 y B31. VIIRS C2: 375 m,
brillo I4 e I5; los nombres genéricos del CSV se conservan pero las bandas no se
mezclan como si fueran equivalentes. `scan`/`track` originales describen la huella.
FRP se conserva en MW, incluso cero. Confianza MODIS: baja <30, nominal 30–79,
alta >=80; VIIRS: l/n/h. Las etiquetas son filtros de presentación, no una
equivalencia científica. `nominal` en la API incluye nominal + alta.

Índice exploratorio v1: para cada familia instrumental s, calcular q95_s sobre
conteos positivos `type=0` por celda H3-6/día durante todo 2024 (cuantil lineal).
I_s = min(1, log(1+n_s)/log(1+q95_s)). Por celda/día, I es la media de I_s
de las familias con detecciones. El baseline es fijo al filtrar confianza.
Valores obtenidos: MODIS q95=11; VIIRS q95=76. En grid, cada estrato de confianza
y tipo conserva su conteo, q95 e índice; API suma estratos antes de normalizar.
Meses: suma de conteos y media de índices diarios con detecciones. Series regionales:
media por celda activa/día. Padres H3: media de índices de hijos presentes.
Es actividad relativa al archivo 2024, dependiente de densidad, resolución,
horarios, número de plataformas y selección de muestras; no calibración física,
probabilidad, área quemada ni cantidad de incendios únicos. No normaliza exposición.

Los 366 días por cada una de las cuatro fuentes se registran en source_quality.
Cero detecciones de archivo no informa cobertura, nubosidad ni ausencia de fuego.
Las banderas `observed/partial/missing` del contrato API indican detecciones en
ambas/una/ninguna familia, exclusivamente; coverage es null. No se suministraron
swaths ni m?scaras de nubes. El GeoJSON local Natural Earth Admin 0 (1:10m,
dominio p?blico) define ahora Bolivia. Shapely filtra las coordenadas exactas,
incluyendo la frontera. `in_bolivia` marca la pertenencia sin borrar filas
can?nicas. API y baseline usan solo detecciones interiores. En este archivo
las 2.946.799 observaciones son interiores; los centros H3 agrupados pod?an
quedar fuera del pa?s. La visualizaci?n usa un ancla interior en ese caso.
El globo recorta celdas y grilla con una m?scara visual de 2048? derivada del
mismo pol?gono; ese recorte raster no interviene en conteos ni filtrado cient?fico.
Frontera cartogr?fica, no deslinde legal ni divisiones departamentales.

Al acercarse, el motor nativo de react-globe.gl carga teselas Esri World Imagery.
Es un mapa de referencia, no imagen de la fecha de detecci?n; requiere Internet.
Se puede desactivar con NEXT_PUBLIC_ENABLE_GLOBE_TILES=false. El material
local del planeta permanece como base. No se a?adieron librer?as al frontend.


Referencia de productos: https://firms.modaps.eosdis.nasa.gov/download/Readme.txt
