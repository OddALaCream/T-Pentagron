/**
 * Carga y reutilización de texturas (una sola instancia por URL en todo el ciclo de vida).
 */
import * as THREE from 'three';
import type { Quality } from '@/state/store';

const cache = new Map<string, Promise<THREE.Texture>>();
const loader = typeof window !== 'undefined' ? new THREE.TextureLoader() : null;

export function loadTexture(url: string, srgb = true): Promise<THREE.Texture> {
  const key = `${url}|${srgb}`;
  let p = cache.get(key);
  if (!p) {
    p = new Promise<THREE.Texture>((resolve, reject) => {
      loader!.load(
        url,
        (tex) => {
          tex.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
          tex.anisotropy = 4;
          tex.needsUpdate = true;
          resolve(tex);
        },
        undefined,
        () => reject(new Error(`No se pudo cargar la textura ${url}`)),
      );
    });
    cache.set(key, p);
  }
  return p;
}

export function earthTextureUrls(quality: Quality) {
  const big = quality === 'high';
  return {
    day: `/textures/earth-day-${big ? '4k' : '2k'}.jpg`,
    night: `/textures/earth-night-${big ? '4k' : '2k'}.jpg`,
    water: '/textures/earth-water-2k.jpg',
    topo: '/textures/earth-topology-2k.jpg',
    clouds: `/textures/clouds-${big ? '4k' : '2k'}.jpg`,
  };
}

/** Textura radial suave generada en canvas (halos, chispas). */
export function radialTexture(stops: [number, string][] = [[0, 'rgba(255,255,255,1)'], [0.25, 'rgba(255,255,255,0.45)'], [1, 'rgba(255,255,255,0)']], size = 128): THREE.Texture {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  for (const [o, c] of stops) g.addColorStop(o, c);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
