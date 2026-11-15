/**
 * Utilidades H3 para el frontend. Las geometrías son límites H3 auténticos (h3-js)
 * convertidos a GeoJSON [lng, lat] con anillo cerrado, listos para la capa de
 * polígonos de react-globe.gl (no se usan los hexágonos gráficos de Globe.gl).
 */
import { cellToBoundary, cellToLatLng, getResolution, isValidCell, latLngToCell } from 'h3-js';
import type { LatLng } from '@/lib/types/domain';

export interface H3Polygon {
  type: 'Polygon';
  coordinates: [number, number][][];
}

const boundaryCache = new Map<string, H3Polygon>();

/**
 * Límite de la celda como GeoJSON [lng, lat] cerrado y en sentido HORARIO.
 * three-globe triangula con d3-geo, que interpreta un anillo antihorario (el que entrega
 * h3-js) como el complemento esférico: «todo el planeta menos el hexágono». Invertir el
 * anillo es imprescindible; Leaflet acepta cualquier sentido.
 */
export function cellPolygon(h3: string): H3Polygon {
  let poly = boundaryCache.get(h3);
  if (!poly) {
    const ring = (cellToBoundary(h3, true) as [number, number][]).slice().reverse();
    poly = { type: 'Polygon', coordinates: [ring] };
    boundaryCache.set(h3, poly);
  }
  return poly;
}

export function cellCenter(h3: string): LatLng {
  const [lat, lng] = cellToLatLng(h3);
  return { lat, lng };
}

export function safeResolution(h3: string): number | null {
  return isValidCell(h3) ? getResolution(h3) : null;
}

export function pointToCell(point: LatLng, resolution: number): string {
  return latLngToCell(point.lat, point.lng, resolution);
}

/** Formato científico de coordenadas: 16.372° S, 60.961° O */
export function formatLat(lat: number, digits = 3): string {
  return `${Math.abs(lat).toFixed(digits)}° ${lat < 0 ? 'S' : 'N'}`;
}

export function formatLng(lng: number, digits = 3): string {
  return `${Math.abs(lng).toFixed(digits)}° ${lng < 0 ? 'O' : 'E'}`;
}

export function formatLatLng(p: LatLng, digits = 3): string {
  return `${formatLat(p.lat, digits)}, ${formatLng(p.lng, digits)}`;
}

/** Distancia angular (radianes) entre dos puntos geográficos. */
export function angularDistance(a: LatLng, b: LatLng): number {
  const toRad = Math.PI / 180;
  const s =
    Math.sin(a.lat * toRad) * Math.sin(b.lat * toRad) +
    Math.cos(a.lat * toRad) * Math.cos(b.lat * toRad) * Math.cos((a.lng - b.lng) * toRad);
  return Math.acos(Math.max(-1, Math.min(1, s)));
}

/** Vector unitario en el sistema de coordenadas de three-globe (x=cos·sin, y=sin(lat), z=cos·cos). */
export function latLngToUnit(p: LatLng): [number, number, number] {
  const toRad = Math.PI / 180;
  const lat = p.lat * toRad;
  const lng = p.lng * toRad;
  return [Math.cos(lat) * Math.sin(lng), Math.sin(lat), Math.cos(lat) * Math.cos(lng)];
}

export function shortH3(h3: string): string {
  return h3.length > 10 ? `${h3.slice(0, 6)}…${h3.slice(-4)}` : h3;
}
