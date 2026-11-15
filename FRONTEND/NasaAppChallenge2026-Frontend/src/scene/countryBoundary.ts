import * as THREE from 'three';
import { env } from '@/config/env';
import { boliviaRings } from '@/lib/geo/bolivia';

// Display-only clipping mask. API point filtering uses the exact GeoJSON polygon.
let mask: THREE.CanvasTexture | null = null;
export function countryUniforms() {
  if (!mask && typeof document !== 'undefined') {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 2048;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, 2048, 2048);
    ctx.beginPath();
    for (const ring of boliviaRings) {
      ring.forEach(([lng, lat], i) => {
        const x = (lng + 70) / 13 * 2048, y = (-9 - lat) / 15 * 2048;
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      });
      ctx.closePath();
    }
    ctx.fillStyle = '#fff'; ctx.fill('evenodd');
    mask = new THREE.CanvasTexture(canvas);
    mask.minFilter = mask.magFilter = THREE.NearestFilter;
  }
  return { uCountryMask: { value: mask }, uCountryClip: { value: env.dataMode === 'api' ? 1 : 0 } };
}

export const countryClipGLSL = /* glsl */ `
uniform sampler2D uCountryMask;
uniform float uCountryClip;
void clipCountry(vec3 pos) {
  if (uCountryClip < 0.5) return;
  vec3 d = normalize(pos);
  vec2 ll = vec2(degrees(atan(d.x, d.z)), degrees(asin(d.y)));
  vec2 uv = (ll - vec2(-70.0, -24.0)) / vec2(13.0, 15.0);
  if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) discard;
  if (texture2D(uCountryMask, uv).r < 0.5) discard;
}`;

export function createCountryBorder() {
  const points: number[] = [];
  const xyz = ([lng, lat]: number[]) => {
    const p = lat * Math.PI / 180, l = lng * Math.PI / 180, r = 100.075;
    return [r * Math.cos(p) * Math.sin(l), r * Math.sin(p), r * Math.cos(p) * Math.cos(l)];
  };
  for (const ring of boliviaRings) for (let i = 1; i < ring.length; i++) points.push(...xyz(ring[i - 1]), ...xyz(ring[i]));
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(points, 3));
  const material = new THREE.LineBasicMaterial({ color: '#91d7e4', transparent: true, opacity: 0.85, depthWrite: false });
  const lines = new THREE.LineSegments(geometry, material);
  lines.name = 'Bolivia · Natural Earth 1:10m';
  lines.renderOrder = 6;
  lines.visible = env.dataMode === 'api';
  return lines;
}
