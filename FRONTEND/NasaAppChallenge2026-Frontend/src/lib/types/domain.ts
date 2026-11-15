/**
 * Modelos de dominio del frontend.
 *
 * Los tres primeros contratos replican los mínimos del plan científico
 * (`FireSight_Plan_Completo.md`, sección 04). Los campos opcionales son extensiones
 * que el frontend aprovecha si el backend los entrega; si faltan, la interfaz degrada
 * con elegancia (nunca inventa el valor).
 */
import type { ISODate } from '@/lib/time/dates';

export type { ISODate };
export type H3Index = string;
export type Sensor = 'MODIS' | 'VIIRS';
export type Satellite = 'Terra' | 'Aqua' | 'Suomi NPP' | 'NOAA-20' | 'NOAA-21';
export type ProductVersion = 'NRT' | 'SP';
/** observed = ambos sensores con observación válida; partial = solo uno; missing = ninguno. */
export type AvailabilityFlag = 'observed' | 'partial' | 'missing';
export type DataLayer = 'modis' | 'viirs' | 'harmonized' | 'prediction';
export type Granularity = 'day' | 'month';
/** Clase de confianza normalizada: VIIRS l/n/h, MODIS 0-29 / 30-79 / 80-100. */
export type ConfidenceClass = 'low' | 'nominal' | 'high';
export type ConfidenceFilter = 'all' | 'nominal' | 'high';
export type DataSourceKind = 'mock' | 'api';

export interface LatLng {
  lat: number;
  lng: number;
}

/* ------------------------------------------------------------------ */
/* Contrato 1 · detections_indexed — una fila = una detección          */
/* ------------------------------------------------------------------ */
export interface Detection {
  h3_id: H3Index;
  /** Fecha y hora de adquisición UTC (ISO 8601). */
  date_utc: string;
  sensor: Sensor;
  satellite: Satellite;
  /** Potencia radiativa del fuego, MW. */
  frp: number;
  /** MODIS: 0-100. VIIRS: 'l' | 'n' | 'h'. */
  confidence: number | 'l' | 'n' | 'h';
  latitude: number;
  longitude: number;
  version?: ProductVersion;
  product?: string;
  daynight?: 'D' | 'N';
}

/* ------------------------------------------------------------------ */
/* Contrato 2 · harmonized_daily — una fila = celda/día                */
/* ------------------------------------------------------------------ */
export interface HarmonizedDaily {
  h3_id: H3Index;
  date: ISODate;
  /** null = sin observación válida de ese sensor (no equivale a cero). */
  modis_detected: number | null;
  viirs_detected: number | null;
  /** Índice armonizado 0-1; null si no hay observación. */
  activity_index: number | null;
  availability_flag: AvailabilityFlag;
  // Extensiones opcionales
  modis_frp_sum?: number | null;
  viirs_frp_sum?: number | null;
  anomaly_score?: number | null;
  is_anomaly?: boolean;
  /** Recuento por clase de confianza [baja, nominal, alta]. */
  modis_by_confidence?: [number, number, number] | null;
  viirs_by_confidence?: [number, number, number] | null;
}

/* ------------------------------------------------------------------ */
/* Contrato 3 · predictions                                            */
/* ------------------------------------------------------------------ */
export interface Prediction {
  h3_id: H3Index;
  forecast_date: ISODate;
  probability: number;
  model_version: string;
  // Extensiones opcionales
  issued_for_date?: ISODate;
  features?: PredictionFeature[];
}

export interface PredictionFeature {
  key: string;
  label: string;
  value: number | null;
  unit?: string;
  /** Aporte al logit (modelo lineal) o importancia relativa. */
  contribution?: number | null;
  description?: string;
}

