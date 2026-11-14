/**
 * Catálogo de regiones de DEMOSTRACIÓN.
 *
 * Coordenadas y estacionalidad aproximada son reales (para que la demo tenga sentido
 * geográfico), pero todas las magnitudes de actividad derivadas son simuladas.
 */

export interface SeasonPeak {
  /** Día del año del máximo. */
  doy: number;
  /** Anchura (desviación, días). */
  width: number;
  weight: number;
}

export interface Hotspot {
  lat: number;
  lng: number;
  /** Radio del anillo H3 (k) a resolución 6. */
  k: number;
}

export interface RegionDef {
  id: string;
  name: string;
  country: string;
  countryCode: string;
  admin: string;
  biome: string;
  center: { lat: number; lng: number };
  isPilot: boolean;
  description: string;
  seasonLabel: string;
  utcOffset: number;
  peaks: SeasonPeak[];
  /** Intensidad base relativa. */
  base: number;
  /** Factor interanual (año → multiplicador). */
  years: Record<number, number>;
  /** Estación húmeda (nubosidad): pico (doy), amplitud y base. */
  clouds: { doy: number; amplitude: number; base: number };
  /** Relación esperada de detecciones MODIS/VIIRS (sensibilidad relativa). */
  modisRatio: number;
  /** Clima medio para el generador meteorológico. */
  climate: { tMean: number; tAmp: number; tPeakDoy: number };
  /** Polígono AOI (lng, lat) — solo región piloto. */
  aoi?: [number, number][];
  hotspots: Hotspot[];
  seed: number;
}

