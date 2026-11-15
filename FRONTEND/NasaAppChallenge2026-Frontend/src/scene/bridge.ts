/**
 * Puente mínimo entre la escena del globo y otros componentes (introducción,
 * transición regional, controles de cámara) sin acoplarlos a React.
 */
import type { GlobeMethods } from 'react-globe.gl';
import type { ObservatoryEngine } from './observatoryEngine';
import type { OrbitLayer } from './orbitLayer';

export interface GlobeBridge {
  globe: GlobeMethods;
  engine: ObservatoryEngine;
  /** Capa de órbitas (modo ÓRBITA), si ya está creada. */
  orbit?: OrbitLayer;
}

let current: GlobeBridge | null = null;
const listeners = new Set<(b: GlobeBridge | null) => void>();

export const globeBridge = {
  get: () => current,
  set: (bridge: GlobeBridge | null) => {
    current = bridge;
    listeners.forEach((l) => l(bridge));
  },
  subscribe: (fn: (b: GlobeBridge | null) => void) => {
    listeners.add(fn);
    return () => {
      listeners.delete(fn);
    };
  },
  zoom: (factor: number) => {
    if (!current) return;
    const pov = current.globe.pointOfView();
    current.globe.pointOfView({ altitude: Math.max(0.03, Math.min(6, pov.altitude * factor)) }, 450);
  },
};
