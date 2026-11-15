/**
 * Implementación de `DataService` sobre FastAPI. Usa los mismos tipos de dominio que
 * el modo mock, de modo que los componentes no cambian al conectar el backend.
 */
import { cellToBoundary, cellToLatLng, cellToParent, getResolution, gridDisk, isValidCell, cellArea } from 'h3-js';
import { aggregateRecords, computeTotals, DAILY_INDEX_SCALE, MONTHLY_INDEX_SCALE } from '@/lib/geo/aggregate';
import { addDays } from '@/lib/time/dates';
import type {
  ActivityQuery, ActivitySnapshot, CellActivity, CellInfo, DatasetMetadata, Detection, ISODate, ModelInfo,
  NewsItem, Prediction, Region, SeriesPoint, SeriesTarget, WeatherDaily,
} from '@/lib/types/domain';
import type { DataRange, DataService, PredictionDetail } from '../service';
import {
  adaptDetection, adaptHarmonized, adaptModel, adaptPrediction, adaptRegion, adaptSeriesPoint, adaptWeather,
  toCellActivity,
} from './adapters';
import { ApiError, apiGet } from './client';
import { ENDPOINTS } from './endpoints';

type Dict = Record<string, unknown>;

class ApiDataService implements DataService {
  readonly kind = 'api' as const;
  private regionsPromise: Promise<Region[]> | null = null;
  private cellRegion = new Map<string, string>();
  private cellLists = new Map<string, Promise<string[]>>();

  async getDataRange(): Promise<DataRange> {
      const meta = await apiGet<Dict>(ENDPOINTS.meta);
      const range = (meta.date_range as Dict) ?? {};
      if (!range.start || !range.end) throw new Error('El backend no devolvió el rango del archivo');
      return { start: String(range.start), end: String(range.end) };
  }

  getRegions(): Promise<Region[]> {
    this.regionsPromise ??= apiGet<Dict[]>(ENDPOINTS.regions).then((list) => list.map(adaptRegion));
    return this.regionsPromise;
  }

  getRegionCells(regionId: string): Promise<string[]> {
    let p = this.cellLists.get(regionId);
    if (!p) {
      p = apiGet<Dict>(ENDPOINTS.regionCells(regionId))
        .then((r) => ((r.h3_ids as string[]) ?? []).filter(isValidCell))
        .then((ids) => {
          ids.forEach((id) => this.cellRegion.set(id, regionId));
          return ids;
        });
      this.cellLists.set(regionId, p);
    }
    return p;
  }

  private async regionOf(h3: string, hint?: unknown): Promise<string> {
    if (typeof hint === 'string' && hint) return hint;
    if (this.cellRegion.has(h3)) return this.cellRegion.get(h3)!;
    const regions = await this.getRegions();
    await Promise.all(regions.map((r) => this.getRegionCells(r.id)));
    return this.cellRegion.get(h3) ?? 'desconocida';
  }

  async getActivity(q: ActivityQuery): Promise<ActivitySnapshot> {
    const [activity, predictions] = await Promise.all([
      apiGet<Dict>(ENDPOINTS.activity, {
        date: q.date, granularity: q.granularity, region: q.regionIds, confidence: q.confidence ?? 'all',
      }),
      q.withPredictions && q.granularity === 'day' ? this.getPredictions(q.date, q.regionIds).catch(() => []) : Promise.resolve([]),
    ]);
    const probs = new Map(predictions.map((p) => [p.h3_id, p.probability]));
    const raw = (Array.isArray(activity) ? activity : (activity.records as Dict[])) ?? [];
    const native: CellActivity[] = [];
    for (const dto of raw as Dict[]) {
      const h = adaptHarmonized(dto);
      const record = toCellActivity(h, await this.regionOf(h.h3_id, dto.region_id), probs.get(h.h3_id));
      if (record && dto.display_center) record.center = dto.display_center as CellActivity['center'];
      if (record) native.push(record);
    }
    const { totals, byRegion } = computeTotals(native);
    const scale = q.granularity === 'month' ? MONTHLY_INDEX_SCALE : DAILY_INDEX_SCALE;
    const nativeRes = native[0]?.resolution ?? 6;
    const records = q.resolution >= nativeRes ? native : aggregateRecords(native, q.resolution, scale, cellToParent);
    return { date: q.date, granularity: q.granularity, resolution: Math.min(q.resolution, nativeRes), records, totals, byRegion, source: 'api' };
  }

  async getSeries(target: SeriesTarget, from: ISODate, to: ISODate): Promise<SeriesPoint[]> {
    const query = target.kind === 'cell' ? { h3_id: target.h3, from, to } : { region: target.regionId, from, to };
    const res = await apiGet<Dict>(ENDPOINTS.series, query);
    const points = (Array.isArray(res) ? res : (res.points as Dict[])) ?? [];
    return (points as Dict[]).map(adaptSeriesPoint);
  }

