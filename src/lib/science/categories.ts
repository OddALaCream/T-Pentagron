/**
 * Sistema visual de actividad. Cada categoría se distingue por COLOR, SÍMBOLO y
 * COMPORTAMIENTO (animación), nunca solo por color.
 *
 * Importante: "actividad térmica detectada" ≠ "incendio confirmado", y
 * "sin detección registrada" ≠ "no hubo fuego". Los textos lo reflejan.
 */
import type { CellActivity, DataLayer, Granularity } from '@/lib/types/domain';
import { DAILY_INDEX_SCALE, MONTHLY_INDEX_SCALE } from '@/lib/geo/aggregate';

export type VisualKind = 'none' | 'low' | 'medium' | 'high' | 'forecast' | 'anomaly' | 'unavailable';
export type SymbolShape = 'circle' | 'triangle' | 'diamond' | 'hexagon' | 'wave' | 'void' | 'dot';

export interface CategoryMeta {
  label: string;
  short: string;
  color: string;
  rgb: [number, number, number];
  symbol: SymbolShape;
  /** Código del símbolo en el shader de marcadores. */
  shapeCode: number;
  behavior: string;
  description: string;
}

const hexToRgb = (hex: string): [number, number, number] => {
  const n = parseInt(hex.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
};

const meta = (m: Omit<CategoryMeta, 'rgb'>): CategoryMeta => ({ ...m, rgb: hexToRgb(m.color) });

export const CATEGORY: Record<VisualKind, CategoryMeta> = {
  none: meta({
    label: 'Sin detección registrada', short: 'Sin detección', color: '#4b5d7a', symbol: 'dot', shapeCode: 6,
    behavior: 'Solo retícula', description: 'Hubo observación válida y no se registraron focos. No implica ausencia de fuego.',
  }),
  low: meta({
    label: 'Actividad observada baja', short: 'Baja', color: '#f3cf5d', symbol: 'circle', shapeCode: 0,
    behavior: 'Brillo estable', description: 'Pocas detecciones en la celda para el periodo.',
  }),
  medium: meta({
    label: 'Actividad observada media', short: 'Media', color: '#ff9b42', symbol: 'triangle', shapeCode: 1,
    behavior: 'Respiración lenta', description: 'Detecciones repetidas o agrupadas.',
  }),
  high: meta({
    label: 'Actividad observada alta', short: 'Alta', color: '#ff5140', symbol: 'diamond', shapeCode: 2,
    behavior: 'Pulso rápido', description: 'Muchas detecciones o alta potencia radiativa (FRP).',
  }),
  forecast: meta({
    label: 'Probabilidad experimental', short: 'Pronóstico', color: '#a68bff', symbol: 'hexagon', shapeCode: 3,
    behavior: 'Rotación pausada', description: 'Probabilidad estimada de actividad detectada al día siguiente. Experimental, no es una alerta.',
  }),
  anomaly: meta({
    label: 'Anomalía histórica', short: 'Anomalía', color: '#46e0da', symbol: 'wave', shapeCode: 4,
    behavior: 'Onda expansiva', description: 'Actividad muy por encima de lo habitual para la celda y la época del año.',
  }),
  unavailable: meta({
    label: 'Datos no disponibles', short: 'Sin datos', color: '#7d8aa3', symbol: 'void', shapeCode: 5,
    behavior: 'Estático, sin brillo', description: 'Sin observación válida (nubes, huecos de órbita o fuera de rango). No equivale a cero.',
  }),
};

export const LEGEND_ORDER: VisualKind[] = ['low', 'medium', 'high', 'anomaly', 'forecast', 'unavailable', 'none'];

export interface LayerMeta {
  id: DataLayer;
  label: string;
  short: string;
  description: string;
  accent: string;
  hotkey: string;
}

export const LAYERS: LayerMeta[] = [
  { id: 'modis', label: 'MODIS', short: 'MODIS', accent: '#e9d9b0', hotkey: '1', description: 'Recuentos originales MODIS C6.1 (Terra/Aqua, píxel ~1 km).' },
  { id: 'viirs', label: 'VIIRS', short: 'VIIRS', accent: '#7eb6ff', hotkey: '2', description: 'Recuentos originales VIIRS 375 m (S-NPP, NOAA-20, NOAA-21).' },
  { id: 'harmonized', label: 'Armonizado', short: 'Armon.', accent: '#e8f1ff', hotkey: '3', description: 'Índice comparable entre sensores (VIIRS-equivalente), separado de los valores originales.' },
  { id: 'prediction', label: 'Predicción', short: 'Pred.', accent: '#a68bff', hotkey: '4', description: 'Probabilidad experimental de actividad detectada al día siguiente.' },
];

export const SENSOR_COLORS = { MODIS: '#e9d9b0', VIIRS: '#7eb6ff', harmonized: '#e8f1ff' } as const;

export interface Classification {
  kind: VisualKind;
  /** 0..1 — intensidad visual dentro de la categoría. */
  intensity: number;
  /** Valor que representa la capa (recuento, índice o probabilidad). */
  value: number | null;
  anomaly: boolean;
  /** Un sensor detecta y el otro no, ambos con observación válida. */
  discrepancy: boolean;
  partial: boolean;
}

export function layerIndex(record: CellActivity, layer: DataLayer, granularity: Granularity): number | null {
  const scale = (granularity === 'month' ? MONTHLY_INDEX_SCALE : DAILY_INDEX_SCALE) * Math.sqrt(Math.max(1, record.childCount));
  switch (layer) {
    case 'modis':
      return record.modis_detected === null ? null : 1 - Math.exp(-record.modis_detected / scale);
    case 'viirs':
      return record.viirs_detected === null ? null : 1 - Math.exp(-record.viirs_detected / scale);
    case 'harmonized':
      return record.activity_index;
    case 'prediction':
      return record.probability ?? null;
  }
}

export function kindFromIndex(index: number): VisualKind {
  if (index <= 0) return 'none';
  if (index < 0.33) return 'low';
  if (index < 0.66) return 'medium';
  return 'high';
}

export function classify(record: CellActivity, layer: DataLayer, granularity: Granularity): Classification {
  const partial = record.availability_flag === 'partial';
  const discrepancy =
    record.modis_detected !== null &&
    record.viirs_detected !== null &&
    (record.modis_detected > 0) !== (record.viirs_detected > 0);
  if (layer === 'prediction') {
    const p = record.probability ?? null;
    if (p === null) return { kind: 'unavailable', intensity: 0, value: null, anomaly: false, discrepancy, partial };
    if (p < 0.08) return { kind: 'none', intensity: p, value: p, anomaly: false, discrepancy, partial };
    return { kind: 'forecast', intensity: Math.min(1, p), value: p, anomaly: false, discrepancy, partial };
  }
  const index = layerIndex(record, layer, granularity);
  if (index === null) return { kind: 'unavailable', intensity: 0, value: null, anomaly: false, discrepancy: false, partial };
  const value =
    layer === 'modis' ? record.modis_detected : layer === 'viirs' ? record.viirs_detected : record.activity_index;
  return {
    kind: kindFromIndex(index),
    intensity: index,
    value,
    anomaly: Boolean(record.is_anomaly),
    discrepancy,
    partial,
  };
}

export function probabilityBand(p: number): { label: string; tone: 'low' | 'mid' | 'high' } {
  if (p < 0.2) return { label: 'Baja', tone: 'low' };
  if (p < 0.5) return { label: 'Moderada', tone: 'mid' };
  return { label: 'Elevada', tone: 'high' };
}
