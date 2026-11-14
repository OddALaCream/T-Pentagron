/**
 * Identidad del producto centralizada.
 *
 * El nombre definitivo todavía no está decidido: cambia aquí `name`, `fullName`
 * y `shortMark` y toda la interfaz (título, intro, cabecera, metadatos) se actualiza.
 */
export const brand = {
  /** Nombre corto visible en la cabecera. */
  name: 'Observatorio',
  /** Nombre largo para títulos y metadatos. */
  fullName: 'Observatorio de Actividad Térmica Terrestre',
  /** Nombre en clave del proyecto (provisional, no es la identidad final). */
  codename: 'FireSight',
  /** Monograma para espacios reducidos. */
  shortMark: 'OT',
  tagline: 'Armonización MODIS + VIIRS · calendario histórico · pronóstico experimental',
  /** Nombre de la estrella guardiana (mascota). */
  mascotName: 'Vigía',
  event: 'NASA Space Apps Challenge 2026',
  challenge: 'Harmonization of MODIS and VIIRS Hot Spots',
  challengeUrl:
    'https://www.spaceappschallenge.org/2026/challenges/harmonization-of-modis-and-viirs-hot-spots/',
  pilot: {
    regionId: 'chiquitania',
    label: 'Chiquitanía · Santa Cruz, Bolivia',
  },
} as const;

/** Nombres alternativos propuestos para la identidad definitiva. */
export const nameProposals = ['Vigía Térmica', 'Ember Atlas', 'Calor Orbital', 'Pyra', 'Atalaya'] as const;