  async getDetections(h3: string, date: ISODate): Promise<Detection[]> {
    const list = await apiGet<Dict[]>(ENDPOINTS.detections, { h3_id: h3, date });
    return list.map(adaptDetection);
  }

  async getPredictions(date: ISODate, regionIds?: string[]): Promise<Prediction[]> {
    const response = await apiGet<Dict | Dict[]>(ENDPOINTS.predictions, { date, region: regionIds });
    const list = Array.isArray(response) ? response : (response.predictions as Dict[] ?? []);
    return list.map(adaptPrediction);
  }

  async getPredictionDetail(target: SeriesTarget, date: ISODate): Promise<PredictionDetail> {
    const base = { target, issuedForDate: date, forecastDate: addDays(date, 1) };
    try {
      const query = target.kind === 'cell' ? { h3_id: target.h3, date } : { region: target.regionId, date };
      const dto = await apiGet<Dict>(ENDPOINTS.predictionDetail, query);
      return {
        ...base,
        probability: typeof dto.probability === 'number' ? dto.probability : null,
        modelVersion: String(dto.model_version ?? 'desconocida'),
        features: Array.isArray(dto.features)
          ? (dto.features as Dict[]).map((f) => ({
              key: String(f.key), label: String(f.label ?? f.key), value: typeof f.value === 'number' ? f.value : null,
              unit: f.unit ? String(f.unit) : undefined, contribution: typeof f.contribution === 'number' ? f.contribution : null,
            }))
          : [],
        distribution: Array.isArray(dto.distribution) ? (dto.distribution as number[]) : undefined,
        topCells: Array.isArray(dto.top_cells) ? (dto.top_cells as { h3: string; probability: number }[]) : undefined,
        meanProbability: typeof dto.mean_probability === 'number' ? dto.mean_probability : undefined,
      };
    } catch (error) {
      if (error instanceof ApiError && error.status === 404 && target.kind === 'cell') {
        const preds = await this.getPredictions(date);
        const p = preds.find((x) => x.h3_id === target.h3);
        return { ...base, probability: p?.probability ?? null, modelVersion: p?.model_version ?? 'desconocida', features: [] };
      }
      throw error;
    }
  }

  async getModelInfo(): Promise<ModelInfo> {
    return adaptModel(await apiGet<Dict>(ENDPOINTS.model));
  }

  async getMetadata(): Promise<DatasetMetadata> {
    const range = await this.getDataRange();
    const meta = await apiGet<Dict>(ENDPOINTS.meta);
    const harmonization = meta.harmonization as Dict;
    return {
      source: 'api',
      generator: 'FastAPI',
      dateRange: range,
      products: [
        { sensor: 'MODIS', product: 'MODIS C6.1', resolutionMeters: 1000, satellites: ['Terra', 'Aqua'] },
        { sensor: 'VIIRS', product: 'VIIRS 375 m', resolutionMeters: 375, satellites: ['Suomi NPP', 'NOAA-20', 'NOAA-21'] },
      ],
      harmonization: { method: String(harmonization.method), modisCalibrationFactor: NaN, notes: `${harmonization.formula}. ${harmonization.notes}` },
      h3: { resolution: 6, meanAreaKm2: 36.13, aggregateResolutions: [4, 5] },
      disclaimer: 'Los focos satelitales tienen precisión limitada y no deben emplearse como único recurso para proteger vidas o bienes.',
    };
  }

  async getWeather(regionId: string, from: ISODate, to: ISODate): Promise<WeatherDaily[]> {
    try {
      const list = await apiGet<Dict[]>(ENDPOINTS.weather, { region: regionId, from, to });
      return list.map(adaptWeather);
    } catch {
      return [];
    }
  }

  async getCellInfo(h3: string): Promise<CellInfo | null> {
    if (!isValidCell(h3)) return null;
    const res = getResolution(h3);
    const [lat, lng] = cellToLatLng(h3);
    return {
      h3_id: h3,
      regionId: await this.regionOf(h3),
      resolution: res,
      center: { lat, lng },
      areaKm2: cellArea(h3, 'km2'),
      parents: [5, 4, 3].filter((r) => r < res).map((r) => ({ resolution: r, h3_id: cellToParent(h3, r) })),
      neighbors: gridDisk(h3, 1).filter((n) => n !== h3),
      boundary: cellToBoundary(h3, true) as [number, number][],
    };
  }

  async getNews(regionId: string): Promise<NewsItem[]> {
    try {
      return await apiGet<NewsItem[]>(ENDPOINTS.news, { region: regionId });
    } catch {
      return [];
    }
  }
}

export function createApiService(): DataService {
  return new ApiDataService();
}
