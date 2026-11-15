/**
 * Universo de fondo: estrellas con profundidad, vía láctea tenue, polvo con parallax y
 * cometas ocasionales que se fragmentan en partículas al hacer clic.
 * Todo es procedural (sin imágenes), con densidad según la calidad elegida.
 */
import * as THREE from 'three';
import type { Quality } from '@/state/store';

function seeded(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randomOnSphere(rand: () => number): THREE.Vector3 {
  const u = rand() * 2 - 1;
  const t = rand() * Math.PI * 2;
  const s = Math.sqrt(1 - u * u);
  return new THREE.Vector3(s * Math.cos(t), u, s * Math.sin(t));
}

/* ------------------------------------------------------------------ */
/* Estrellas                                                          */
/* ------------------------------------------------------------------ */
const starVertex = /* glsl */ `
attribute float size;
attribute float phase;
attribute vec3 tint;
uniform float uTime;
uniform float uPixelRatio;
uniform float uOpacity;
varying vec3 vColor;
varying float vAlpha;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  float tw = 0.78 + 0.22 * sin(uTime * (0.35 + phase * 1.3) + phase * 37.0);
  vColor = tint;
  vAlpha = tw * uOpacity;
  gl_PointSize = size * uPixelRatio * (0.9 + 0.1 * tw);
}`;

const starFragment = /* glsl */ `
varying vec3 vColor;
varying float vAlpha;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float d = length(c) * 2.0;
  float core = exp(-d * d * 7.0);
  float halo = exp(-d * 3.2) * 0.25;
  float a = (core + halo) * vAlpha;
  if (a < 0.003) discard;
  gl_FragColor = vec4(vColor * a, a);
}`;

export interface Starfield {
  group: THREE.Group;
  material: THREE.ShaderMaterial;
  update: (t: number) => void;
  setOpacity: (o: number) => void;
  dispose: () => void;
}

export function createStarfield(quality: Quality, radius = 22_000, pixelRatio = 1): Starfield {
  const count = quality === 'high' ? 7000 : quality === 'balanced' ? 4200 : 2200;
  const rand = seeded(2026);
  const positions = new Float32Array(count * 3);
  const sizes = new Float32Array(count);
  const phases = new Float32Array(count);
  const tints = new Float32Array(count * 3);
  const palette = [
    new THREE.Color('#9fbfff'), new THREE.Color('#cfe0ff'), new THREE.Color('#ffffff'),
    new THREE.Color('#fff1d6'), new THREE.Color('#ffd2a1'),
  ];
  // Concentración de estrellas cerca de un plano galáctico inclinado.
  const galNormal = new THREE.Vector3(0.35, 0.82, -0.45).normalize();
  for (let i = 0; i < count; i++) {
    let dir = randomOnSphere(rand);
    if (rand() < 0.45) {
      const off = galNormal.clone().multiplyScalar((rand() - 0.5) * 0.35);
      dir = dir.sub(galNormal.clone().multiplyScalar(dir.dot(galNormal))).add(off).normalize();
    }
    const r = radius * (0.8 + rand() * 0.4);
    positions.set([dir.x * r, dir.y * r, dir.z * r], i * 3);
    const m = Math.pow(rand(), 5.5);
    sizes[i] = 0.9 + m * 3.4;
    phases[i] = rand();
    const c = palette[Math.floor(Math.pow(rand(), 0.8) * palette.length)];
    const dim = 0.55 + 0.45 * rand();
    tints.set([c.r * dim, c.g * dim, c.b * dim], i * 3);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('size', new THREE.BufferAttribute(sizes, 1));
  geometry.setAttribute('phase', new THREE.BufferAttribute(phases, 1));
  geometry.setAttribute('tint', new THREE.BufferAttribute(tints, 3));
  const material = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uPixelRatio: { value: pixelRatio }, uOpacity: { value: 1 } },
    vertexShader: starVertex,
    fragmentShader: starFragment,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const points = new THREE.Points(geometry, material);
  points.frustumCulled = false;
  points.renderOrder = -10;
  const group = new THREE.Group();
  group.add(points);

  // Vía láctea y nebulosas muy tenues (solo calidad alta/equilibrada). La textura se
  // pinta una vez en canvas: así el shader es trivial y compila al instante.
  let sky: THREE.Mesh | null = null;
  if (quality !== 'low') {
    const skyMat = new THREE.MeshBasicMaterial({
      map: getSkyTexture(),
      side: THREE.BackSide,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      transparent: true,
      opacity: SKY_OPACITY,
    });
    sky = new THREE.Mesh(new THREE.SphereGeometry(radius * 1.5, 48, 32), skyMat);
    sky.rotation.set(0.6, 0.4, -0.35);
    sky.renderOrder = -20;
    sky.frustumCulled = false;
    group.add(sky);
  }

  return {
    group,
    material,
    update: (t) => {
      material.uniforms.uTime.value = t;
    },
    setOpacity: (o) => {
      material.uniforms.uOpacity.value = o;
      if (sky) (sky.material as THREE.MeshBasicMaterial).opacity = o * SKY_OPACITY;
    },
    dispose: () => {
      geometry.dispose();
      material.dispose();
      if (sky) {
        sky.geometry.dispose();
        (sky.material as THREE.Material).dispose();
      }
    },
  };
}

/** La vía láctea debe ser apenas perceptible: nunca compite con el planeta ni con los datos. */
const SKY_OPACITY = 0.38;
let skyTexture: THREE.CanvasTexture | null = null;

/** Banda galáctica y nebulosas tenues pintadas en un canvas equirectangular (una sola vez). */
function getSkyTexture(): THREE.CanvasTexture {
  if (skyTexture) return skyTexture;
  const w = 1024;
  const h = 512;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, w, h);
  const rand = seeded(77);
  const blob = (x: number, y: number, r: number, color: string, alpha: number) => {
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, color.replace('A', String(alpha)));
    g.addColorStop(1, color.replace('A', '0'));
    ctx.fillStyle = g;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  };
  ctx.globalCompositeOperation = 'lighter';
  // Banda galáctica: sinusoide en proyección equirectangular.
  for (let i = 0; i < 520; i++) {
    const u = rand();
    const x = u * w;
    const y = h / 2 + Math.sin(u * Math.PI * 2) * h * 0.28 + (rand() - 0.5) * h * 0.09;
    const core = Math.exp(-Math.pow((u - 0.62) / 0.16, 2));
    blob(x, y, 10 + rand() * 30, 'rgba(150,165,215,A)', 0.006 + 0.012 * core + rand() * 0.004);
  }
  // Nebulosas violetas y verdeazuladas dispersas.
  for (let i = 0; i < 18; i++) {
    blob(rand() * w, rand() * h, 30 + rand() * 80, rand() < 0.5 ? 'rgba(95,55,150,A)' : 'rgba(30,95,110,A)', 0.015 + rand() * 0.02);
  }
  // Carriles de polvo oscuro sobre la banda.
  ctx.globalCompositeOperation = 'destination-out';
  for (let i = 0; i < 160; i++) {
    const u = rand();
    const x = u * w;
    const y = h / 2 + Math.sin(u * Math.PI * 2) * h * 0.28 + (rand() - 0.5) * h * 0.03;
    blob(x, y, 6 + rand() * 18, 'rgba(0,0,0,A)', 0.25);
  }
  skyTexture = new THREE.CanvasTexture(canvas);
  skyTexture.colorSpace = THREE.SRGBColorSpace;
  return skyTexture;
}

