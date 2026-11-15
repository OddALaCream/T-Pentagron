/**
 * Contrato de la capa de datos. Los componentes nunca importan el generador mock ni
 * el cliente HTTP directamente: usan `getDataService()` (vía hooks de `src/hooks/data`).
 * Cambiar NEXT_PUBLIC_DATA_MODE=api activa el cliente FastAPI sin tocar la interfaz.
 */
import { env } from '@/config/env';
import type {
  ActivityQuery, ActivitySnapshot, CellInfo, DatasetMetadata, DataSourceKind, Detection, H3Index,
  HarmonizationSeries, ISODate, LongSeries, ModelInfo, NewsItem, Prediction, PredictionFeature, Region, SeriesPoint,
  SeriesTarget, WeatherDaily,
} from '@/lib/types/domain';

export interface PredictionDetail {
  target: SeriesTarget;
  issuedForDate: ISODate;
  forecastDate: ISODate;
  probability: number | null;
  modelVersion: string;
  features: PredictionFeature[];
  /** Solo regiones: histograma de probabilidades (10 intervalos de 0.1). */
  distribution?: number[];
  /** Solo regiones: celdas con mayor probabilidad. */
  topCells?: { h3: H3Index; probability: number }[];
  meanProbability?: number;
}

export interface DataRange {
  start: ISODate;
  end: ISODate;
}

export interface DataService {
  readonly kind: DataSourceKind;
  getDataRange(): Promise<DataRange>;
  getRegions(): Promise<Region[]>;
  getRegionCells(regionId: string): Promise<H3Index[]>;
  getActivity(query: ActivityQuery): Promise<ActivitySnapshot>;
  getSeries(target: SeriesTarget, from: ISODate, to: ISODate): Promise<SeriesPoint[]>;
  getDetections(h3: H3Index, date: ISODate): Promise<Detection[]>;
  getPredictions(date: ISODate, regionIds?: string[]): Promise<Prediction[]>;
  getPredictionDetail(target: SeriesTarget, date: ISODate): Promise<PredictionDetail>;
  getModelInfo(): Promise<ModelInfo>;
  getMetadata(): Promise<DatasetMetadata>;
  getWeather(regionId: string, from: ISODate, to: ISODate): Promise<WeatherDaily[]>;
  getCellInfo(h3: H3Index): Promise<CellInfo | null>;
  /** Noticias locales: integración futura. Nunca devuelve contenido inventado. */
  getNews(regionId: string): Promise<NewsItem[]>;
  /** Modelo A FireSight (solo API, zona piloto). null = objetivo o fechas fuera de su cobertura. */
  getHarmonization?(target: SeriesTarget, from: ISODate, to: ISODate): Promise<HarmonizationSeries | null>;
  getLongSeries?(target: SeriesTarget): Promise<LongSeries | null>;
}

let instance: Promise<DataService> | null = null;

/** Devuelve el servicio configurado (carga diferida para no incluir el generador en modo API). */
export function getDataService(): Promise<DataService> {
  if (!instance) {
    instance =
      env.dataMode === 'api'
        ? import('./api/apiService').then((m) => m.createApiService())
        : import('./mock/mockService').then((m) => m.createMockService());
  }
  return instance;
}
