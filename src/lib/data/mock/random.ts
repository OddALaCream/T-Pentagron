/**
 * Aleatoriedad determinista: todas las funciones son puras (misma entrada → misma salida).
 * Así los datos de demostración no cambian entre renders, recargas ni dispositivos.
 */

/** FNV-1a de 32 bits para cadenas (p. ej. índices H3). */
export function hashString(value: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < value.length; i++) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Mezcla de enteros (finalizador tipo murmur3). */
export function mix(a: number, b: number): number {
  let h = (a ^ Math.imul(b | 0, 0x9e3779b1)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

/** Uniforme en [0, 1) a partir de hasta tres claves enteras. */
export function u01(a: number, b: number, c = 0): number {
  return mix(mix(a, b), c) / 4294967296;
}

/** Normal estándar determinista (Box-Muller). */
export function normal(a: number, b: number, c = 0): number {
  const u1 = Math.max(1e-9, u01(a, b, c));
  const u2 = u01(a, b, c + 7919);
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

/** Ruido de valor 1D suavizado en [0, 1]. */
export function noise1D(seed: number, x: number): number {
  const i = Math.floor(x);
  const f = x - i;
  const a = u01(seed, i);
  const b = u01(seed, i + 1);
  const t = f * f * (3 - 2 * f);
  return a + (b - a) * t;
}

/** Ruido fractal 1D (3 octavas) normalizado a [0, 1]. */
export function fbm1D(seed: number, x: number): number {
  return (noise1D(seed, x) * 0.57 + noise1D(seed + 101, x * 2.03) * 0.29 + noise1D(seed + 211, x * 4.1) * 0.14);
}

/** Ruido de valor 2D suavizado en [0, 1]. */
export function noise2D(seed: number, x: number, y: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const h = (i: number, j: number) => u01(seed, mix(i, 0x51ed27), j);
  const tx = xf * xf * (3 - 2 * xf);
  const ty = yf * yf * (3 - 2 * yf);
  const a = h(xi, yi);
  const b = h(xi + 1, yi);
  const c = h(xi, yi + 1);
  const d = h(xi + 1, yi + 1);
  return a + (b - a) * tx + (c - a) * ty + (a - b - c + d) * tx * ty;
}

export function fbm2D(seed: number, x: number, y: number): number {
  return (
    noise2D(seed, x, y) * 0.55 +
    noise2D(seed + 17, x * 2.1, y * 2.1) * 0.3 +
    noise2D(seed + 41, x * 4.3, y * 4.3) * 0.15
  );
}

/** Muestra Poisson por transformada inversa a partir de un uniforme dado. */
export function poisson(lambda: number, u: number): number {
  if (lambda <= 0) return 0;
  const l = Math.exp(-lambda);
  if (u < l) return 0;
  let k = 0;
  let p = l;
  let cumulative = l;
  while (u > cumulative && k < 400) {
    k++;
    p *= lambda / k;
    cumulative += p;
  }
  return k;
}

export function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}
