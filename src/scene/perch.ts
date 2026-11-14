/** Posición ("percha") de la estrella guardiana en pantalla, compartida por intro y observatorio. */
export interface Perch {
  x: number;
  y: number;
  scale: number;
}

/**
 * Escritorio: arriba a la izquierda, bajo la marca y por encima de la leyenda.
 * Móvil: arriba a la derecha, bajo la barra de herramientas.
 */
export function perchFor(width: number, height = 800): Perch {
  if (width < 760) return { x: 0.84, y: 0.2, scale: 0.042 };
  const y = Math.min(0.25, Math.max(0.2, 150 / Math.max(1, height)));
  return { x: Math.min(0.17, 190 / Math.max(1, width)), y, scale: height < 700 ? 0.042 : 0.05 };
}
