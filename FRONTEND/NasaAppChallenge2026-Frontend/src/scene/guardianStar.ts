/**
 * La estrella guardiana "Vigía": representación visual del sistema que observa la Tierra.
 *
 * Totalmente procedural (Three.js + GLSL): cuerpo estelar de puntas suaves con plasma
 * interno, corona luminosa, visor de observación con HUD y un pequeño telescopio lateral.
 * Sin ojos ni cara: la personalidad se expresa con postura, orientación, respiración,
 * micro-movimientos de curiosidad y el brillo del visor.
 */
import * as THREE from 'three';
import { simplexNoise3D } from './shaders/noise';
import { radialTexture } from './textures';

export interface GuardianState {
  /** 0 = dormida (tenue, azulada) · 1 = despierta (cálida, luminosa) */
  awake: number;
  /** 0 = visor arriba/oculto · 1 = visor colocado */
  visor: number;
  /** Intensidad del HUD del visor */
  hud: number;
  /** Escala global de presencia (aparición) */
  presence: number;
  /** Flexión de las puntas (lenguaje corporal) */
  flex: number;
}

export interface GuardianStar {
  root: THREE.Group;
  state: GuardianState;
  /** Dirección (espacio mundo) hacia la que mira; null = al frente. */
  lookAtWorld: (target: THREE.Vector3 | null) => void;
  /** Orientación directa (yaw/pitch en radianes, espacio local del padre). */
  setLookAngles: (yaw: number, pitch: number) => void;
  react: (kind?: 'select' | 'scan' | 'curious' | 'poke') => void;
  update: (t: number, dt: number) => void;
  setRenderOnTop: (onTop: boolean) => void;
  dispose: () => void;
}

const bodyVertex = /* glsl */ `
uniform float uTime;
uniform float uFlex;
varying vec3 vLocal;
varying vec3 vNormalV;
varying vec3 vViewDir;
void main() {
  vec3 p = position;
  float ang = atan(p.y, p.x);
  float r = length(p.xy);
  // ondulación que recorre las puntas
  float wave = sin(ang * 5.0 - uTime * 1.6) * 0.5 + 0.5;
  p.z += uFlex * wave * smoothstep(0.35, 1.0, r) * 0.18 * sign(p.z + 0.0001);
  p.xy *= 1.0 + uFlex * 0.04 * sin(uTime * 2.1 + ang * 5.0) * smoothstep(0.4, 1.0, r);
  vLocal = p;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  vNormalV = normalize(normalMatrix * normal);
  vViewDir = normalize(-mv.xyz);
  gl_Position = projectionMatrix * mv;
}`;

const bodyFragment = /* glsl */ `
${simplexNoise3D}
uniform float uTime;
uniform float uAwake;
uniform float uFlash;
varying vec3 vLocal;
varying vec3 vNormalV;
varying vec3 vViewDir;
void main() {
  float r = length(vLocal.xy);
  float n = snoise(vLocal * 2.4 + vec3(0.0, 0.0, uTime * 0.25)) * 0.7 + snoise(vLocal * 5.3 - vec3(uTime * 0.18)) * 0.3;
  float fres = pow(1.0 - max(dot(normalize(vNormalV), normalize(vViewDir)), 0.0), 2.2);
  vec3 coreHot = vec3(1.0, 0.96, 0.86);
  vec3 midWarm = vec3(1.0, 0.76, 0.36);
  vec3 edge = vec3(0.98, 0.5, 0.2);
  vec3 col = mix(coreHot, midWarm, smoothstep(0.05, 0.6, r));
  col = mix(col, edge, smoothstep(0.55, 1.05, r));
  col *= 0.88 + 0.22 * n;
  col += vec3(1.0, 0.88, 0.6) * fres * 0.75;
  // estado dormido: frío, tenue
  vec3 sleepy = vec3(0.16, 0.2, 0.32) + vec3(0.25, 0.32, 0.5) * fres;
  col = mix(sleepy, col, uAwake);
  col += vec3(0.6, 0.95, 1.0) * uFlash * 0.5;
  float intensity = mix(0.55, 1.35, uAwake);
  gl_FragColor = vec4(col * intensity, 1.0);
  #include <colorspace_fragment>
}`;