/* ------------------------------------------------------------------ */
/* Polvo espacial (parallax)                                          */
/* ------------------------------------------------------------------ */
export interface Dust {
  points: THREE.Points;
  update: (t: number, dt: number) => void;
  setOpacity: (o: number) => void;
  dispose: () => void;
}

export function createDust(quality: Quality, inner = 160, outer = 1400, pixelRatio = 1, seed = 7): Dust {
  const count = quality === 'high' ? 900 : quality === 'balanced' ? 500 : 200;
  const rand = seeded(seed);
  const positions = new Float32Array(count * 3);
  const sizes = new Float32Array(count);
  const phases = new Float32Array(count);
  const tints = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const dir = randomOnSphere(rand);
    const r = inner + Math.pow(rand(), 0.7) * (outer - inner);
    positions.set([dir.x * r, dir.y * r, dir.z * r], i * 3);
    sizes[i] = 0.8 + rand() * 1.6;
    phases[i] = rand();
    const warm = rand() < 0.25;
    tints.set(warm ? [0.55, 0.48, 0.42] : [0.45, 0.55, 0.7], i * 3);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('size', new THREE.BufferAttribute(sizes, 1));
  geometry.setAttribute('phase', new THREE.BufferAttribute(phases, 1));
  geometry.setAttribute('tint', new THREE.BufferAttribute(tints, 3));
  const material = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uPixelRatio: { value: pixelRatio }, uOpacity: { value: 0.55 } },
    vertexShader: starVertex,
    fragmentShader: starFragment,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const points = new THREE.Points(geometry, material);
  points.frustumCulled = false;
  return {
    points,
    update: (t, dt) => {
      material.uniforms.uTime.value = t;
      points.rotation.y += dt * 0.004;
      points.rotation.x += dt * 0.0012;
    },
    setOpacity: (o) => {
      material.uniforms.uOpacity.value = o;
    },
    dispose: () => {
      geometry.dispose();
      material.dispose();
    },
  };
}

