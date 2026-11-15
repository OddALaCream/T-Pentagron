/**
 * Introducción de T-PENTAGRON (renderizador propio, independiente del globo).
 *
 * Un solo plano continuo:
 *  A · Encuentro: un astronauta, de espaldas, contempla la Tierra por una escotilla.
 *  B · Transición: la cámara avanza por encima de su hombro y cruza la escotilla.
 *  C · Revelación: el planeta crece hasta el encuadre orbital del observatorio.
 *  D · Activación: aparece la identidad y el observatorio toma el relevo con el mismo
 *      encuadre (el globo real ya está preparado debajo), sin cortes a negro.
 *
 * La cabina está colocada en el mundo del globo, sobre la línea de visión del encuadre
 * inicial: la Tierra que se ve por la ventana es la misma que se ve al final.
 */
import * as THREE from 'three';
import gsap from 'gsap';
import { appConfig } from '@/config/app';
import { createAtmosphere, createClouds, createEarthMaterial, type CloudLayer, type EarthMaterialHandle } from './earth';
import { createDust, createStarfield, type Dust, type Starfield } from './space';
import { createScan, GLOBE_RADIUS, polarToCartesian, type ScanController } from './dataLayers';
import { createAstronaut, type AstronautRig } from './astronaut';

export interface IntroCallbacks {
  /** Momento de reanudar el render del observatorio (antes del relevo). */
  onPrepare: () => void;
  /** Relevo: el observatorio pasa a primer plano. */
  onHandoff: () => void;
  /** La capa de intro terminó de desvanecerse. */
  onDone: () => void;
  /** Opacidad de la identidad (texto DOM). */
  onWordmark?: (opacity: number) => void;
  /** Frase breve del asistente (null = ocultar). */
  onCaption?: (text: string | null) => void;
}

/** Metros de cabina → unidades del mundo del globo (radio terrestre = 100). */
const K = 14;

export class IntroScene {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private starfield: Starfield;
  private dust: Dust;
  private earth: EarthMaterialHandle;
  private earthMesh: THREE.Mesh;
  private atmosphere: THREE.Mesh;
  private clouds: CloudLayer;
  private scan: ScanController;
  private rig: AstronautRig;
  private cabin = new THREE.Group();
  private timeline: gsap.core.Timeline | null = null;
  private frame = 0;
  private lastTime = 0;
  private elapsed = 0;
  private canvas: HTMLCanvasElement;
  private handedOff = false;
  private finished = false;
  private watchdog: number | undefined;
  private params = { travel: 0, fade: 1, reveal: 0 };
  private path: THREE.CatmullRomCurve3;
  private finalPos: THREE.Vector3;
  private basis = new THREE.Matrix4();

