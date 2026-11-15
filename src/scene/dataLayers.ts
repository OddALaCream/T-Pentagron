/**
 * Capas 3D propias que acompañan a las capas de react-globe.gl:
 *  - Onda de escaneo planetario (shader sobre una cáscara esférica que sigue la superficie).
 *  - Marcadores por SÍMBOLO (un único THREE.Points con formas SDF: círculo, triángulo,
 *    diamante, hexágono, onda, vacío) — una sola llamada de dibujo para miles de celdas.
 *  - Materiales de tapa para los polígonos H3 que reaccionan al paso de la onda.
 *  - Retícula H3 (aristas reales de las celdas) como un único LineSegments.
 */
import * as THREE from 'three';
import { countryUniforms, countryClipGLSL } from './countryBoundary';
import { cellToBoundary } from 'h3-js';
import { scanUniformsGLSL } from './shaders/noise';
import type { VisualKind } from '@/lib/science/categories';
import { CATEGORY } from '@/lib/science/categories';

export const GLOBE_RADIUS = 100;

export function polarToCartesian(lat: number, lng: number, altitude = 0, target = new THREE.Vector3()): THREE.Vector3 {
  const phi = ((90 - lat) * Math.PI) / 180;
  const theta = ((90 - lng) * Math.PI) / 180;
  const r = GLOBE_RADIUS * (1 + altitude);
  return target.set(r * Math.sin(phi) * Math.cos(theta), r * Math.cos(phi), r * Math.sin(phi) * Math.sin(theta));
}

/* ------------------------------------------------------------------ */
/* Onda de escaneo                                                    */
/* ------------------------------------------------------------------ */
export interface ScanUniforms {
  [uniform: string]: THREE.IUniform;
  uScanOrigin: THREE.IUniform<THREE.Vector3>;
  uScanAngle: THREE.IUniform<number>;
  uScanActive: THREE.IUniform<number>;
  uScanHide: THREE.IUniform<number>;
  uTime: THREE.IUniform<number>;
}

export interface ScanController {
  uniforms: ScanUniforms;
  mesh: THREE.Mesh;
  trigger: (origin: THREE.Vector3, options?: { hide?: boolean; duration?: number }) => void;
  update: (dt: number) => void;
  isActive: () => boolean;
  angle: () => number;
  setIntensity: (v: number) => void;
  dispose: () => void;
}