/* ------------------------------------------------------------------ */
/* Catálogo geográfico                                                  */
/* ------------------------------------------------------------------ */
export interface Region {
  id: string;
  name: string;
  country: string;
  countryCode: string;
  admin: string;
  biome: string;
  center: LatLng;
  isPilot: boolean;
  description: string;
  /** Resolución H3 nativa de los datos de la región. */
  resolution: number;
  cellCount: number;
  bbox: [number, number, number, number]; // [minLng, minLat, maxLng, maxLat]
  /** Desfase horario aproximado respecto a UTC (horas). */
  utcOffset: number;
  seasonLabel: string;
}

/* ------------------------------------------------------------------ */
/* Respuestas agregadas que consume la interfaz                         */
/* ------------------------------------------------------------------ */

/** Registro de actividad listo para dibujar (cualquier resolución H3). */
export interface CellActivity extends HarmonizedDaily {
  resolution: number;
  regionId: string;
  center: LatLng;
  /** Número de celdas res 6 agregadas (1 si es nativa). */
  childCount: number;
  /** Fracción de celdas hijas con observación válida (0-1). */
  coverage: number;
  /** Probabilidad experimental para el día siguiente (solo si se pidió). */
  probability?: number | null;
}

export interface ActivityTotals {
  modis: number;
  viirs: number;
  activeCells: number;
  anomalies: number;
  missingCells: number;
  partialCells: number;
  observedCells: number;
  meanIndex: number;
}

export interface ActivitySnapshot {
  date: ISODate;
  granularity: Granularity;
  resolution: number;
  records: CellActivity[];
  totals: ActivityTotals;
  byRegion: Record<string, ActivityTotals>;
  source: DataSourceKind;
}

export interface ActivityQuery {
  date: ISODate;
  granularity: Granularity;
  resolution: number;
  regionIds?: string[];
  confidence?: ConfidenceFilter;
  withPredictions?: boolean;
}

/** Objetivo de una consulta de serie: una celda H3 o una región completa. */
export type SeriesTarget = { kind: 'cell'; h3: H3Index } | { kind: 'region'; regionId: string };

export interface SeriesPoint {
  date: ISODate;
  modis: number | null;
  viirs: number | null;
  index: number | null;
  availability: AvailabilityFlag;
  anomaly: boolean;
  modisFrp: number | null;
  viirsFrp: number | null;
  /** Celdas activas (solo series de región). */
  activeCells?: number;
  /** Fracción observada (solo series de región). */
  coverage?: number;
}

export interface WeatherDaily {
  date: ISODate;
  temperature: number; // °C
  precipitation: number; // mm/día
  humidity: number; // %
  wind: number; // m/s
}

export interface ModelMetrics {
  precision: number | null;
  recall: number | null;
  f1: number | null;
  prAuc: number | null;
  brier: number | null;
}

export interface ModelInfo {
  model_version: string;
  /** 'unavailable': el backend no tiene un modelo entrenado (la capa de predicción se desactiva). */
  status: 'demo' | 'validated' | 'experimental' | 'unavailable';
  algorithm: string;
  target: string;
  trainingPeriod: string;
  validationPeriod: string;
  testPeriod: string;
  metrics: ModelMetrics;
  baselineMetrics: ModelMetrics;
  features: { key: string; label: string; description: string }[];
  notes: string[];
}

export interface DatasetMetadata {
  source: DataSourceKind;
  generator: string;
  dateRange: { start: ISODate; end: ISODate };
  products: { sensor: Sensor; product: string; resolutionMeters: number; satellites: Satellite[] }[];
  harmonization: { method: string; modisCalibrationFactor: number; notes: string };
  h3: { resolution: number; meanAreaKm2: number; aggregateResolutions: number[] };
  disclaimer: string;
}

export interface CellInfo {
  h3_id: H3Index;
  regionId: string;
  resolution: number;
  center: LatLng;
  areaKm2: number;
  parents: { resolution: number; h3_id: H3Index }[];
  neighbors: H3Index[];
  boundary: [number, number][];
}

export interface NewsItem {
  id: string;
  title: string;
  source: string;
  url: string;
  publishedAt: string;
}
