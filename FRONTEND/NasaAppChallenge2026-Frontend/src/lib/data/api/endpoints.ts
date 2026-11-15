/**
 * Endpoints esperados del backend FastAPI (propuesta de contrato).
 *
 * Los dos primeros son los del plan científico; el resto son extensiones opcionales.
 * Si un endpoint opcional no existe, el servicio API degrada (vacío o calculado en cliente).
 *
 *   GET /activity?date=YYYY-MM-DD&granularity=day|month&region=a,b&confidence=all|nominal|high
 *       → { date, records: HarmonizedDailyDTO[] }           (res 6, una fila = celda/día o celda/mes)
 *   GET /predictions?date=YYYY-MM-DD&region=a,b
 *       → PredictionDTO[]                                    (forecast_date = date + 1)
 *
 *   GET /meta                                  → { date_range: { start, end }, ... }
 *   GET /regions                               → RegionDTO[]
 *   GET /regions/{id}/cells                    → { h3_ids: string[] }
 *   GET /activity/series?h3_id=…|region=…&from=…&to=…   → { points: SeriesPointDTO[] }
 *   GET /detections?h3_id=…&date=…             → DetectionDTO[]
 *   GET /predictions/detail?h3_id=…|region=…&date=…     → PredictionDetailDTO
 *   GET /model                                 → ModelInfoDTO
 *   GET /weather?region=…&from=…&to=…          → WeatherDTO[]
 *   GET /news?region=…                         → NewsDTO[]   (vacío hasta definir fuentes)
 */
export const ENDPOINTS = {
  meta: '/meta',
  regions: '/regions',
  regionCells: (id: string) => `/regions/${encodeURIComponent(id)}/cells`,
  activity: '/activity',
  series: '/activity/series',
  detections: '/detections',
  predictions: '/predictions',
  predictionDetail: '/predictions/detail',
  model: '/model',
  weather: '/weather',
  news: '/news',
} as const;