/* ------------------------------------------------------------------ */
/* Cometas                                                            */
/* ------------------------------------------------------------------ */
const TRAIL = 56;

const cometVertex = /* glsl */ `
attribute float size;
attribute float alpha;
attribute vec3 tint;
uniform float uPixelRatio;
varying float vAlpha;
varying vec3 vColor;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  vAlpha = alpha;
  vColor = tint;
  gl_PointSize = size * uPixelRatio;
}`;

const cometFragment = /* glsl */ `
varying float vAlpha;
varying vec3 vColor;
void main() {
  float d = length(gl_PointCoord - 0.5) * 2.0;
  float a = exp(-d * d * 4.0) * vAlpha;
  if (a < 0.004) discard;
  gl_FragColor = vec4(vColor * a, a);
}`;

interface Comet {
  points: THREE.Points;
  start: THREE.Vector3;
  dir: THREE.Vector3;
  speed: number;
  age: number;
  life: number;
}

interface Burst {
  points: THREE.Points;
  velocities: Float32Array;
  age: number;
  life: number;
}

export interface CometSystem {
  group: THREE.Group;
  update: (dt: number, camera: THREE.Camera, enabled: boolean) => void;
  /** Devuelve true si el clic alcanzó un cometa (y lo fragmenta). */
  hitTest: (x: number, y: number, width: number, height: number, camera: THREE.Camera) => boolean;
  spawnNow: (camera: THREE.Camera) => void;
  dispose: () => void;
}

