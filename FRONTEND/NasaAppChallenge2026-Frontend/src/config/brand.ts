/**
 * Identidad del producto centralizada: T-PENTAGRON.
 * La mención de la NASA describe las fuentes de datos y el reto (Space Apps), no una afiliación.
 */
import { env } from './env';
export const brand = {
  /** Nombre visible en la cabecera. */
  name: 'T-PENTAGRON',
  /** Nombre largo para títulos y metadatos. */
  fullName: 'T-PENTAGRON · Observatorio de actividad térmica terrestre',
  /** Monograma para espacios reducidos. */
  shortMark: 'TP',
  /** Lema oficial. */
  tagline: 'Un vigía en las estrellas para cuidar lo que ocurre en la Tierra',
  /** Nombre de la estrella guardiana (Vigía) que acompaña al observatorio. */
  mascotName: 'Vigía',
  team: 'BELL7738',
  event: 'NASA Space Apps Challenge 2026',
  challenge: 'Harmonization of MODIS and VIIRS Hot Spots',
  challengeUrl:
    'https://www.spaceappschallenge.org/2026/challenges/harmonization-of-modis-and-viirs-hot-spots/',
  pilot: {
    regionId: env.dataMode === 'api' ? 'bolivia' : 'chiquitania',
    label: env.dataMode === 'api' ? 'Bolivia · archivo FIRMS' : 'Chiquitanía · Santa Cruz, Bolivia',
  },
} as const;
