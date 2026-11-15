/**
 * Astronauta y cabina de la introducción (procedurales, originales).
 *
 * Unidades locales en metros: el astronauta mide ~1,8 m y mira hacia −Z (la escotilla);
 * la cámara empieza detrás de él (+Z). La escotilla está en el plano z = 0. El grupo
 * completo se escala y se coloca en el mundo del globo desde la escena de introducción.
 */
import * as THREE from 'three';

export interface AstronautRig {
  group: THREE.Group;
  /** Luces propias (borde frío del planeta y lámpara cálida de cabina). */
  lights: THREE.Group;
  update: (t: number) => void;
  dispose: () => void;
}

function capsule(r: number, len: number, mat: THREE.Material, seg = 16): THREE.Mesh {
  return new THREE.Mesh(new THREE.CapsuleGeometry(r, len, 6, seg), mat);
}

/** Tubo entre dos puntos con una curva suave (mangueras del traje). */
function hose(points: THREE.Vector3[], r: number, mat: THREE.Material): THREE.Mesh {
  return new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points), 32, r, 8, false), mat);
}

export function createAstronaut(): AstronautRig {
  const group = new THREE.Group();
  /** El astronauta flota a 1,7 m de la escotilla; sus pies quedan bajo el borde inferior del encuadre. */
  const astro = new THREE.Group();
  astro.position.set(-0.55, -1.55, 1.7);
  group.add(astro);
  const body = new THREE.Group();
  astro.add(body);
  const disposables: { dispose: () => void }[] = [];
  const track = <T extends { dispose: () => void }>(x: T) => (disposables.push(x), x);

  const fabric = track(new THREE.MeshStandardMaterial({ color: '#e6e8ec', roughness: 0.88, metalness: 0.02 }));
  const fabricDark = track(new THREE.MeshStandardMaterial({ color: '#9aa2ad', roughness: 0.8, metalness: 0.05 }));
  const metal = track(new THREE.MeshStandardMaterial({ color: '#b9c2cd', roughness: 0.32, metalness: 0.85 }));
  const shell = track(new THREE.MeshPhysicalMaterial({ color: '#eef1f5', roughness: 0.22, metalness: 0.05, clearcoat: 1, clearcoatRoughness: 0.12 }));
  const visor = track(new THREE.MeshPhysicalMaterial({ color: '#2a1d08', roughness: 0.05, metalness: 1, clearcoat: 1, emissive: '#3a2a10', emissiveIntensity: 0.15 }));
  const pack = track(new THREE.MeshStandardMaterial({ color: '#c3c8cf', roughness: 0.55, metalness: 0.25 }));
  const ledAmber = track(new THREE.MeshBasicMaterial({ color: new THREE.Color('#ffb24a').multiplyScalar(2.2), toneMapped: false }));
  const ledCyan = track(new THREE.MeshBasicMaterial({ color: new THREE.Color('#7fe8ff').multiplyScalar(1.8), toneMapped: false }));

  // Torso y cadera
  const torso = capsule(0.25, 0.36, fabric);
  torso.scale.set(1.18, 1, 0.82);
  torso.position.set(0, 1.28, 0);
  const hips = capsule(0.21, 0.12, fabricDark);
  hips.scale.set(1.2, 1, 0.85);
  hips.position.set(0, 0.92, 0);
  body.add(torso, hips);

  // Mochila de soporte vital (cara visible desde la cámara)
  const backpack = new THREE.Mesh(track(new THREE.BoxGeometry(0.5, 0.6, 0.2, 2, 2, 2)), pack);
  backpack.position.set(0, 1.36, 0.27);
  body.add(backpack);
  const packTop = new THREE.Mesh(track(new THREE.CylinderGeometry(0.1, 0.1, 0.5, 16)), pack);
  packTop.rotation.z = Math.PI / 2;
  packTop.position.set(0, 1.67, 0.27);
  body.add(packTop);
  const panel = new THREE.Mesh(track(new THREE.BoxGeometry(0.2, 0.16, 0.03)), fabricDark);
  panel.position.set(0.02, 1.36, 0.38);
  body.add(panel);
  [[-0.05, 1.39, ledAmber], [0.0, 1.39, ledAmber], [0.05, 1.39, ledCyan], [-0.05, 1.33, ledAmber]].forEach(([x, y, m]) => {
    const led = new THREE.Mesh(track(new THREE.BoxGeometry(0.022, 0.014, 0.012)), m as THREE.Material);
    led.position.set(x as number, y as number, 0.397);
    body.add(led);
  });
  body.add(hose([new THREE.Vector3(-0.22, 1.2, 0.3), new THREE.Vector3(-0.3, 1.1, 0.12), new THREE.Vector3(-0.22, 1.08, -0.12)], 0.022, fabricDark));
  body.add(hose([new THREE.Vector3(0.22, 1.2, 0.3), new THREE.Vector3(0.31, 1.12, 0.1), new THREE.Vector3(0.2, 1.1, -0.14)], 0.022, fabricDark));

  // Casco
  const neck = new THREE.Mesh(track(new THREE.TorusGeometry(0.15, 0.028, 12, 40)), metal);
  neck.rotation.x = Math.PI / 2;
  neck.position.set(0, 1.63, 0);
  const helmet = new THREE.Mesh(track(new THREE.SphereGeometry(0.25, 48, 32)), shell);
  helmet.position.set(0, 1.87, 0.01);
  const visorMesh = new THREE.Mesh(track(new THREE.SphereGeometry(0.254, 48, 32, Math.PI * 1.12, Math.PI * 0.76, Math.PI * 0.26, Math.PI * 0.42)), visor);
  visorMesh.position.copy(helmet.position);
  const visorRim = new THREE.Mesh(track(new THREE.TorusGeometry(0.238, 0.013, 8, 48, Math.PI * 1.1)), metal);
  visorRim.position.set(0, 1.9, -0.035);
  visorRim.rotation.set(0.15, 0, Math.PI * 0.95);
  body.add(neck, helmet, visorMesh, visorRim);

  // Brazos (relajados, ligeramente abiertos)
  for (const side of [-1, 1]) {
    const shoulder = new THREE.Mesh(track(new THREE.SphereGeometry(0.12, 24, 16)), fabric);
    shoulder.position.set(0.3 * side, 1.5, 0.02);
    const upper = capsule(0.08, 0.26, fabric);
    upper.position.set(0.35 * side, 1.3, 0.02);
    upper.rotation.z = 0.18 * side;
    const elbow = new THREE.Mesh(track(new THREE.TorusGeometry(0.075, 0.018, 8, 24)), fabricDark);
    elbow.position.set(0.39 * side, 1.12, 0.02);
    elbow.rotation.x = Math.PI / 2;
    const lower = capsule(0.072, 0.24, fabric);
    lower.position.set(0.4 * side, 0.94, -0.03);
    lower.rotation.set(0.25, 0, 0.08 * side);
    const glove = new THREE.Mesh(track(new THREE.SphereGeometry(0.075, 16, 12)), fabricDark);
    glove.scale.set(0.9, 1.2, 0.8);
    glove.position.set(0.41 * side, 0.77, -0.09);
    body.add(shoulder, upper, elbow, lower, glove);
  }
  // Parche del hombro izquierdo (ámbar y cian, colores de T-PENTAGRON)
  const patch = new THREE.Mesh(track(new THREE.CircleGeometry(0.06, 24)), track(new THREE.MeshStandardMaterial({ color: '#c8572b', roughness: 0.6, emissive: '#3a1408', emissiveIntensity: 0.4 })));
  patch.position.set(-0.36, 1.48, 0.08);
  patch.rotation.y = -0.6;
  body.add(patch);

  // Piernas (el encuadre corta a la altura de las rodillas)
  for (const side of [-1, 1]) {
    const thigh = capsule(0.11, 0.34, fabric);
    thigh.position.set(0.13 * side, 0.6, 0);
    const knee = new THREE.Mesh(track(new THREE.TorusGeometry(0.1, 0.02, 8, 24)), fabricDark);
    knee.rotation.x = Math.PI / 2;
    knee.position.set(0.13 * side, 0.36, 0);
    const shin = capsule(0.1, 0.32, fabric);
    shin.position.set(0.13 * side, 0.14, -0.02);
    body.add(thigh, knee, shin);
  }

  /* Cabina: pared con escotilla circular */
  const cabin = new THREE.Group();
  group.add(cabin);
  const WIN_R = 2.0;
  const wallMat = track(new THREE.MeshStandardMaterial({ color: '#18202c', roughness: 0.88, metalness: 0.12 }));
  const wall = new THREE.Mesh(track(new THREE.RingGeometry(WIN_R + 0.2, 40, 128, 1)), wallMat);
  cabin.add(wall);
  const frame = new THREE.Mesh(track(new THREE.TorusGeometry(WIN_R + 0.08, 0.14, 24, 160)), metal);
  const inner = new THREE.Mesh(track(new THREE.TorusGeometry(WIN_R - 0.03, 0.045, 12, 160)), track(new THREE.MeshStandardMaterial({ color: '#4b5462', roughness: 0.45, metalness: 0.8 })));
  inner.position.z = -0.12;
  cabin.add(frame, inner);
  const boltGeo = track(new THREE.CylinderGeometry(0.035, 0.035, 0.06, 10));
  for (let i = 0; i < 28; i++) {
    const a = (i / 28) * Math.PI * 2;
    const b = new THREE.Mesh(boltGeo, metal);
    b.rotation.x = Math.PI / 2;
    b.position.set(Math.cos(a) * (WIN_R + 0.34), Math.sin(a) * (WIN_R + 0.34), 0.03);
    cabin.add(b);
  }
  for (const side of [-1, 1]) {
    const handle = hose([new THREE.Vector3(side * 2.45, -0.5, 0.05), new THREE.Vector3(side * 2.7, -0.3, 0.22), new THREE.Vector3(side * 2.7, 0.3, 0.22), new THREE.Vector3(side * 2.45, 0.5, 0.05)], 0.035, metal);
    cabin.add(handle);
  }
  const lamp = new THREE.Mesh(track(new THREE.SphereGeometry(0.06, 16, 12)), track(new THREE.MeshBasicMaterial({ color: new THREE.Color('#ffb15a').multiplyScalar(2.5), toneMapped: false })));
  lamp.position.set(3.1, -0.7, 0.35);
  const lampHousing = new THREE.Mesh(track(new THREE.TorusGeometry(0.1, 0.03, 10, 28)), metal);
  lampHousing.position.copy(lamp.position);
  const lampPlate = new THREE.Mesh(track(new THREE.BoxGeometry(0.42, 0.26, 0.04)), track(new THREE.MeshStandardMaterial({ color: '#1a202b', roughness: 0.7, metalness: 0.5 })));
  lampPlate.position.set(3.1, -0.7, 0.3);
  cabin.add(lamp, lampHousing, lampPlate);

  /* Luces de la escena */
  const lights = new THREE.Group();
  const rim = new THREE.DirectionalLight('#9fc8ff', 2.4);
  rim.position.set(0.4, 0.6, -6);
  rim.target.position.set(0, -0.2, 1.8);
  const rim2 = new THREE.DirectionalLight('#6f9cff', 1.0);
  rim2.position.set(-2.5, 1.8, -4);
  rim2.target.position.set(0, -0.2, 1.8);
  const warm = new THREE.PointLight('#ffb15a', 16, 12, 2);
  warm.position.set(3.0, -0.6, 0.9);
  // Relleno suave desde detrás de la cámara: el traje se lee sin perder el contraluz.
  const key = new THREE.DirectionalLight('#d6deea', 0.42);
  key.position.set(-1.4, 2.4, 8);
  key.target.position.set(0, -0.4, 1.7);
  const fill = new THREE.HemisphereLight('#2c3c58', '#07090e', 0.5);
  lights.add(rim, rim.target, rim2, rim2.target, warm, key, key.target, fill);
  group.add(lights);

  function update(t: number) {
    // Flotación suave en microgravedad.
    body.position.y = Math.sin(t * 0.55) * 0.035;
    body.position.x = Math.sin(t * 0.31) * 0.015;
    body.rotation.z = Math.sin(t * 0.42) * 0.018;
    body.rotation.y = Math.sin(t * 0.27) * 0.03;
    ledAmber.color.setRGB(2.2 * (0.75 + 0.25 * Math.sin(t * 3.1)), 1.25, 0.35);
  }

  return {
    group,
    lights,
    update,
    dispose: () => {
      group.traverse((o) => (o as THREE.Mesh).geometry?.dispose());
      disposables.forEach((d) => d.dispose());
    },
  };
}