export const REGION_DEFS: RegionDef[] = [
  {
    id: 'chiquitania',
    name: 'Chiquitanía',
    country: 'Bolivia',
    countryCode: 'BO',
    admin: 'Santa Cruz',
    biome: 'Bosque seco chiquitano',
    center: { lat: -16.75, lng: -60.85 },
    isPilot: true,
    description:
      'Zona piloto científica. Transición entre bosque seco chiquitano, Cerrado y Pantanal, con temporada de quemas entre julio y octubre.',
    seasonLabel: 'jul – oct',
    utcOffset: -4,
    peaks: [{ doy: 244, width: 27, weight: 1 }],
    base: 1.0,
    years: { 2023: 0.95, 2024: 1.5, 2025: 1.05, 2026: 1.2 },
    clouds: { doy: 25, amplitude: 0.5, base: 0.05 },
    modisRatio: 0.3,
    climate: { tMean: 25.5, tAmp: 3.5, tPeakDoy: 290 },
    aoi: [
      [-62.15, -15.75], [-61.2, -15.55], [-60.15, -15.7], [-59.45, -16.15], [-59.35, -16.95],
      [-59.7, -17.6], [-60.45, -17.95], [-61.35, -17.85], [-61.95, -17.35], [-62.25, -16.55],
      [-62.15, -15.75],
    ],
    hotspots: [
      { lat: -16.37, lng: -60.96, k: 0 }, // San Ignacio de Velasco
      { lat: -16.13, lng: -62.03, k: 0 }, // Concepción
      { lat: -17.85, lng: -60.74, k: 0 }, // San José de Chiquitos
      { lat: -16.9, lng: -59.9, k: 0 },
    ],
    seed: 11,
  },
  {
    id: 'pantanal',
    name: 'Pantanal Sur',
    country: 'Brasil',
    countryCode: 'BR',
    admin: 'Mato Grosso do Sul',
    biome: 'Humedal tropical',
    center: { lat: -18.9, lng: -57.3 },
    isPilot: false,
    description: 'Mayor humedal continental; los incendios de estación seca afectan planicies de inundación.',
    seasonLabel: 'ago – oct',
    utcOffset: -4,
    peaks: [{ doy: 255, width: 28, weight: 1 }],
    base: 1.3,
    years: { 2023: 0.8, 2024: 1.6, 2025: 0.9, 2026: 1.0 },
    clouds: { doy: 30, amplitude: 0.45, base: 0.05 },
    modisRatio: 0.32,
    climate: { tMean: 26, tAmp: 4, tPeakDoy: 300 },
    hotspots: [
      { lat: -18.95, lng: -57.6, k: 5 },
      { lat: -18.5, lng: -56.9, k: 4 },
      { lat: -19.35, lng: -57.1, k: 4 },
    ],
    seed: 23,
  },
  {
    id: 'rondonia',
    name: 'Arco de deforestación',
    country: 'Brasil',
    countryCode: 'BR',
    admin: 'Rondônia / Amazonas',
    biome: 'Bosque amazónico',
    center: { lat: -8.9, lng: -63.6 },
    isPilot: false,
    description: 'Frontera agrícola amazónica con quemas asociadas a cambio de uso del suelo.',
    seasonLabel: 'ago – sep',
    utcOffset: -4,
    peaks: [{ doy: 240, width: 22, weight: 1 }],
    base: 1.5,
    years: { 2023: 0.9, 2024: 1.35, 2025: 0.95, 2026: 1.05 },
    clouds: { doy: 50, amplitude: 0.6, base: 0.08 },
    modisRatio: 0.28,
    climate: { tMean: 26.5, tAmp: 1.5, tPeakDoy: 260 },
    hotspots: [
      { lat: -8.8, lng: -63.9, k: 5 },
      { lat: -9.2, lng: -63.2, k: 4 },
      { lat: -8.5, lng: -64.4, k: 4 },
    ],
    seed: 37,
  },
  {
    id: 'angola-miombo',
    name: 'Miombo del Moxico',
    country: 'Angola',
    countryCode: 'AO',
    admin: 'Moxico',
    biome: 'Sabana arbolada (miombo)',
    center: { lat: -12.4, lng: 21.4 },
    isPilot: false,
    description: 'Sabanas africanas con quemas estacionales extensas; alta densidad de focos.',
    seasonLabel: 'jun – sep',
    utcOffset: 1,
    peaks: [{ doy: 205, width: 32, weight: 1 }],
    base: 2.2,
    years: { 2023: 1.05, 2024: 1.0, 2025: 1.1, 2026: 0.95 },
    clouds: { doy: 20, amplitude: 0.55, base: 0.04 },
    modisRatio: 0.34,
    climate: { tMean: 22, tAmp: 4, tPeakDoy: 280 },
    hotspots: [
      { lat: -12.3, lng: 21.0, k: 5 },
      { lat: -12.8, lng: 21.8, k: 5 },
      { lat: -11.9, lng: 22.1, k: 4 },
    ],
    seed: 41,
  },
  {
    id: 'car-savanna',
    name: 'Sabana sudanesa',
    country: 'República Centroafricana',
    countryCode: 'CF',
    admin: 'Vakaga / Bamingui',
    biome: 'Sabana sudano-guineana',
    center: { lat: 8.4, lng: 21.6 },
    isPilot: false,
    description: 'Estación seca boreal: quemas de diciembre a febrero.',
    seasonLabel: 'dic – feb',
    utcOffset: 1,
    peaks: [{ doy: 15, width: 30, weight: 1 }],
    base: 2,
    years: { 2023: 1.0, 2024: 1.05, 2025: 0.95, 2026: 1.05 },
    clouds: { doy: 215, amplitude: 0.55, base: 0.04 },
    modisRatio: 0.35,
    climate: { tMean: 27, tAmp: 3, tPeakDoy: 90 },
    hotspots: [
      { lat: 8.6, lng: 21.3, k: 5 },
      { lat: 8.1, lng: 22.0, k: 4 },
    ],
    seed: 53,
  },
  {
    id: 'arnhem',
    name: 'Arnhem Land',
    country: 'Australia',
    countryCode: 'AU',
    admin: 'Territorio del Norte',
    biome: 'Sabana tropical',
    center: { lat: -12.9, lng: 134.2 },
    isPilot: false,
    description: 'Quemas tempranas de manejo (may–jul) e incendios tardíos más intensos (ago–nov).',
    seasonLabel: 'may – nov',
    utcOffset: 9.5,
    peaks: [
      { doy: 160, width: 25, weight: 0.55 },
      { doy: 270, width: 28, weight: 1 },
    ],
    base: 1.5,
    years: { 2023: 1.1, 2024: 0.95, 2025: 1.0, 2026: 1.05 },
    clouds: { doy: 30, amplitude: 0.6, base: 0.03 },
    modisRatio: 0.33,
    climate: { tMean: 28, tAmp: 3, tPeakDoy: 320 },
    hotspots: [
      { lat: -12.7, lng: 133.9, k: 5 },
      { lat: -13.2, lng: 134.6, k: 5 },
    ],
    seed: 67,
  },
  {
    id: 'kalimantan',
    name: 'Kalimantan Central',
    country: 'Indonesia',
    countryCode: 'ID',
    admin: 'Kalimantan Tengah',
    biome: 'Turberas tropicales',
    center: { lat: -2.4, lng: 113.9 },
    isPilot: false,
    description: 'Incendios de turba en años secos (El Niño); humo persistente.',
    seasonLabel: 'ago – oct',
    utcOffset: 7,
    peaks: [{ doy: 265, width: 22, weight: 1 }],
    base: 1,
    years: { 2023: 1.7, 2024: 0.7, 2025: 0.8, 2026: 1.0 },
    clouds: { doy: 10, amplitude: 0.5, base: 0.15 },
    modisRatio: 0.29,
    climate: { tMean: 27, tAmp: 1, tPeakDoy: 270 },
    hotspots: [
      { lat: -2.3, lng: 113.7, k: 5 },
      { lat: -2.8, lng: 114.2, k: 4 },
    ],
    seed: 71,
  },
  {
    id: 'punjab',
    name: 'Llanura del Punyab',
    country: 'India',
    countryCode: 'IN',
    admin: 'Punyab',
    biome: 'Cultivos de regadío',
    center: { lat: 30.6, lng: 75.4 },
    isPilot: false,
    description: 'Quema de rastrojos agrícolas: abril–mayo (trigo) y octubre–noviembre (arroz).',
    seasonLabel: 'abr – may · oct – nov',
    utcOffset: 5.5,
    peaks: [
      { doy: 122, width: 12, weight: 0.45 },
      { doy: 306, width: 13, weight: 1 },
    ],
    base: 2.0,
    years: { 2023: 1.1, 2024: 0.85, 2025: 0.8, 2026: 0.9 },
    clouds: { doy: 205, amplitude: 0.45, base: 0.04 },
    modisRatio: 0.24,
    climate: { tMean: 24, tAmp: 9, tPeakDoy: 165 },
    hotspots: [
      { lat: 30.7, lng: 75.1, k: 5 },
      { lat: 30.3, lng: 75.8, k: 5 },
      { lat: 31.1, lng: 75.6, k: 4 },
    ],
    seed: 83,
  },
  {
    id: 'shan',
    name: 'Meseta Shan',
    country: 'Myanmar',
    countryCode: 'MM',
    admin: 'Estado Shan',
    biome: 'Bosque monzónico',
    center: { lat: 20.9, lng: 97.9 },
    isPilot: false,
    description: 'Agricultura itinerante y quemas de estación seca (feb–abr).',
    seasonLabel: 'feb – abr',
    utcOffset: 6.5,
    peaks: [{ doy: 78, width: 22, weight: 1 }],
    base: 1.5,
    years: { 2023: 1.1, 2024: 1.2, 2025: 0.9, 2026: 1.0 },
    clouds: { doy: 215, amplitude: 0.6, base: 0.05 },
    modisRatio: 0.31,
    climate: { tMean: 22, tAmp: 5, tPeakDoy: 120 },
    hotspots: [
      { lat: 20.8, lng: 97.6, k: 5 },
      { lat: 21.2, lng: 98.2, k: 4 },
    ],
    seed: 97,
  },
  {
    id: 'yakutia',
    name: 'Taiga de Yakutia',
    country: 'Rusia',
    countryCode: 'RU',
    admin: 'República de Sajá',
    biome: 'Bosque boreal',
    center: { lat: 62.6, lng: 128.5 },
    isPilot: false,
    description: 'Incendios boreales de verano, con años extremos y humo de larga distancia.',
    seasonLabel: 'jun – ago',
    utcOffset: 9,
    peaks: [{ doy: 195, width: 22, weight: 1 }],
    base: 1.2,
    years: { 2023: 0.9, 2024: 1.3, 2025: 1.0, 2026: 0.85 },
    clouds: { doy: 330, amplitude: 0.4, base: 0.12 },
    modisRatio: 0.36,
    climate: { tMean: -8, tAmp: 26, tPeakDoy: 196 },
    hotspots: [
      { lat: 62.5, lng: 128.0, k: 5 },
      { lat: 63.0, lng: 129.2, k: 5 },
    ],
    seed: 101,
  },
  {
    id: 'bc-canada',
    name: 'Interior de Columbia Británica',
    country: 'Canadá',
    countryCode: 'CA',
    admin: 'Columbia Británica',
    biome: 'Bosque boreal montano',
    center: { lat: 56.4, lng: -121.6 },
    isPilot: false,
    description: 'Temporadas de incendios forestales cada vez más largas (may–sep).',
    seasonLabel: 'may – sep',
    utcOffset: -7,
    peaks: [{ doy: 205, width: 28, weight: 1 }],
    base: 1,
    years: { 2023: 1.8, 2024: 1.1, 2025: 1.2, 2026: 0.9 },
    clouds: { doy: 340, amplitude: 0.4, base: 0.12 },
    modisRatio: 0.38,
    climate: { tMean: 2, tAmp: 16, tPeakDoy: 200 },
    hotspots: [
      { lat: 56.2, lng: -121.9, k: 5 },
      { lat: 56.7, lng: -121.1, k: 4 },
    ],
    seed: 113,
  },
  {
    id: 'sierra-nevada',
    name: 'Sierra Nevada',
    country: 'Estados Unidos',
    countryCode: 'US',
    admin: 'California',
    biome: 'Bosque mediterráneo de coníferas',
    center: { lat: 39.3, lng: -120.9 },
    isPilot: false,
    description: 'Clima mediterráneo: incendios de julio a octubre, a veces de gran intensidad.',
    seasonLabel: 'jul – oct',
    utcOffset: -7,
    peaks: [{ doy: 225, width: 30, weight: 1 }],
    base: 0.8,
    years: { 2023: 0.7, 2024: 1.2, 2025: 0.9, 2026: 1.0 },
    clouds: { doy: 15, amplitude: 0.45, base: 0.04 },
    modisRatio: 0.4,
    climate: { tMean: 13, tAmp: 9, tPeakDoy: 205 },
    hotspots: [
      { lat: 39.5, lng: -121.1, k: 5 },
      { lat: 39.0, lng: -120.6, k: 4 },
    ],
    seed: 127,
  },
  {
    id: 'portugal',
    name: 'Pinhal Interior',
    country: 'Portugal',
    countryCode: 'PT',
    admin: 'Centro',
    biome: 'Bosque mediterráneo',
    center: { lat: 39.85, lng: -8.1 },
    isPilot: false,
    description: 'Paisaje forestal mediterráneo con incendios estivales concentrados.',
    seasonLabel: 'jul – sep',
    utcOffset: 1,
    peaks: [{ doy: 222, width: 18, weight: 1 }],
    base: 0.7,
    years: { 2023: 0.8, 2024: 1.3, 2025: 1.1, 2026: 0.9 },
    clouds: { doy: 20, amplitude: 0.45, base: 0.05 },
    modisRatio: 0.38,
    climate: { tMean: 16, tAmp: 7, tPeakDoy: 210 },
    hotspots: [
      { lat: 39.8, lng: -8.3, k: 4 },
      { lat: 40.1, lng: -7.9, k: 4 },
    ],
    seed: 131,
  },
];

export const REGION_BY_ID: Record<string, RegionDef> = Object.fromEntries(REGION_DEFS.map((r) => [r.id, r]));
