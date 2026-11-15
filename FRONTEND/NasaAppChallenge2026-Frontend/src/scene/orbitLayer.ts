/**
 * Modo ÓRBITA: plataformas que producen los datos de T-PENTAGRON.
 *
 * Altitud e inclinación nominales de cada misión (fichas de NASA/NOAA): son reales.
 * La posición de cada satélite sobre su órbita y la orientación del plano orbital son
 * CONCEPTUALES (no hay efemérides en el proyecto): la UI lo rotula «Visualización conceptual».
 */
import * as THREE from 'three';
import { GLOBE_RADIUS } from './dataLayers';

export interface Platform {
  name: string;
  sensor: 'MODIS' | 'VIIRS';
  altKm: number;
  incDeg: number;
  /** Año de lanzamiento. */
  launch: number;
  /** Hora local de paso nominal (ascendente/descendente). */
  crossing: string;
}

export const PLATFORMS: Platform[] = [
  { name: 'Terra', sensor: 'MODIS', altKm: 705, incDeg: 98.2, launch: 1999, crossing: '10:30 descendente' },
  { name: 'Aqua', sensor: 'MODIS', altKm: 705, incDeg: 98.2, launch: 2002, crossing: '13:30 ascendente' },
  { name: 'Suomi NPP', sensor: 'VIIRS', altKm: 824, incDeg: 98.7, launch: 2011, crossing: '13:30 ascendente' },
  { name: 'NOAA-20', sensor: 'VIIRS', altKm: 824, incDeg: 98.7, launch: 2017, crossing: '13:30 ascendente' },
  { name: 'NOAA-21', sensor: 'VIIRS', altKm: 824, incDeg: 98.7, launch: 2022, crossing: '13:30 ascendente' },
];

export const SENSOR_ORBIT_COLOR = { MODIS: '#b59bff', VIIRS: '#8fdcff' } as const;

export interface OrbitLayer {
  group: THREE.Group;
  setOpacity: (o: number) => void;
  /** Posiciones actuales (lat, lng, altitud en radios) para etiquetar en pantalla. */
  positions: () => { name: string; sensor: Platform['sensor']; lat: number; lng: number; alt: number }[];
  dispose: () => void;
}

function radialTexture(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, 'rgba(255,255,255,1)');
  gr.addColorStop(0.25, 'rgba(220,235,255,0.7)');
  gr.addColorStop(1, 'rgba(160,180,255,0)');
  g.fillStyle = gr;
  g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function createOrbitLayer(): OrbitLayer {
  const group = new THREE.Group();
  group.name = 'orbit-layer';
  group.visible = false;
  const dot = radialTexture();
  const items = PLATFORMS.map((p, i) => {
    const R = GLOBE_RADIUS * (1 + p.altKm / 6371);
    // Planos distribuidos para que se lean por separado (orientación conceptual).
    const raan = THREE.MathUtils.degToRad(-60 + i * 38);
    const inc = THREE.MathUtils.degToRad(p.incDeg);
    const q = new THREE.Quaternion()
      .setFromAxisAngle(new THREE.Vector3(0, 1, 0), raan)
      .multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2 - inc + Math.PI / 2));
    const pts: THREE.Vector3[] = [];
    for (let k = 0; k <= 256; k++) {
      const a = (k / 256) * Math.PI * 2;
      pts.push(new THREE.Vector3(Math.cos(a) * R, 0, Math.sin(a) * R).applyQuaternion(q));
    }
    const geo = new THREE.BufferGeometry().setFromPoints(pts);
    const colors = new Float32Array(pts.length * 3);
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    const mat = new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0, depthWrite: false, toneMapped: false });
    const line = new THREE.Line(geo, mat);
    const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: dot, color: SENSOR_ORBIT_COLOR[p.sensor], transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0 }));
    spr.scale.setScalar(7);
    group.add(line, spr);
    return { p, R, q, line, mat, geo, colors, spr, base: new THREE.Color(SENSOR_ORBIT_COLOR[p.sensor]), phase: i * 0.21 };
  });
  let opacity = 0;
  const tmp = new THREE.Vector3();

  const tick = () => {
    if (!group.visible) return;
    const t = performance.now() / 1000;
    for (const it of items) {
      // Período orbital real ≈ 99–101 min; aquí acelerado ~150× para que se perciba el movimiento.
      const ph = (it.phase + t / (it.p.altKm > 800 ? 40.6 : 39.6)) % 1;
      const a = ph * Math.PI * 2;
      it.spr.position.set(Math.cos(a) * it.R, 0, Math.sin(a) * it.R).applyQuaternion(it.q);
      it.spr.material.opacity = opacity;
      const n = it.colors.length / 3;
      for (let k = 0; k < n; k++) {
        let d = (ph - k / (n - 1)) % 1;
        if (d < 0) d += 1;
        const glow = 0.22 + 1.6 * Math.exp(-d * 10);
        it.colors[k * 3] = it.base.r * glow;
        it.colors[k * 3 + 1] = it.base.g * glow;
        it.colors[k * 3 + 2] = it.base.b * glow;
      }
      it.geo.attributes.color.needsUpdate = true;
    }
  };
  // Three.js solo llama onBeforeRender en objetos renderizables: se engancha a la primera línea.
  items[0].line.onBeforeRender = tick;

  return {
    group,
    setOpacity: (o) => {
      opacity = o;
      group.visible = o > 0.005;
      items.forEach((it) => (it.mat.opacity = o * 0.9));
    },
    positions: () =>
      items.map((it) => {
        tmp.copy(it.spr.position);
        const r = tmp.length();
        const lat = 90 - THREE.MathUtils.radToDeg(Math.acos(tmp.y / r));
        const lng = 90 - THREE.MathUtils.radToDeg(Math.atan2(tmp.z, tmp.x));
        return { name: it.p.name, sensor: it.p.sensor, lat, lng: ((lng + 540) % 360) - 180, alt: r / GLOBE_RADIUS - 1 };
      }),
    dispose: () => {
      items.forEach((it) => { it.geo.dispose(); it.mat.dispose(); it.spr.material.dispose(); });
      dot.dispose();
    },
  };
}
