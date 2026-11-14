/**
 * Variables de entorno públicas (se leen en el navegador).
 * Ver `.env.example` para la documentación de cada una.
 */
export type DataMode = 'mock' | 'api';

const rawMode = process.env.NEXT_PUBLIC_DATA_MODE;

export const env = {
  dataMode: (rawMode === 'api' ? 'api' : 'mock') as DataMode,
  apiBaseUrl: (process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:8000').replace(/\/+$/, ''),
  apiTimeoutMs: Number(process.env.NEXT_PUBLIC_API_TIMEOUT_MS || 15000),
  googleMapsApiKey: process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY || '',
  enableGibs: process.env.NEXT_PUBLIC_ENABLE_GIBS !== 'false',
} as const;
