/**
 * Adaptadores de respuesta: convierten los DTO del backend (snake_case, campos opcionales)
 * en modelos de dominio. Toleran ausencias: nunca rellenan con valores inventados.
 */
import { cellToLatLng, getResolution, isValidCell } from 'h3-js';
import type {
  AvailabilityFlag, CellActivity, Detection, HarmonizedDaily, ModelInfo, Prediction, Region, SeriesPoint,
  WeatherDaily,
} from '@/lib/types/domain';

type Dict = Record<string, unknown>;

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : v == null ? null : Number.isFinite(Number(v)) ? Number(v) : null);
const str = (v: unknown, fallback = ''): string => (typeof v === 'string' ? v : v == null ? fallback : String(v));

export function toAvailability(v: unknown): AvailabilityFlag {
  const s = str(v).toLowerCase();
  if (s === 'observed' || s === 'ok' || s === '1' || s === 'true') return 'observed';
  if (s === 'partial') return 'partial';
  return 'missing';
}

export function adaptHarmonized(dto: Dict): HarmonizedDaily {
  return {
    h3_id: str(dto.h3_id),
    date: str(dto.date).slice(0, 10),
    modis_detected: num(dto.modis_detected),
    viirs_detected: num(dto.viirs_detected),
    activity_index: num(dto.activity_index),
    availability_flag: toAvailability(dto.availability_flag),
    modis_frp_sum: num(dto.modis_frp_sum),
    viirs_frp_sum: num(dto.viirs_frp_sum),
    anomaly_score: num(dto.anomaly_score),
    is_anomaly: Boolean(dto.is_anomaly),
    modis_by_confidence: Array.isArray(dto.modis_by_confidence) ? (dto.modis_by_confidence as [number, number, number]) : null,
    viirs_by_confidence: Array.isArray(dto.viirs_by_confidence) ? (dto.viirs_by_confidence as [number, number, number]) : null,
  };
}

export function toCellActivity(h: HarmonizedDaily, regionId: string, probability?: number | null): CellActivity | null {
  if (!isValidCell(h.h3_id)) return null;
  const [lat, lng] = cellToLatLng(h.h3_id);
  return {
    ...h,
    resolution: getResolution(h.h3_id),
    regionId,
    center: { lat, lng },
    childCount: 1,
    coverage: NaN, // FIRMS detection files do not establish observation coverage.
    probability: probability ?? null,
  };
}

export function adaptDetection(dto: Dict): Detection {
  const conf = dto.confidence;
  return {
    h3_id: str(dto.h3_id),
    date_utc: str(dto.date_utc),
    sensor: str(dto.sensor).toUpperCase() === 'MODIS' ? 'MODIS' : 'VIIRS',
    satellite: str(dto.satellite) as Detection['satellite'],
    frp: num(dto.frp) ?? 0,
    confidence: typeof conf === 'number' ? conf : (str(conf, 'n').toLowerCase()[0] as 'l' | 'n' | 'h'),
    latitude: num(dto.latitude) ?? 0,
    longitude: num(dto.longitude) ?? 0,
    version: dto.version === 'SP' || dto.version === 'NRT' ? dto.version : undefined,
    product: dto.product ? str(dto.product) : undefined,
    daynight: dto.daynight === 'N' ? 'N' : dto.daynight === 'D' ? 'D' : undefined,
  };
}

export function adaptPrediction(dto: Dict): Prediction {
  return {
    h3_id: str(dto.h3_id),
    forecast_date: str(dto.forecast_date).slice(0, 10),
    probability: num(dto.probability) ?? 0,
    model_version: str(dto.model_version, 'desconocida'),
    issued_for_date: dto.issued_for_date ? str(dto.issued_for_date).slice(0, 10) : undefined,
  };
}

export function adaptRegion(dto: Dict): Region {
  const center = (dto.center as Dict) ?? {};
  const bbox = Array.isArray(dto.bbox) ? (dto.bbox as [number, number, number, number]) : [0, 0, 0, 0];
  return {
    id: str(dto.id),
    name: str(dto.name),
    country: str(dto.country),
    countryCode: str(dto.country_code ?? dto.countryCode),
    admin: str(dto.admin),
    biome: str(dto.biome),
    center: { lat: num(center.lat) ?? 0, lng: num(center.lng) ?? 0 },
    isPilot: Boolean(dto.is_pilot ?? dto.isPilot),
    description: str(dto.description),
    resolution: num(dto.resolution) ?? 6,
    cellCount: num(dto.cell_count ?? dto.cellCount) ?? 0,
    bbox: bbox as Region['bbox'],
    utcOffset: num(dto.utc_offset ?? dto.utcOffset) ?? 0,
    seasonLabel: str(dto.season_label ?? dto.seasonLabel, '—'),
  };
}

export function adaptSeriesPoint(dto: Dict): SeriesPoint {
  return {
    date: str(dto.date).slice(0, 10),
    modis: num(dto.modis_detected ?? dto.modis),
    viirs: num(dto.viirs_detected ?? dto.viirs),
    index: num(dto.activity_index ?? dto.index),
    availability: toAvailability(dto.availability_flag ?? dto.availability),
    anomaly: Boolean(dto.is_anomaly ?? dto.anomaly),
    modisFrp: num(dto.modis_frp_sum),
    viirsFrp: num(dto.viirs_frp_sum),
    activeCells: num(dto.active_cells) ?? undefined,
    coverage: num(dto.coverage) ?? undefined,
  };
}

export function adaptWeather(dto: Dict): WeatherDaily {
  return {
    date: str(dto.date).slice(0, 10),
    temperature: num(dto.temperature ?? dto.T2M) ?? NaN,
    precipitation: num(dto.precipitation ?? dto.PRECTOTCORR) ?? NaN,
    humidity: num(dto.humidity ?? dto.RH2M) ?? NaN,
    wind: num(dto.wind ?? dto.WS2M) ?? NaN,
  };
}

export function adaptModel(dto: Dict): ModelInfo {
  const m = (dto.metrics as Dict) ?? {};
  const b = (dto.baseline_metrics as Dict) ?? {};
  const metrics = (src: Dict) => ({
    precision: num(src.precision), recall: num(src.recall), f1: num(src.f1), prAuc: num(src.pr_auc), brier: num(src.brier),
  });
  return {
    model_version: str(dto.model_version, 'desconocida'),
    status: dto.status === 'validated' ? 'validated' : 'experimental',
    algorithm: str(dto.algorithm, '—'),
    target: str(dto.target, 'Actividad térmica detectada al día siguiente'),
    trainingPeriod: str(dto.training_period, '—'),
    validationPeriod: str(dto.validation_period, '—'),
    testPeriod: str(dto.test_period, '—'),
    metrics: metrics(m),
    baselineMetrics: metrics(b),
    features: Array.isArray(dto.features)
      ? (dto.features as Dict[]).map((f) => ({ key: str(f.key), label: str(f.label ?? f.key), description: str(f.description) }))
      : [],
    notes: Array.isArray(dto.notes) ? (dto.notes as unknown[]).map((n) => str(n)) : [],
  };
}
