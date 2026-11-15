/**
 * Proveedores de mapa base de la vista regional.
 *
 * - NASA GIBS (WMTS, EPSG:3857): no requiere credenciales. La capa VIIRS True Color es
 *   imagen REAL del día seleccionado; se superpone a datos de DEMOSTRACIÓN (se indica).
 * - Google Maps: integración preparada; requiere NEXT_PUBLIC_GOOGLE_MAPS_API_KEY y un
 *   adaptador (Maps JavaScript API) que todavía no se carga para no exigir credenciales.
 */
import { env } from '@/config/env';

export type BasemapId = 'gibs-viirs' | 'gibs-bluemarble' | 'none' | 'google';

export interface BasemapDef {
  id: BasemapId;
  label: string;
  description: string;
  available: boolean;
  unavailableReason?: string;
  url?: (date: string) => string;
  maxNativeZoom?: number;
  attribution?: string;
  dateDependent?: boolean;
}

const GIBS = 'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best';

export const BASEMAPS: BasemapDef[] = [
  {
    id: 'gibs-viirs',
    label: 'Satélite del día',
    description: 'VIIRS (Suomi NPP) color verdadero corregido — NASA GIBS',
    available: env.enableGibs,
    unavailableReason: 'Desactivado (NEXT_PUBLIC_ENABLE_GIBS=false)',
    url: (date) => `${GIBS}/VIIRS_SNPP_CorrectedReflectance_TrueColor/default/${date}/GoogleMapsCompatible_Level9/{z}/{y}/{x}.jpg`,
    maxNativeZoom: 9,
    attribution: 'Imágenes: NASA EOSDIS GIBS / Worldview',
    dateDependent: true,
  },
  {
    id: 'gibs-bluemarble',
    label: 'Relieve',
    description: 'Blue Marble con relieve sombreado — NASA GIBS',
    available: env.enableGibs,
    unavailableReason: 'Desactivado (NEXT_PUBLIC_ENABLE_GIBS=false)',
    url: () => `${GIBS}/BlueMarble_ShadedRelief_Bathymetry/default/GoogleMapsCompatible_Level8/{z}/{y}/{x}.jpeg`,
    maxNativeZoom: 8,
    attribution: 'NASA Blue Marble · GIBS',
  },
  {
    id: 'none',
    label: 'Sin mapa base',
    description: 'Solo la retícula H3 (funciona sin conexión)',
    available: true,
  },
  {
    id: 'google',
    label: 'Google Maps',
    description: 'Integración futura (mapas detallados y calles)',
    available: false,
    unavailableReason: env.googleMapsApiKey
      ? 'Clave detectada: falta activar el adaptador en src/components/regional/basemaps.ts'
      : 'Requiere NEXT_PUBLIC_GOOGLE_MAPS_API_KEY (no incluida)',
  },
];

export const LABELS_OVERLAY = `${GIBS}/Reference_Labels_15m/default/GoogleMapsCompatible_Level13/{z}/{y}/{x}.png`;
