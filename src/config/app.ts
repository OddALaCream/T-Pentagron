import type { DataLayer } from '@/lib/types/domain';
import { env } from './env';

/** Parámetros generales de la experiencia (no de marca). */
export const appConfig = {
  /** Fecha con la que abre el observatorio (temporada de quemas en la zona piloto). */
  defaultDate: env.dataMode === 'api' ? '2024-09-06' : '2026-09-08',
  defaultLayer: 'harmonized' as DataLayer,
  /** Punto de vista inicial: la zona piloto ligeramente desplazada para mostrar el continente. */
  initialView: { lat: -14, lng: -64, altitude: 2.35 },
  /** Duración objetivo de la introducción completa (s). */
  introDuration: 9.4,
  /** Intervalo base de reproducción (ms por paso a velocidad 1×). */
  playbackBaseMs: 700,
  playbackSpeeds: [0.5, 1, 2, 4] as const,
  /** Umbrales de altitud (radios terrestres) para cambiar la resolución H3 mostrada. */
  resolutionThresholds: { res6: 0.42, res5: 1.25 },
  /** Periodicidad del escaneo ambiental automático (ms). */
  autoScanEveryMs: 50_000,
} as const;