  constructor(
    container: HTMLElement,
    private options: { reduced: boolean; quality: 'high' | 'balanced' | 'low'; callbacks: IntroCallbacks },
  ) {
    const lowPower = options.quality === 'low';
    // Canvas propio por ejecución: un contexto WebGL liberado nunca se reutiliza.
    const canvas = document.createElement('canvas');
    canvas.className = 'intro__canvas';
    canvas.setAttribute('aria-hidden', 'true');
    container.prepend(canvas);
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: !lowPower, alpha: false, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, lowPower ? 1 : 1.75));
    this.renderer.setClearColor('#010309', 1);
    this.renderer.setSize(window.innerWidth, window.innerHeight, false);
    this.camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.05, 160_000);
    this.scene.add(this.camera);

    const q = lowPower ? 'low' : 'balanced';
    const pr = this.renderer.getPixelRatio();
    this.starfield = createStarfield(q, 22_000, pr);
    this.scene.add(this.starfield.group);
    this.dust = createDust(q, 120, 5200, pr, 19);
    this.scene.add(this.dust.points);

    this.earth = createEarthMaterial(q);
    this.earthMesh = new THREE.Mesh(new THREE.SphereGeometry(GLOBE_RADIUS, 128, 96), this.earth.material);
    this.earthMesh.rotation.y = -Math.PI / 2;
    this.scene.add(this.earthMesh);
    this.atmosphere = createAtmosphere(GLOBE_RADIUS);
    this.scene.add(this.atmosphere);
    this.clouds = createClouds(GLOBE_RADIUS * 1.0016, q);
    this.clouds.setOpacity(0.62);
    this.scene.add(this.clouds.mesh);
    this.scan = createScan();
    this.scene.add(this.scan.mesh);

    // Cabina y astronauta, alineados con el encuadre inicial del observatorio.
    const v = appConfig.initialView;
    this.finalPos = polarToCartesian(v.lat, v.lng, v.altitude);
    const z = this.finalPos.clone().normalize();
    const x = new THREE.Vector3(0, 1, 0).cross(z).normalize();
    const y = z.clone().cross(x).normalize();
    this.basis.makeBasis(x, y, z);
    // La escotilla queda 0,8 m "detrás" del encuadre final: al cruzarla se llega a él.
    const windowCenter = this.finalPos.clone().addScaledVector(z, 0.8 * K);
    this.cabin.matrixAutoUpdate = false;
    this.cabin.matrix.copy(this.basis).scale(new THREE.Vector3(K, K, K)).setPosition(windowCenter);
    this.rig = createAstronaut();
    this.cabin.add(this.rig.group);
    this.scene.add(this.cabin);

    // Trayectoria en metros de cabina (luego al mundo): detrás del astronauta → sobre su
    // hombro derecho → a través de la escotilla → encuadre orbital.
    const local = [
      new THREE.Vector3(0, 0.12, 5.4),
      new THREE.Vector3(0.22, 0.12, 4.7),
      new THREE.Vector3(1.3, 0.55, 1.5),
      new THREE.Vector3(0.35, 0.18, -0.45),
      new THREE.Vector3(0, 0, -0.8),
    ];
    this.path = new THREE.CatmullRomCurve3(local.map((p) => this.toWorld(p)), false, 'centripetal');

    window.addEventListener('resize', this.onResize);
  }

  private toWorld(p: THREE.Vector3): THREE.Vector3 {
    return p.clone().multiplyScalar(K).applyMatrix4(new THREE.Matrix4().extractRotation(this.basis)).add(
      this.finalPos.clone().addScaledVector(this.finalPos.clone().normalize(), 0.8 * K),
    );
  }

  private onResize = () => {
    this.renderer.setSize(window.innerWidth, window.innerHeight, false);
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
  };

  /**
   * Compila los shaders en paralelo (KHR_parallel_shader_compile) antes de empezar,
   * para que la coreografía no se congele; con un tope de espera por seguridad.
   */
  start() {
    let begun = false;
    const begin = () => {
      if (begun || this.finished) return;
      begun = true;
      this.lastTime = performance.now();
      this.begin();
      this.loop();
    };
    window.setTimeout(begin, 5000);
    this.renderer.compileAsync(this.scene, this.camera).then(begin, begin);
  }

  private begin() {
    const p = this.params;
    const cb = this.options.callbacks;
    const tl = gsap.timeline();
    this.timeline = tl;
    const handoff = () => this.handoff();

    if (this.options.reduced || this.options.quality === 'low') {
      // Versión sobria: el encuentro con el astronauta y un fundido al observatorio.
      Object.assign(p, { travel: 0.04, reveal: 1 });
      tl.call(() => cb.onCaption?.('Mira nuestro planeta.'), [], 0.3);
      tl.call(() => cb.onPrepare(), [], 1.4);
      tl.call(() => { cb.onCaption?.(null); cb.onWordmark?.(1); }, [], 1.8);
      tl.call(() => cb.onWordmark?.(0), [], 3.0);
      tl.call(handoff, [], 3.1);
    } else {
      // A · Encuentro (0–2,4 s): aparece el astronauta frente a la escotilla.
      tl.fromTo(p, { reveal: 0 }, { reveal: 1, duration: 1.4, ease: 'power2.out' }, 0);
      tl.call(() => cb.onCaption?.('Mira nuestro planeta.'), [], 0.7);
      tl.to(p, { travel: 0.12, duration: 2.4, ease: 'sine.inOut' }, 0);
      // B · Transición (2,4–5,4 s): sobre el hombro y a través de la escotilla.
      tl.call(() => cb.onCaption?.(null), [], 2.9);
      tl.to(p, { travel: 1, duration: 4.8, ease: 'power2.inOut' }, 2.4);
      // C · Revelación (≈5,4–7,2 s): el globo se prepara debajo y aparece el primer pulso.
      tl.call(() => cb.onPrepare(), [], 6.4);
      tl.call(() => {
        const origin = this.camera.position.clone().normalize();
        this.scan.trigger(origin, { duration: 4.2 });
      }, [], 6.6);
      // D · Activación (7,2–8,6 s): identidad y relevo al observatorio.
      tl.call(() => cb.onWordmark?.(1), [], 7.0);
      tl.call(() => cb.onWordmark?.(0), [], 8.5);
      tl.call(handoff, [], 8.6);
    }

    this.watchdog = window.setTimeout(() => this.skip(), (appConfig.introDuration + 4) * 1000);
  }

  private handoff() {
    if (this.handedOff) return;
    this.handedOff = true;
    // Encuadre final garantizado (aunque la línea de tiempo se haya retrasado).
    this.timeline?.kill();
    gsap.to(this.params, { travel: 1, reveal: 1, duration: 0.25, ease: 'power1.out' });
    this.options.callbacks.onCaption?.(null);
    this.options.callbacks.onPrepare();
    this.options.callbacks.onHandoff();
    gsap.to(this.params, {
      fade: 0,
      duration: this.options.reduced ? 0.5 : 0.85,
      ease: 'power1.inOut',
      onComplete: () => this.finish(),
    });
  }

  /** Saltar: llega de inmediato a un estado estable del observatorio. */
  skip() {
    if (this.finished) return;
    this.timeline?.kill();
    this.options.callbacks.onWordmark?.(0);
    this.options.callbacks.onCaption?.(null);
    if (!this.handedOff) {
      this.handedOff = true;
      this.options.callbacks.onPrepare();
      this.options.callbacks.onHandoff();
    }
    gsap.killTweensOf(this.params);
    Object.assign(this.params, { travel: 1, reveal: 1 });
    gsap.to(this.params, { fade: 0, duration: 0.3, ease: 'power1.out', onComplete: () => this.finish() });
  }

  private finish() {
    if (this.finished) return;
    this.finished = true;
    window.clearTimeout(this.watchdog);
    this.options.callbacks.onDone();
  }

  private loop = () => {
    if (this.finished) return;
    this.frame = requestAnimationFrame(this.loop);
    const now = performance.now();
    const dt = Math.min(0.05, (now - this.lastTime) / 1000);
    this.lastTime = now;
    this.elapsed += dt;
    const p = this.params;

    // Cámara: recorrido continuo y mirada siempre al centro de la Tierra.
    const pos = this.path.getPoint(Math.min(1, Math.max(0, p.travel)));
    this.camera.position.copy(pos);
    this.camera.up.set(0, 1, 0);
    this.camera.lookAt(0, 0, 0);
    // En pantallas verticales se abre el encuadre en la cabina (astronauta y escotilla
    // completos) y se vuelve a los 50° del globo antes del relevo.
    const aspect = this.camera.aspect;
    const cabinFov = aspect < 1 ? Math.min(92, THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(25)) / aspect))) : 50;
    const fov = THREE.MathUtils.lerp(cabinFov, 50, THREE.MathUtils.smoothstep(p.travel, 0.2, 0.9));
    if (Math.abs(this.camera.fov - fov) > 0.01) {
      this.camera.fov = fov;
      this.camera.updateProjectionMatrix();
    }

    // Astronauta flotando; la cabina se apaga al quedar detrás de la cámara.
    this.rig.update(this.elapsed);
    this.cabin.visible = p.travel < 0.985;

    // Sol cinemático relativo a la cámara (igual que en el observatorio).
    const camDir = this.camera.position.clone().normalize();
    const right = new THREE.Vector3(0, 1, 0).cross(camDir).normalize();
    const up = camDir.clone().cross(right).normalize();
    const sun = camDir.multiplyScalar(0.62).addScaledVector(right, -0.7).addScaledVector(up, 0.38).normalize();
    this.earth.setSun(sun);
    this.clouds.setSun(sun);
    this.clouds.update(dt);
    (this.earth.material.uniforms.exposure as THREE.IUniform<number>).value = 0.35 + 0.65 * p.reveal;
    (this.atmosphere.material as THREE.ShaderMaterial).uniforms.intensity.value = p.reveal;
    this.starfield.setOpacity(0.4 + 0.6 * p.reveal);
    this.starfield.update(this.elapsed);
    this.dust.setOpacity(0.5 * p.reveal);
    this.dust.update(this.elapsed, dt);
    this.scan.update(dt);

    this.canvas.style.opacity = String(p.fade * Math.min(1, 0.15 + p.reveal));
    this.renderer.render(this.scene, this.camera);
  };

  dispose() {
    // Una instancia liberada nunca vuelve a invocar callbacks (p. ej. tras compileAsync).
    this.finished = true;
    this.handedOff = true;
    cancelAnimationFrame(this.frame);
    window.clearTimeout(this.watchdog);
    window.removeEventListener('resize', this.onResize);
    this.timeline?.kill();
    gsap.killTweensOf(this.params);
    this.starfield.dispose();
    this.dust.dispose();
    this.earth.dispose();
    this.earthMesh.geometry.dispose();
    this.atmosphere.geometry.dispose();
    (this.atmosphere.material as THREE.Material).dispose();
    this.clouds.dispose();
    this.scan.dispose();
    this.rig.dispose();
    this.renderer.dispose();
    this.canvas.remove();
  }
}