const visorFragment = /* glsl */ `
uniform float uTime;
uniform float uHud;
uniform float uScan;
uniform vec2 uReticle;
varying vec2 vUv;
varying vec3 vNormalV;
varying vec3 vViewDir;
void main() {
  float fres = pow(1.0 - max(dot(normalize(vNormalV), normalize(vViewDir)), 0.0), 1.6);
  vec3 glass = vec3(0.025, 0.05, 0.09);
  // reflejo de banda (estudio)
  float band = smoothstep(0.62, 0.7, vUv.y) * (1.0 - smoothstep(0.7, 0.8, vUv.y));
  vec3 col = glass + vec3(0.55, 0.75, 1.0) * band * 0.35 + vec3(0.4, 0.7, 1.0) * fres * 0.55;
  // HUD: línea de barrido + retícula + marcas
  float sweep = exp(-pow((vUv.x - fract(uTime * (0.22 + uScan * 0.9))) * 26.0, 2.0));
  float ticks = step(0.92, fract(vUv.x * 18.0)) * step(0.18, vUv.y) * step(vUv.y, 0.26);
  vec2 rp = (vUv - (vec2(0.5, 0.48) + uReticle * vec2(0.28, 0.2))) * vec2(3.6, 1.0);
  float ring = 1.0 - smoothstep(0.0, 0.018, abs(length(rp) - 0.09));
  float dot_ = 1.0 - smoothstep(0.0, 0.03, length(rp));
  vec3 hud = vec3(0.45, 0.92, 1.0) * (sweep * 0.9 + ticks * 0.45 + ring * 0.85 + dot_ * 0.9);
  col += hud * uHud;
  gl_FragColor = vec4(col, 0.93);
  #include <colorspace_fragment>
}`;

function starShape(points = 5, outer = 1, inner = 0.5, softness = 1.7, samples = 240): THREE.Shape {
  const shape = new THREE.Shape();
  for (let i = 0; i <= samples; i++) {
    const a = (i / samples) * Math.PI * 2 + Math.PI / 2;
    const k = Math.pow(0.5 + 0.5 * Math.cos(points * (a - Math.PI / 2)), softness);
    const r = inner + (outer - inner) * k;
    const x = Math.cos(a) * r;
    const y = Math.sin(a) * r;
    if (i === 0) shape.moveTo(x, y);
    else shape.lineTo(x, y);
  }
  return shape;
}