export function createScan(): ScanController {
  const uniforms: ScanUniforms = {
    uScanOrigin: { value: new THREE.Vector3(0, 0, 1) },
    uScanAngle: { value: Math.PI },
    uScanActive: { value: 0 },
    uScanHide: { value: 0 },
    uTime: { value: 0 },
  };
  const strength = { value: 1 };
  const material = new THREE.ShaderMaterial({
    uniforms: { ...uniforms, uStrength: strength, uColor: { value: new THREE.Color('#6fd8ff') } },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      ${scanUniformsGLSL}
      uniform float uStrength;
      uniform vec3 uColor;
      varying vec3 vDir;
      float gridLine(float v, float step, float w) {
        float f = abs(fract(v / step + 0.5) - 0.5) * step;
        return 1.0 - smoothstep(0.0, w, f);
      }
      void main() {
        vec3 d = normalize(vDir);
        float a = acos(clamp(dot(d, uScanOrigin), -1.0, 1.0));
        float delta = a - uScanAngle;
        // Frente fino y una estela corta que revela la retícula de observación.
        float front = exp(-pow(delta / 0.026, 2.0));
        float halo = exp(-pow(delta / 0.09, 2.0)) * 0.18;
        float wake = smoothstep(-0.42, 0.0, delta) * (1.0 - smoothstep(-0.005, 0.01, delta));
        float lat = degrees(asin(d.y));
        float lng = degrees(atan(d.x, d.z));
        float grid = max(gridLine(lat, 2.5, 0.05), gridLine(lng, 2.5, 0.05 / max(0.2, cos(radians(lat)))));
        float lines = 0.6 + 0.4 * sin(delta * 520.0);
        float intensity = front * (0.42 + 0.22 * lines) + halo + wake * grid * 0.32 + front * grid * 0.35;
        // Aparición gradual: sin "disco" en el punto de origen.
        float birth = smoothstep(0.02, 0.2, uScanAngle);
        float alpha = clamp(intensity * uStrength * uScanActive * birth, 0.0, 1.0);
        gl_FragColor = vec4(uColor * alpha, alpha);
      }`,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(GLOBE_RADIUS * 1.0035, 128, 96), material);
  mesh.renderOrder = 3;
  mesh.visible = false;
  let duration = 4.6;
  let t = 1;
  let active = false;
  return {
    uniforms,
    mesh,
    trigger: (origin, options) => {
      uniforms.uScanOrigin.value.copy(origin).normalize();
      duration = options?.duration ?? 4.6;
      uniforms.uScanHide.value = options?.hide ? 1 : 0;
      t = 0;
      active = true;
      mesh.visible = true;
      uniforms.uScanActive.value = 1;
      uniforms.uScanAngle.value = 0;
    },
    update: (dt) => {
      uniforms.uTime.value += dt;
      if (!active) return;
      t += dt / duration;
      const k = Math.min(1, t);
      const eased = 1 - Math.pow(1 - k, 1.6);
      uniforms.uScanAngle.value = eased * (Math.PI + 0.2);
      uniforms.uScanActive.value = k < 0.85 ? 1 : 1 - (k - 0.85) / 0.15;
      if (k >= 1) {
        active = false;
        mesh.visible = false;
        uniforms.uScanActive.value = 0;
        uniforms.uScanHide.value = 0;
        uniforms.uScanAngle.value = Math.PI + 0.2;
      }
    },
    isActive: () => active,
    angle: () => uniforms.uScanAngle.value,
    setIntensity: (v) => {
      strength.value = v;
    },
    dispose: () => {
      mesh.geometry.dispose();
      material.dispose();
    },
  };
}

/* ------------------------------------------------------------------ */
/* Marcadores por símbolo                                             */
/* ------------------------------------------------------------------ */
export interface SymbolDatum {
  lat: number;
  lng: number;
  altitude: number;
  kind: VisualKind;
  intensity: number;
  selected?: boolean;
  phase?: number;
}

export interface SymbolLayer {
  points: THREE.Points;
  setData: (data: SymbolDatum[]) => void;
  setSize: (px: number) => void;
  setPixelRatio: (r: number) => void;
  dispose: () => void;
}

const symbolVertex = /* glsl */ `
attribute float shape;
attribute vec3 color;
attribute float intensity;
attribute float phase;
attribute float selected;
uniform float uPixelRatio;
uniform float uSize;
varying float vShape;
varying vec3 vColor;
varying float vIntensity;
varying float vPhase;
varying float vSelected;
varying vec3 vDir;
varying float vFacing;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vDir = normalize(wp.xyz);
  vec3 toCam = normalize(cameraPosition - wp.xyz);
  vFacing = smoothstep(0.02, 0.22, dot(vDir, toCam));
  gl_Position = projectionMatrix * viewMatrix * wp;
  vShape = shape;
  vColor = color;
  vIntensity = intensity;
  vPhase = phase;
  vSelected = selected;
  float s = uSize * (0.82 + 0.4 * intensity) * (1.0 + selected * 0.45);
  if (shape > 3.5 && shape < 4.5) s *= 2.2;
  if (shape > 4.5 && shape < 5.5) s *= 0.85;
  gl_PointSize = s * uPixelRatio;
}`;

const symbolFragment = /* glsl */ `
${scanUniformsGLSL}
varying float vShape;
varying vec3 vColor;
varying float vIntensity;
varying float vPhase;
varying float vSelected;
varying vec3 vDir;
varying float vFacing;

float sdTriangle(vec2 p, float r) {
  const float k = sqrt(3.0);
  p.x = abs(p.x) - r;
  p.y = p.y + r / k;
  if (p.x + k * p.y > 0.0) p = vec2(p.x - k * p.y, -k * p.x - p.y) / 2.0;
  p.x -= clamp(p.x, -2.0 * r, 0.0);
  return -length(p) * sign(p.y);
}
float sdHexagon(vec2 p, float r) {
  const vec3 k = vec3(-0.866025404, 0.5, 0.577350269);
  p = abs(p);
  p -= 2.0 * min(dot(k.xy, p), 0.0) * k.xy;
  p -= vec2(clamp(p.x, -k.z * r, k.z * r), r);
  return length(p) * sign(p.y);
}
mat2 rot(float a) { float c = cos(a), s = sin(a); return mat2(c, -s, s, c); }

void main() {
  vec2 p = (gl_PointCoord - 0.5) * 2.0;
  p.y = -p.y;
  float t = uTime;
  float d;
  float pulse = 1.0;
  float glowAmt = 0.12;
  int shape = int(vShape + 0.5);
  if (shape == 0) {            // baja · círculo · brillo estable
    d = length(p) - 0.42;
    glowAmt = 0.08;
  } else if (shape == 1) {     // media · triángulo · respiración lenta
    d = sdTriangle(p * 1.05 + vec2(0.0, 0.06), 0.55);
    pulse = 0.82 + 0.18 * sin(t * 2.4 + vPhase * 6.283);
  } else if (shape == 2) {     // alta · diamante · pulso rápido
    d = (abs(p.x) + abs(p.y)) * 0.7071 - 0.42;
    pulse = 0.72 + 0.28 * pow(0.5 + 0.5 * sin(t * 6.2 + vPhase * 6.283), 2.0);
    glowAmt = 0.18;
  } else if (shape == 3) {     // pronóstico · hexágono · rotación pausada
    d = sdHexagon(rot(t * 0.35 + vPhase) * p, 0.44);
    glowAmt = 0.45;
  } else if (shape == 4) {     // anomalía · onda expansiva
    float r = fract(t * 0.45 + vPhase);
    float ring = abs(length(p) - (0.25 + r * 0.7)) - 0.035;
    float ring2 = abs(length(p) - (0.25 + fract(r + 0.5) * 0.7)) - 0.025;
    d = min(ring, ring2);
    pulse = 1.0 - r * 0.6;
    glowAmt = 0.3;
  } else if (shape == 5) {     // sin datos · círculo vacío tachado (estático, sin brillo)
    float ring = abs(length(p) - 0.42) - 0.07;
    vec2 q = rot(0.785398) * p;
    float slash = max(abs(q.y) - 0.06, abs(q.x) - 0.42);
    d = min(ring, slash);
    glowAmt = 0.0;
  } else {
    d = length(p) - 0.18;
    glowAmt = 0.0;
  }
  float aa = 0.06;
  float fill = 1.0 - smoothstep(-aa, aa, d);
  float rim = 1.0 - smoothstep(0.0, 0.09, abs(d + 0.05));
  float glow = exp(-max(d, 0.0) * 5.5) * glowAmt * (0.6 + vIntensity * 0.6);
  vec3 base = vColor * (0.72 + 0.28 * vIntensity);
  vec3 col = base * fill * pulse * 0.8 + vColor * rim * fill * 0.08 + vColor * glow * pulse * 0.25;
  float alpha = max(fill * (shape == 5 ? 0.85 : 0.95), glow * 0.65 * pulse);
  if (vSelected > 0.5) {
    float sel = 1.0 - smoothstep(0.0, 0.06, abs(length(p) - 0.9));
    col += vec3(0.9, 0.97, 1.0) * sel;
    alpha = max(alpha, sel);
  }
  float front = scanFront(vDir, 0.07);
  col += vec3(0.75, 0.95, 1.0) * front * (fill + glow) * 0.15;
  alpha = min(1.0, alpha + front * 0.4 * fill);
  alpha *= vFacing * scanRevealed(vDir);
  if (alpha < 0.01) discard;
  gl_FragColor = vec4(col, alpha);
  #include <colorspace_fragment>
}`;

export function createSymbolLayer(scan: ScanUniforms, pixelRatio = 1): SymbolLayer {
  const geometry = new THREE.BufferGeometry();
  const material = new THREE.ShaderMaterial({
    uniforms: { ...scan, uPixelRatio: { value: pixelRatio }, uSize: { value: 15 } },
    vertexShader: symbolVertex,
    fragmentShader: symbolFragment,
    transparent: true,
    depthWrite: false,
  });
  const points = new THREE.Points(geometry, material);
  points.frustumCulled = false;
  points.renderOrder = 5;
  const tmp = new THREE.Vector3();
  return {
    points,
    setData: (data) => {
      const n = data.length;
      const pos = new Float32Array(n * 3);
      const shape = new Float32Array(n);
      const color = new Float32Array(n * 3);
      const intensity = new Float32Array(n);
      const phase = new Float32Array(n);
      const selected = new Float32Array(n);
      data.forEach((d, i) => {
        polarToCartesian(d.lat, d.lng, d.altitude, tmp);
        pos.set([tmp.x, tmp.y, tmp.z], i * 3);
        const meta = CATEGORY[d.kind];
        shape[i] = meta.shapeCode;
        color.set(meta.rgb, i * 3);
        intensity[i] = d.intensity;
        phase[i] = d.phase ?? ((Math.abs(Math.sin(d.lat * 12.9898 + d.lng * 78.233)) * 43758.5453) % 1);
        selected[i] = d.selected ? 1 : 0;
      });
      geometry.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      geometry.setAttribute('shape', new THREE.BufferAttribute(shape, 1));
      geometry.setAttribute('color', new THREE.BufferAttribute(color, 3));
      geometry.setAttribute('intensity', new THREE.BufferAttribute(intensity, 1));
      geometry.setAttribute('phase', new THREE.BufferAttribute(phase, 1));
      geometry.setAttribute('selected', new THREE.BufferAttribute(selected, 1));
      geometry.setDrawRange(0, n);
      geometry.computeBoundingSphere();
    },
    setSize: (px) => {
      material.uniforms.uSize.value = px;
    },
    setPixelRatio: (r) => {
      material.uniforms.uPixelRatio.value = r;
    },
    dispose: () => {
      geometry.dispose();
      material.dispose();
    },
  };
}

/* ------------------------------------------------------------------ */
/* Materiales de tapa para polígonos H3                               */
/* ------------------------------------------------------------------ */
const capVertex = /* glsl */ `
varying vec3 vPosW;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vPosW = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;

const capFragment = /* glsl */ `
${scanUniformsGLSL}
${countryClipGLSL}
uniform vec3 uColor;
uniform float uOpacity;
uniform float uPulse;
uniform float uHighlight;
uniform float uHatch;
varying vec3 vPosW;
void main() {
  clipCountry(vPosW);
  vec3 dir = normalize(vPosW);
  float pulse = uPulse > 0.0 ? 0.78 + 0.22 * sin(uTime * uPulse) : 1.0;
  vec3 col = uColor * pulse;
  float alpha = uOpacity;
  if (uHatch > 0.5) {
    float stripes = step(0.5, fract((vPosW.x + vPosW.y + vPosW.z) * 1.6));
    alpha *= 0.45 + 0.55 * stripes;
  }
  col += vec3(1.0) * uHighlight * 0.32;
  float front = scanFront(dir, 0.045);
  col += vec3(0.7, 0.95, 1.0) * front * 0.65;
  alpha = clamp(alpha + front * 0.35 + uHighlight * 0.15, 0.0, 1.0) * scanRevealed(dir);
  gl_FragColor = vec4(col, alpha);
  #include <colorspace_fragment>
}`;

export type CapState = 'normal' | 'hover' | 'selected';

export class CapMaterials {
  private cache = new Map<string, THREE.ShaderMaterial>();
  constructor(private scan: ScanUniforms) {}

  get(kind: VisualKind, state: CapState, faint = false): THREE.ShaderMaterial {
    const key = `${kind}|${state}|${faint}`;
    let m = this.cache.get(key);
    if (!m) {
      const meta = CATEGORY[kind];
      const baseOpacity =
        kind === 'none' ? 0.03 : kind === 'unavailable' ? 0.08 : kind === 'forecast' ? 0.2 : kind === 'low' ? 0.17 : 0.3;
      m = new THREE.ShaderMaterial({
        uniforms: {
          ...this.scan,
          ...countryUniforms(),
          uColor: { value: new THREE.Color(meta.color) },
          uOpacity: { value: faint ? baseOpacity * 0.45 : state === 'selected' ? Math.min(1, baseOpacity + 0.2) : baseOpacity },
          uPulse: { value: kind === 'high' ? 5.5 : kind === 'medium' ? 2.2 : 0 },
          uHighlight: { value: state === 'selected' ? 1 : state === 'hover' ? 0.6 : 0 },
          uHatch: { value: kind === 'unavailable' ? 1 : 0 },
        },
        vertexShader: capVertex,
        fragmentShader: capFragment,
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
      });
      this.cache.set(key, m);
    }
    return m;
  }

  dispose() {
    this.cache.forEach((m) => m.dispose());
    this.cache.clear();
  }
}

/* ------------------------------------------------------------------ */
/* Retícula H3                                                        */
/* ------------------------------------------------------------------ */
export interface GridLayer {
  lines: THREE.LineSegments;
  setCells: (cells: string[], altitude: number) => void;
  setOpacity: (o: number) => void;
  dispose: () => void;
}

export function createGridLayer(scan: ScanUniforms): GridLayer {
  const geometry = new THREE.BufferGeometry();
  const opacity = { value: 0 };
  const material = new THREE.ShaderMaterial({
    uniforms: { ...scan, ...countryUniforms(), uOpacity: opacity, uColor: { value: new THREE.Color('#9cc3ff') } },
    vertexShader: /* glsl */ `
      varying vec3 vPosW;
      varying float vFacing;
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vPosW = wp.xyz;
        vFacing = smoothstep(0.0, 0.3, dot(normalize(wp.xyz), normalize(cameraPosition - wp.xyz)));
        gl_Position = projectionMatrix * viewMatrix * wp;
      }`,
    fragmentShader: /* glsl */ `
      ${scanUniformsGLSL}
      ${countryClipGLSL}
      uniform float uOpacity;
      uniform vec3 uColor;
      varying vec3 vPosW;
      varying float vFacing;
      void main() {
        clipCountry(vPosW);
        float front = scanFront(normalize(vPosW), 0.08);
        float a = (uOpacity + front * 0.7) * vFacing;
        if (a < 0.005) discard;
        gl_FragColor = vec4(uColor + front * 0.4, a);
      }`,
    transparent: true,
    depthWrite: false,
  });
  const lines = new THREE.LineSegments(geometry, material);
  lines.frustumCulled = false;
  lines.renderOrder = 2;
  const tmp = new THREE.Vector3();
  return {
    lines,
    setCells: (cells, altitude) => {
      const segments: number[] = [];
      for (const h of cells) {
        const ring = cellToBoundary(h);
        for (let i = 0; i < ring.length; i++) {
          const [lat1, lng1] = ring[i];
          const [lat2, lng2] = ring[(i + 1) % ring.length];
          polarToCartesian(lat1, lng1, altitude, tmp);
          segments.push(tmp.x, tmp.y, tmp.z);
          polarToCartesian(lat2, lng2, altitude, tmp);
          segments.push(tmp.x, tmp.y, tmp.z);
        }
      }
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(segments, 3));
      geometry.computeBoundingSphere();
    },
    setOpacity: (o) => {
      opacity.value = o;
    },
    dispose: () => {
      geometry.dispose();
      material.dispose();
    },
  };
}
