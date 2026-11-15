/**
 * Escena espacial de los destinos secundarios MARTE y UNIVERSO (renderizador propio).
 *
 * - La Tierra usa el mismo material terrestre del observatorio.
 * - Marte es una superficie PROCEDURAL ilustrativa (tonos óxido, regiones oscuras, casquetes
 *   polares): el repositorio no incluye un mapa marciano con licencia, y la UI lo indica.
 * - El campo estelar, la banda galáctica y las nebulosas son ilustrativos.
 * Las transiciones son desplazamientos de cámara (no cambios de página).
 */
import * as THREE from 'three';
import gsap from 'gsap';
import { createAtmosphere, createClouds, createEarthMaterial, type CloudLayer, type EarthMaterialHandle } from './earth';
import { createStarfield, type Starfield } from './space';
import { simplexNoise3D } from './shaders/noise';

export type SpaceTarget = 'mars' | 'universe';

const EARTH = new THREE.Vector3(0, 0, 0);
const MARS = new THREE.Vector3(42, 4, -36);

const marsVertex = /* glsl */ `
varying vec3 vN; varying vec3 vP; varying vec3 vW;
void main() {
  vN = normalize(mat3(modelMatrix) * normal);
  vP = position;
  vec4 w = modelMatrix * vec4(position, 1.0);
  vW = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;
const marsFragment = /* glsl */ `
${simplexNoise3D}
uniform vec3 uSun;
varying vec3 vN; varying vec3 vP; varying vec3 vW;
void main() {
  vec3 p = normalize(vP);
  float n = fbm3(p * 2.2) * 0.6 + fbm3(p * 7.0) * 0.3 + snoise(p * 22.0) * 0.1;
  float dark = smoothstep(0.05, 0.35, fbm3(p * 1.4 + vec3(3.1, 0.0, 1.7)));
  vec3 rust = vec3(0.74, 0.36, 0.2);
  vec3 dust = vec3(0.86, 0.58, 0.38);
  vec3 basalt = vec3(0.32, 0.17, 0.11);
  vec3 col = mix(rust, dust, smoothstep(-0.3, 0.5, n));
  col = mix(col, basalt, dark * 0.75);
  float crater = smoothstep(0.62, 0.7, snoise(p * 16.0)) * 0.25;
  col *= 1.0 - crater;
  float lat = abs(p.y);
  float cap = smoothstep(0.88, 0.94, lat + n * 0.04);
  col = mix(col, vec3(0.93, 0.92, 0.9), cap);
  vec3 N = normalize(vN);
  vec3 L = normalize(uSun);
  float d = max(dot(N, L), 0.0);
  vec3 V = normalize(cameraPosition - vW);
  float rim = pow(1.0 - max(dot(N, V), 0.0), 3.0);
  vec3 lit = col * (0.03 + 1.05 * pow(d, 0.85));
  lit += vec3(0.95, 0.6, 0.45) * rim * 0.35 * smoothstep(-0.2, 0.4, dot(N, L));
  gl_FragColor = vec4(lit, 1.0);
  #include <colorspace_fragment>
}`;

function nebulaTexture(seed: number): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = c.height = 512;
  const g = c.getContext('2d')!;
  let s = seed;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 70; i++) {
    const x = 256 + (rnd() - 0.5) * 360, y = 256 + (rnd() - 0.5) * 200, r = 40 + rnd() * 140;
    const gr = g.createRadialGradient(x, y, 0, x, y, r);
    const hue = rnd() < 0.7 ? '120,170,255' : '170,130,255';
    gr.addColorStop(0, `rgba(${hue},${0.05 + rnd() * 0.06})`);
    gr.addColorStop(1, `rgba(${hue},0)`);
    g.fillStyle = gr;
    g.fillRect(0, 0, 512, 512);
  }
  // Máscara elíptica: los bordes del sprite se desvanecen por completo (sin cortes rectos).
  g.globalCompositeOperation = 'destination-in';
  const mask = g.createRadialGradient(256, 256, 0, 256, 256, 256);
  mask.addColorStop(0, 'rgba(0,0,0,1)');
  mask.addColorStop(0.55, 'rgba(0,0,0,0.6)');
  mask.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = mask;
  g.fillRect(0, 0, 512, 512);
  g.globalCompositeOperation = 'source-over';
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class SpaceScene {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  private stars: Starfield;
  private earth: EarthMaterialHandle;
  private clouds: CloudLayer;
  private earthMesh: THREE.Mesh;
  private atmo: THREE.Mesh;
  private mars: THREE.Mesh;
  private marsMat: THREE.ShaderMaterial;
  private galaxy: THREE.Points;
  private nebulae: THREE.Sprite[] = [];
  private frame = 0;
  private last = performance.now();
  private t = 0;
  private disposed = false;
  private cam = { px: 0, py: 0.6, pz: 3.2, lx: 0, ly: 0, lz: 0, orbit: 0 };
  private tween: gsap.core.Timeline | null = null;
  target: SpaceTarget = 'mars';

  constructor(private canvas: HTMLCanvasElement, quality: 'high' | 'balanced' | 'low') {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: quality !== 'low', powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, quality === 'high' ? 1.75 : 1.25));
    this.renderer.setClearColor('#010309', 1);
    this.camera = new THREE.PerspectiveCamera(45, 1, 0.01, 60_000);
    this.resize();

    const q = quality === 'high' ? 'balanced' : quality;
    this.stars = createStarfield(q, 20_000, this.renderer.getPixelRatio());
    this.scene.add(this.stars.group);

    // Tierra (mismo material del observatorio) a escala 1.
    this.earth = createEarthMaterial(q);
    this.earthMesh = new THREE.Mesh(new THREE.SphereGeometry(1, 96, 64), this.earth.material);
    this.earthMesh.rotation.y = -Math.PI / 2;
    this.scene.add(this.earthMesh);
    this.clouds = createClouds(1.006, q);
    this.clouds.setOpacity(0.55);
    this.scene.add(this.clouds.mesh);
    this.atmo = createAtmosphere(1);
    this.scene.add(this.atmo);

    // Marte (radio relativo 0,53), procedural.
    this.marsMat = new THREE.ShaderMaterial({ uniforms: { uSun: { value: new THREE.Vector3(1, 0.3, 0.6).normalize() } }, vertexShader: marsVertex, fragmentShader: marsFragment });
    this.mars = new THREE.Mesh(new THREE.SphereGeometry(0.53, 96, 64), this.marsMat);
    this.mars.position.copy(MARS);
    this.mars.rotation.z = THREE.MathUtils.degToRad(25.2);
    this.scene.add(this.mars);

    // Banda galáctica ilustrativa.
    const n = 9000;
    const pos = new Float32Array(n * 3), col = new Float32Array(n * 3);
    let seed = 7738;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < n; i++) {
      const a = rnd() * Math.PI * 2, r = 4000 + rnd() * 2000;
      const spread = (rnd() + rnd() + rnd() - 1.5) * 380;
      const v = new THREE.Vector3(Math.cos(a) * r, spread, Math.sin(a) * r).applyAxisAngle(new THREE.Vector3(1, 0, 0.3).normalize(), 1.0);
      pos.set([v.x, v.y, v.z], i * 3);
      const b = 0.35 + rnd() * 0.65, warm = rnd();
      col.set(warm > 0.85 ? [b, b * 0.85, b * 0.7] : [b * 0.75, b * 0.85, b], i * 3);
    }
    const gg = new THREE.BufferGeometry();
    gg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    gg.setAttribute('color', new THREE.BufferAttribute(col, 3));
    this.galaxy = new THREE.Points(gg, new THREE.PointsMaterial({ size: 2.2, sizeAttenuation: false, vertexColors: true, transparent: true, opacity: 0.85, depthWrite: false }));
    this.scene.add(this.galaxy);
    [11, 23, 37].forEach((sd, i) => {
      const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: nebulaTexture(sd), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.6 }));
      spr.scale.set(5200, 2600, 1);
      spr.position.set(-3000 + i * 2600, 600 - i * 500, -6000);
      this.scene.add(spr);
      this.nebulae.push(spr);
    });

    window.addEventListener('resize', this.onResize);
    this.loop();
  }

  private onResize = () => this.resize();
  private resize() {
    const w = this.canvas.clientWidth || window.innerWidth, h = this.canvas.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    // Vertical: se abre el campo para que el planeta y el contexto quepan a lo ancho.
    this.camera.fov = w < h ? Math.min(80, THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(22.5)) * 0.9 / (w / h)))) : 45;
    this.camera.updateProjectionMatrix();
  }

  /** Viaja al destino. reduced = salto directo sin desplazamiento largo. */
  goTo(target: SpaceTarget, reduced: boolean) {
    this.target = target;
    this.tween?.kill();
    const c = this.cam;
    const to =
      target === 'mars'
        ? { px: MARS.x - 0.6, py: MARS.y + 0.35, pz: MARS.z + 1.75, lx: MARS.x, ly: MARS.y, lz: MARS.z }
        : { px: 18, py: 70, pz: 150, lx: 22, ly: 2, lz: -18 };
    const tl = gsap.timeline();
    tl.to(c, { ...to, duration: reduced ? 0.01 : 3.2, ease: 'power3.inOut' });
    this.tween = tl;
  }

  /** Posición inicial: junto a la Tierra (como si la cámara dejara el observatorio). */
  startFromEarth() {
    Object.assign(this.cam, { px: 0.4, py: 0.5, pz: 2.9, lx: 0, ly: 0, lz: 0 });
  }

  /** Proyección a pantalla de los cuerpos (para rótulos HTML). */
  project(which: 'earth' | 'mars'): { x: number; y: number } | null {
    const v = (which === 'earth' ? EARTH : MARS).clone().project(this.camera);
    if (v.z > 1) return null;
    const w = this.canvas.clientWidth, h = this.canvas.clientHeight;
    return { x: ((v.x + 1) / 2) * w, y: ((1 - v.y) / 2) * h };
  }

  private loop = () => {
    if (this.disposed) return;
    this.frame = requestAnimationFrame(this.loop);
    const now = performance.now();
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    this.t += dt;
    const c = this.cam;
    // Órbita lenta alrededor del objetivo una vez que se llega.
    const settle = this.tween && this.tween.isActive() ? 0 : 1;
    const ang = this.t * 0.05 * settle;
    const off = new THREE.Vector3(c.px - c.lx, c.py - c.ly, c.pz - c.lz).applyAxisAngle(new THREE.Vector3(0, 1, 0), this.target === 'mars' ? ang : ang * 0.3);
    this.camera.position.set(c.lx + off.x, c.ly + off.y, c.lz + off.z);
    this.camera.lookAt(c.lx, c.ly, c.lz);
    this.mars.rotation.y += dt * 0.04;
    this.earthMesh.rotation.y += dt * 0.02;
    this.clouds.update(dt);
    const sun = new THREE.Vector3(-1, 0.25, 0.55).normalize();
    this.earth.setSun(sun);
    this.clouds.setSun(sun);
    this.marsMat.uniforms.uSun.value.copy(sun);
    this.stars.update(this.t);
    this.renderer.render(this.scene, this.camera);
  };

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.frame);
    window.removeEventListener('resize', this.onResize);
    this.tween?.kill();
    this.stars.dispose();
    this.earth.dispose();
    this.clouds.dispose();
    this.earthMesh.geometry.dispose();
    this.atmo.geometry.dispose();
    (this.atmo.material as THREE.Material).dispose();
    this.mars.geometry.dispose();
    this.marsMat.dispose();
    this.galaxy.geometry.dispose();
    (this.galaxy.material as THREE.Material).dispose();
    this.nebulae.forEach((s) => { s.material.map?.dispose(); s.material.dispose(); });
    this.renderer.dispose();
  }
}
