/**
 * Campo de detecciones persistente: un punto luminoso por celda H3 con actividad en la
 * fecha, capa y filtros activos. Complementa a los polígonos y marcadores (que tienen un
 * presupuesto visual limitado) para que, desde la vista mundial, se vean TODAS las celdas
 * con detecciones del periodo sin pulsar nada.
 *
 * Reglas:
 *  - Solo registros reales del snapshot (los de demostración llevan la etiqueta DEMO en la UI).
 *  - El color sigue la leyenda científica (CATEGORY); el tamaño, la intensidad de la capa.
 *  - Aparece en una ola breve al terminar la intro y permanece hasta que cambian los datos.
 *  - El planeta los oculta cuando quedan en la cara opuesta (prueba de profundidad).
 */
import * as THREE from 'three';
import { CATEGORY, classify, type VisualKind } from '@/lib/science/categories';
import type { CellActivity, DataLayer, Granularity } from '@/lib/types/domain';
import type { Filters } from '@/state/store';
import { brand } from '@/config/brand';
import { polarToCartesian } from './dataLayers';

export interface DetectionField {
  points: THREE.Points;
  /** Reemplaza los datos; devuelve el número de celdas dibujadas. */
  setData: (records: CellActivity[], p: { layer: DataLayer; granularity: Granularity; filters: Filters }) => number;
  /** 0 → oculto, 1 → visible (la ola de aparición depende de este valor). */
  setReveal: (v: number) => void;
  setPixelRatio: (pr: number) => void;
  dispose: () => void;
}

const SHOWN: VisualKind[] = ['low', 'medium', 'high', 'forecast', 'anomaly'];

export function createDetectionField(pixelRatio = 1): DetectionField {
  const geo = new THREE.BufferGeometry();
  const mat = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uReveal: { value: 0 }, uPR: { value: pixelRatio } },
    vertexShader: /* glsl */ `
      attribute vec3 aColor; attribute float aSize; attribute float aDelay;
      uniform float uTime; uniform float uReveal; uniform float uPR;
      varying vec3 vColor; varying float vA;
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        float k = clamp((uReveal * 1.35 - aDelay * 0.35) / 1.0, 0.0, 1.0);
        float pop = k < 1.0 ? 1.0 + 0.8 * sin(k * 3.14159) : 1.0;
        float tw = 0.88 + 0.12 * sin(uTime * 2.2 + aDelay * 40.0);
        vColor = aColor;
        vA = k * tw;
        float zoom = clamp(260.0 / -mv.z, 0.75, 3.2);
        gl_PointSize = aSize * uPR * zoom * pop;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      varying vec3 vColor; varying float vA;
      void main() {
        vec2 d = gl_PointCoord - 0.5;
        float r = length(d);
        float core = smoothstep(0.22, 0.0, r);
        float halo = smoothstep(0.5, 0.0, r) * 0.55;
        float a = (core + halo) * vA;
        if (a < 0.01) discard;
        gl_FragColor = vec4(vColor * (0.85 + core * 0.9), a);
      }`,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false;
  points.renderOrder = 6;
  points.name = 'detection-field';
  points.onBeforeRender = () => {
    mat.uniforms.uTime.value = performance.now() / 1000;
  };

  const tmp = new THREE.Vector3();
  const color = new THREE.Color();

  function setData(records: CellActivity[], p: { layer: DataLayer; granularity: Granularity; filters: Filters }): number {
    const pos: number[] = [];
    const col: number[] = [];
    const size: number[] = [];
    const delay: number[] = [];
    for (const r of records) {
      if (p.filters.regionScope === 'pilot' && r.regionId !== brand.pilot.regionId) continue;
      const c = classify(r, p.layer, p.granularity);
      if (!SHOWN.includes(c.kind)) continue;
      if (p.filters.onlyAnomalies && !c.anomaly) continue;
      if (!p.filters.kinds[c.kind]) continue;
      polarToCartesian(r.center.lat, r.center.lng, 0.0035, tmp);
      pos.push(tmp.x, tmp.y, tmp.z);
      color.set(CATEGORY[c.anomaly && p.filters.kinds.anomaly ? 'anomaly' : c.kind].color);
      col.push(color.r, color.g, color.b);
      size.push(3.2 + 6.5 * Math.min(1, c.intensity));
      // Ola de aparición: de oeste a este y algo de variación para que no sea mecánica.
      delay.push(Math.min(1, Math.max(0, (r.center.lng + 75) / 25)) * 0.8 + ((r.center.lat * 7.31) % 1 + 1) % 1 * 0.2);
    }
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('aColor', new THREE.Float32BufferAttribute(col, 3));
    geo.setAttribute('aSize', new THREE.Float32BufferAttribute(size, 1));
    geo.setAttribute('aDelay', new THREE.Float32BufferAttribute(delay, 1));
    geo.computeBoundingSphere();
    return size.length;
  }

  return {
    points,
    setData,
    setReveal: (v) => (mat.uniforms.uReveal.value = v),
    setPixelRatio: (pr) => (mat.uniforms.uPR.value = pr),
    dispose: () => {
      geo.dispose();
      mat.dispose();
    },
  };
}