export function createComets(pixelRatio = 1): CometSystem {
  const group = new THREE.Group();
  const comets: Comet[] = [];
  const bursts: Burst[] = [];
  const rand = seeded(Date.now() & 0xffff);
  let nextSpawn = 9 + rand() * 12;
  const material = new THREE.ShaderMaterial({
    uniforms: { uPixelRatio: { value: pixelRatio } },
    vertexShader: cometVertex,
    fragmentShader: cometFragment,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const tmp = new THREE.Vector3();

  function makeGeometry(n: number) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    g.setAttribute('size', new THREE.BufferAttribute(new Float32Array(n), 1));
    g.setAttribute('alpha', new THREE.BufferAttribute(new Float32Array(n), 1));
    g.setAttribute('tint', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    return g;
  }

  function spawn(camera: THREE.Camera) {
    // Trayectoria en el plano de la vista, a gran distancia, cruzando el encuadre.
    const depth = 5200 + rand() * 2600;
    const fromLeft = rand() < 0.5;
    const y0 = 0.35 + rand() * 0.5;
    const a = new THREE.Vector3(fromLeft ? -1.25 : 1.25, y0, 0.5).unproject(camera);
    const b = new THREE.Vector3(fromLeft ? 0.6 + rand() * 0.6 : -0.6 - rand() * 0.6, y0 - 0.4 - rand() * 0.5, 0.5).unproject(camera);
    const camPos = camera.getWorldPosition(new THREE.Vector3());
    const start = a.sub(camPos).normalize().multiplyScalar(depth).add(camPos);
    const end = b.sub(camPos).normalize().multiplyScalar(depth).add(camPos);
    const dir = end.clone().sub(start);
    const dist = dir.length();
    dir.normalize();
    const geometry = makeGeometry(TRAIL);
    const sizes = geometry.getAttribute('size') as THREE.BufferAttribute;
    const alphas = geometry.getAttribute('alpha') as THREE.BufferAttribute;
    const tints = geometry.getAttribute('tint') as THREE.BufferAttribute;
    for (let i = 0; i < TRAIL; i++) {
      const k = i / (TRAIL - 1);
      sizes.setX(i, i === 0 ? 7 : 4.5 * (1 - k) + 0.8);
      alphas.setX(i, i === 0 ? 1 : Math.pow(1 - k, 1.6) * 0.55);
      const c = new THREE.Color().lerpColors(new THREE.Color('#f4fbff'), new THREE.Color('#5fd7d2'), Math.min(1, k * 1.4));
      tints.setXYZ(i, c.r, c.g, c.b);
    }
    const points = new THREE.Points(geometry, material);
    points.frustumCulled = false;
    group.add(points);
    const speed = dist / (3.2 + rand() * 1.8);
    comets.push({ points, start, dir, speed, age: 0, life: dist / speed });
  }

  function burst(c: Comet) {
    const n = 110;
    const geometry = makeGeometry(n);
    const pos = geometry.getAttribute('position') as THREE.BufferAttribute;
    const sizes = geometry.getAttribute('size') as THREE.BufferAttribute;
    const tints = geometry.getAttribute('tint') as THREE.BufferAttribute;
    const head = c.start.clone().addScaledVector(c.dir, c.speed * c.age);
    const velocities = new Float32Array(n * 3);
    const palette = ['#ffffff', '#bdf4ff', '#5fd7d2', '#a68bff'].map((h) => new THREE.Color(h));
    for (let i = 0; i < n; i++) {
      pos.setXYZ(i, head.x, head.y, head.z);
      const d = randomOnSphere(rand).multiplyScalar(60 + rand() * 260);
      d.addScaledVector(c.dir, c.speed * 0.25);
      velocities.set([d.x, d.y, d.z], i * 3);
      sizes.setX(i, 1.5 + rand() * 3.5);
      const col = palette[Math.floor(rand() * palette.length)];
      tints.setXYZ(i, col.r, col.g, col.b);
    }
    const points = new THREE.Points(geometry, material);
    points.frustumCulled = false;
    group.add(points);
    bursts.push({ points, velocities, age: 0, life: 1.7 });
  }

  function removeComet(i: number) {
    const c = comets[i];
    group.remove(c.points);
    c.points.geometry.dispose();
    comets.splice(i, 1);
  }

  return {
    group,
    spawnNow: spawn,
    update: (dt, camera, enabled) => {
      if (enabled) {
        nextSpawn -= dt;
        if (nextSpawn <= 0 && comets.length < 2) {
          spawn(camera);
          nextSpawn = 24 + rand() * 34;
        }
      }
      for (let i = comets.length - 1; i >= 0; i--) {
        const c = comets[i];
        c.age += dt;
        if (c.age > c.life + 1.2) {
          removeComet(i);
          continue;
        }
        const pos = c.points.geometry.getAttribute('position') as THREE.BufferAttribute;
        const headDist = c.speed * c.age;
        const fade = Math.min(1, c.age / 0.6) * Math.min(1, (c.life + 1.2 - c.age) / 1.0);
        const alphas = c.points.geometry.getAttribute('alpha') as THREE.BufferAttribute;
        for (let k = 0; k < TRAIL; k++) {
          const back = Math.min(headDist, k * c.speed * 0.012);
          tmp.copy(c.start).addScaledVector(c.dir, headDist - back);
          pos.setXYZ(k, tmp.x, tmp.y, tmp.z);
          const base = k === 0 ? 1 : Math.pow(1 - k / (TRAIL - 1), 1.6) * 0.55;
          alphas.setX(k, base * fade);
        }
        pos.needsUpdate = true;
        alphas.needsUpdate = true;
      }
      for (let i = bursts.length - 1; i >= 0; i--) {
        const b = bursts[i];
        b.age += dt;
        const g = b.points.geometry;
        const pos = g.getAttribute('position') as THREE.BufferAttribute;
        const alphas = g.getAttribute('alpha') as THREE.BufferAttribute;
        const k = b.age / b.life;
        for (let j = 0; j < pos.count; j++) {
          pos.setXYZ(
            j,
            pos.getX(j) + b.velocities[j * 3] * dt * (1 - k * 0.6),
            pos.getY(j) + b.velocities[j * 3 + 1] * dt * (1 - k * 0.6),
            pos.getZ(j) + b.velocities[j * 3 + 2] * dt * (1 - k * 0.6),
          );
          alphas.setX(j, Math.max(0, 1 - k) ** 1.4);
        }
        pos.needsUpdate = true;
        alphas.needsUpdate = true;
        if (b.age >= b.life) {
          group.remove(b.points);
          g.dispose();
          bursts.splice(i, 1);
        }
      }
    },
    hitTest: (x, y, width, height, camera) => {
      for (let i = comets.length - 1; i >= 0; i--) {
        const c = comets[i];
        if (c.age > c.life) continue;
        const head = c.start.clone().addScaledVector(c.dir, c.speed * c.age).project(camera);
        if (head.z > 1) continue;
        const sx = ((head.x + 1) / 2) * width;
        const sy = ((1 - head.y) / 2) * height;
        if (Math.hypot(sx - x, sy - y) < 30) {
          burst(c);
          removeComet(i);
          return true;
        }
      }
      return false;
    },
    dispose: () => {
      comets.forEach((c) => c.points.geometry.dispose());
      bursts.forEach((b) => b.points.geometry.dispose());
      material.dispose();
    },
  };
}