export function createGuardianStar(options: { quality?: 'high' | 'balanced' | 'low' } = {}): GuardianStar {
  const quality = options.quality ?? 'high';
  const root = new THREE.Group();
  root.name = 'guardian-star';
  const pivot = new THREE.Group(); // inclinaciones y respiración
  root.add(pivot);
  const look = new THREE.Group(); // orientación de la mirada
  pivot.add(look);

  const state: GuardianState = { awake: 1, visor: 1, hud: 1, presence: 1, flex: 0.35 };
  const disposables: { dispose: () => void }[] = [];

  /* Cuerpo */
  const geometry = new THREE.ExtrudeGeometry(starShape(5, 1, 0.52, 1.65, quality === 'low' ? 160 : 260), {
    depth: 0.26,
    bevelEnabled: true,
    bevelThickness: 0.2,
    bevelSize: 0.13,
    bevelSegments: quality === 'low' ? 4 : 8,
    curveSegments: 12,
  });
  geometry.center();
  geometry.computeVertexNormals();
  const bodyUniforms = { uTime: { value: 0 }, uFlex: { value: state.flex }, uAwake: { value: 1 }, uFlash: { value: 0 } };
  const bodyMat = new THREE.ShaderMaterial({ uniforms: bodyUniforms, vertexShader: bodyVertex, fragmentShader: bodyFragment });
  const body = new THREE.Mesh(geometry, bodyMat);
  look.add(body);
  disposables.push(geometry, bodyMat);

  /* Corona y destello */
  const haloTex = radialTexture([
    [0, 'rgba(255,236,190,0.95)'], [0.18, 'rgba(255,190,110,0.45)'], [0.45, 'rgba(255,140,60,0.12)'], [1, 'rgba(255,120,40,0)'],
  ], 256);
  const haloMat = new THREE.SpriteMaterial({ map: haloTex, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.85 });
  const halo = new THREE.Sprite(haloMat);
  halo.scale.setScalar(5.2);
  halo.renderOrder = -1;
  pivot.add(halo);
  const streakTex = radialTexture([[0, 'rgba(200,230,255,0.7)'], [0.3, 'rgba(160,200,255,0.12)'], [1, 'rgba(120,170,255,0)']], 128);
  const streakMat = new THREE.SpriteMaterial({ map: streakTex, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.35 });
  const streak = new THREE.Sprite(streakMat);
  streak.scale.set(9, 0.32, 1);
  pivot.add(streak);
  disposables.push(haloTex, haloMat, streakTex, streakMat);

  /* Visor */
  const visorGroup = new THREE.Group();
  look.add(visorGroup);
  const visorGeo = new THREE.CylinderGeometry(0.66, 0.6, 0.34, 48, 1, true, -Math.PI * 0.36, Math.PI * 0.72);
  const visorUniforms = { uTime: { value: 0 }, uHud: { value: 1 }, uScan: { value: 0 }, uReticle: { value: new THREE.Vector2() } };
  const visorMat = new THREE.ShaderMaterial({
    uniforms: visorUniforms,
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      varying vec3 vNormalV;
      varying vec3 vViewDir;
      void main() {
        vUv = uv;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vNormalV = normalize(normalMatrix * normal);
        vViewDir = normalize(-mv.xyz);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: visorFragment,
    transparent: true,
    side: THREE.DoubleSide,
  });
  const visor = new THREE.Mesh(visorGeo, visorMat);
  visor.rotation.y = 0; // el arco mira hacia +Z
  visorGroup.add(visor);
  const frameMat = new THREE.MeshStandardMaterial({ color: '#c9d6ea', metalness: 0.85, roughness: 0.28, emissive: '#1b2a40', emissiveIntensity: 0.6 });
  const rimGeo = new THREE.TorusGeometry(0.645, 0.026, 8, 64, Math.PI * 0.74);
  const rimTop = new THREE.Mesh(rimGeo, frameMat);
  rimTop.rotation.set(Math.PI / 2, 0, Math.PI * 0.13);
  rimTop.position.y = 0.17;
  const rimBottom = rimTop.clone();
  rimBottom.position.y = -0.17;
  visorGroup.add(rimTop, rimBottom);
  // telescopio lateral (lente de vigía)
  const lensGroup = new THREE.Group();
  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.13, 0.28, 24), frameMat);
  barrel.rotation.x = Math.PI / 2;
  const glassMat = new THREE.MeshBasicMaterial({ color: '#7fe8ff', transparent: true, opacity: 0.9 });
  const glassLens = new THREE.Mesh(new THREE.CircleGeometry(0.085, 24), glassMat);
  glassLens.position.z = 0.145;
  lensGroup.add(barrel, glassLens);
  lensGroup.position.set(0.52, 0.06, 0.42);
  lensGroup.rotation.y = 0.55;
  visorGroup.add(lensGroup);
  visorGroup.position.set(0, 0.2, 0.04);
  disposables.push(visorGeo, visorMat, frameMat, rimGeo, barrel.geometry, glassLens.geometry, glassMat);

  /* Chispas orbitales */
  const sparkCount = quality === 'low' ? 6 : 12;
  const sparkGeo = new THREE.BufferGeometry();
  sparkGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(sparkCount * 3), 3));
  const sparkTex = radialTexture([[0, 'rgba(255,240,210,1)'], [0.4, 'rgba(255,200,120,0.35)'], [1, 'rgba(255,160,80,0)']], 64);
  const sparkMat = new THREE.PointsMaterial({ size: 0.16, map: sparkTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.9 });
  const sparks = new THREE.Points(sparkGeo, sparkMat);
  pivot.add(sparks);
  disposables.push(sparkGeo, sparkTex, sparkMat);

  /* Anillo de pulso de observación */
  const pulseTex = radialTexture([[0, 'rgba(120,230,255,0)'], [0.7, 'rgba(120,230,255,0)'], [0.86, 'rgba(160,240,255,0.8)'], [1, 'rgba(120,230,255,0)']], 256);
  const pulseMat = new THREE.SpriteMaterial({ map: pulseTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0 });
  const pulse = new THREE.Sprite(pulseMat);
  pivot.add(pulse);
  disposables.push(pulseTex, pulseMat);

  /* Controlador de comportamiento */
  const targetQuat = new THREE.Quaternion();
  const tmpMatrix = new THREE.Matrix4();
  const tmpV = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);
  let lookWorld: THREE.Vector3 | null = null;
  let manualYaw = 0;
  let manualPitch = 0;
  let useManual = false;
  let flash = 0;
  let pop = 0;
  let pulseT = 1;
  let scanBoost = 0;
  let curiousTimer = 3 + Math.random() * 4;
  let curiousYaw = 0;
  let curiousPitch = 0;
  let curiousTilt = 0;
  let tiltTarget = 0;
  let tilt = 0;
  const reticle = new THREE.Vector2();

  const star: GuardianStar = {
    root,
    state,
    lookAtWorld: (target) => {
      lookWorld = target ? target.clone() : null;
      useManual = false;
    },
    setLookAngles: (yaw, pitch) => {
      manualYaw = yaw;
      manualPitch = pitch;
      useManual = true;
    },
    react: (kind = 'select') => {
      if (kind === 'select') {
        flash = 1;
        pop = 1;
        tiltTarget = (Math.random() < 0.5 ? -1 : 1) * 0.22;
        pulseT = 0;
      } else if (kind === 'scan') {
        scanBoost = 1;
        pulseT = 0;
        flash = 0.6;
      } else if (kind === 'poke') {
        pop = 1.4;
        flash = 0.8;
        tiltTarget = (Math.random() < 0.5 ? -1 : 1) * 0.35;
      } else {
        tiltTarget = (Math.random() < 0.5 ? -1 : 1) * 0.18;
      }
    },
    setRenderOnTop: (onTop) => {
      root.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (!mesh.material) return;
        const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        mats.forEach((m) => {
          m.depthTest = !onTop;
          m.depthWrite = !onTop && !(m.transparent);
        });
        o.renderOrder = onTop ? 50 + (o.renderOrder ?? 0) : o.renderOrder;
      });
    },
    update: (t, dt) => {
      const s = state;
      bodyUniforms.uTime.value = t;
      bodyUniforms.uAwake.value = s.awake;
      bodyUniforms.uFlex.value = s.flex * (0.6 + 0.4 * s.awake);
      visorUniforms.uTime.value = t;
      visorUniforms.uHud.value = s.hud * s.visor;
      flash = Math.max(0, flash - dt * 1.8);
      pop = Math.max(0, pop - dt * 2.4);
      scanBoost = Math.max(0, scanBoost - dt * 0.25);
      bodyUniforms.uFlash.value = flash;
      visorUniforms.uScan.value = scanBoost;
      glassMat.opacity = 0.55 + 0.45 * Math.max(flash, 0.5 + 0.5 * Math.sin(t * 3.1)) * s.visor;

      // Respiración, flotación y balanceo.
      const breathe = 1 + 0.028 * Math.sin(t * 1.55) * s.awake;
      const popScale = 1 + 0.09 * Math.sin(pop * Math.PI) * (pop > 0 ? 1 : 0);
      pivot.scale.setScalar(s.presence * breathe * popScale);
      pivot.position.y = Math.sin(t * 1.05) * 0.06 * s.awake;
      tilt += (tiltTarget - tilt) * Math.min(1, dt * 5);
      tiltTarget *= Math.max(0, 1 - dt * 1.4);
      pivot.rotation.z = Math.sin(t * 0.7) * 0.05 + tilt + curiousTilt;

      // Curiosidad: micro-miradas ocasionales cuando no hay un objetivo.
      curiousTimer -= dt;
      if (curiousTimer <= 0) {
        curiousTimer = 2.5 + Math.random() * 5;
        const idle = !lookWorld && !useManual;
        curiousYaw = idle ? (Math.random() - 0.5) * 0.7 : (Math.random() - 0.5) * 0.18;
        curiousPitch = idle ? (Math.random() - 0.5) * 0.35 : (Math.random() - 0.5) * 0.1;
        curiousTilt = (Math.random() - 0.5) * 0.12;
      }
      curiousTilt *= Math.max(0, 1 - dt * 0.6);

      // Orientación de la mirada.
      let yaw = curiousYaw;
      let pitch = curiousPitch;
      if (useManual) {
        yaw = manualYaw + curiousYaw * 0.2;
        pitch = manualPitch + curiousPitch * 0.2;
      } else if (lookWorld && root.parent) {
        root.updateWorldMatrix(true, false);
        tmpV.copy(lookWorld);
        root.worldToLocal(tmpV);
        tmpV.normalize();
        yaw = Math.atan2(tmpV.x, tmpV.z) + curiousYaw * 0.2;
        pitch = -Math.atan2(tmpV.y, Math.hypot(tmpV.x, tmpV.z)) + curiousPitch * 0.2;
      }
      yaw = THREE.MathUtils.clamp(yaw, -1.0, 1.0);
      pitch = THREE.MathUtils.clamp(pitch, -0.7, 0.7);
      tmpMatrix.makeRotationFromEuler(new THREE.Euler(pitch, yaw, 0, 'YXZ'));
      targetQuat.setFromRotationMatrix(tmpMatrix);
      look.quaternion.slerp(targetQuat, Math.min(1, dt * 3.2));
      reticle.set(THREE.MathUtils.clamp(yaw, -1, 1) * 0.6, THREE.MathUtils.clamp(-pitch, -1, 1) * 0.6);
      visorUniforms.uReticle.value.lerp(reticle, Math.min(1, dt * 4));

      // Visor: desciende desde arriba al colocarse.
      const v = s.visor;
      visorGroup.position.y = 0.2 + (1 - v) * 1.15;
      visorGroup.scale.setScalar(0.6 + 0.4 * v);
      visorGroup.visible = v > 0.02;
      visorMat.opacity = v;

      // Corona.
      haloMat.opacity = (0.15 + 0.75 * s.awake) * s.presence * (1 + flash * 0.6);
      halo.scale.setScalar((4.4 + 0.25 * Math.sin(t * 1.7)) * (0.7 + 0.3 * s.awake));
      streakMat.opacity = 0.32 * s.awake * s.presence;

      // Chispas.
      const pos = sparkGeo.getAttribute('position') as THREE.BufferAttribute;
      for (let i = 0; i < sparkCount; i++) {
        const a = t * (0.35 + (i % 4) * 0.08) + (i * Math.PI * 2) / sparkCount;
        const r = 1.45 + 0.25 * Math.sin(t * 0.9 + i);
        pos.setXYZ(i, Math.cos(a) * r, Math.sin(a * 1.3 + i) * 0.45, Math.sin(a) * r * 0.55);
      }
      pos.needsUpdate = true;
      sparkMat.opacity = 0.85 * s.awake * s.presence;

      // Pulso de observación.
      if (pulseT < 1) {
        pulseT = Math.min(1, pulseT + dt / 1.1);
        pulse.scale.setScalar(1 + pulseT * 7);
        pulseMat.opacity = (1 - pulseT) * 0.9;
      } else {
        pulseMat.opacity = 0;
      }
      up.set(0, 1, 0);
    },
    dispose: () => {
      disposables.forEach((d) => d.dispose());
    },
  };
  return star;
}
