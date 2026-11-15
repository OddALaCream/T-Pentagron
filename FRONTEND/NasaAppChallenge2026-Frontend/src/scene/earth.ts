/**
 * Material cinematográfico de la Tierra (GLSL): mezcla día/noche con terminador cálido,
 * reflejo especular en océanos, relieve a partir de topografía y dispersión atmosférica
 * en el borde. Se usa tanto en el observatorio (react-globe.gl) como en la introducción.
 */
import * as THREE from 'three';
import type { Quality } from '@/state/store';
import { earthTextureUrls, loadTexture } from './textures';

const vertex = /* glsl */ `
varying vec2 vUv;
varying vec3 vNormalW;
varying vec3 vPosW;
void main() {
  vUv = uv;
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vPosW = wp.xyz;
  vNormalW = normalize(mat3(modelMatrix) * normal);
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const fragment = /* glsl */ `
uniform sampler2D dayMap;
uniform sampler2D nightMap;
uniform sampler2D waterMap;
uniform sampler2D topoMap;
uniform vec3 sunDir;
uniform float bumpStrength;
uniform float nightIntensity;
uniform float exposure;
uniform vec2 topoTexel;
varying vec2 vUv;
varying vec3 vNormalW;
varying vec3 vPosW;

void main() {
  vec3 N = normalize(vNormalW);
  #ifdef USE_RELIEF
    float h = texture2D(topoMap, vUv).r;
    float hx = texture2D(topoMap, vUv + vec2(topoTexel.x, 0.0)).r;
    float hy = texture2D(topoMap, vUv + vec2(0.0, topoTexel.y)).r;
    vec3 T = normalize(cross(vec3(0.0, 1.0, 0.0), N) + vec3(1e-5));
    vec3 B = normalize(cross(N, T));
    N = normalize(N - bumpStrength * ((hx - h) * T + (hy - h) * B));
  #endif
  vec3 V = normalize(cameraPosition - vPosW);
  vec3 L = normalize(sunDir);
  float NdotL = dot(N, L);
  float dayMix = smoothstep(-0.16, 0.24, NdotL);

  vec3 day = texture2D(dayMap, vUv).rgb;
  vec3 night = texture2D(nightMap, vUv).rgb;
  float water = texture2D(waterMap, vUv).r;

  float diffuse = clamp(NdotL, 0.0, 1.0);
  vec3 color = day * (0.035 + 1.12 * pow(diffuse, 0.8));

  // Terminador: banda cálida de dispersión.
  float terminator = smoothstep(-0.14, 0.04, NdotL) * (1.0 - smoothstep(0.04, 0.32, NdotL));
  color += day * vec3(0.55, 0.22, 0.06) * terminator * 0.45;

  // Océanos: especular nítido + brillo amplio.
  vec3 H = normalize(L + V);
  float NdotH = max(dot(N, H), 0.0);
  float spec = (pow(NdotH, 70.0) * 0.85 + pow(NdotH, 9.0) * 0.05) * water;
  color += vec3(0.86, 0.92, 1.0) * spec * smoothstep(0.0, 0.18, NdotL);
  color = mix(color, color * vec3(0.82, 0.9, 1.05), water * 0.35);

  // Luces nocturnas.
  vec3 lights = pow(night, vec3(1.55)) * vec3(1.0, 0.78, 0.48) * nightIntensity;
  color = mix(lights + day * 0.012, color, dayMix);

  // Dispersión atmosférica en el limbo (más intensa en el lado iluminado).
  float fresnel = pow(1.0 - max(dot(normalize(vNormalW), V), 0.0), 3.2);
  color += vec3(0.28, 0.52, 1.0) * fresnel * (0.12 + 0.88 * smoothstep(-0.25, 0.6, NdotL)) * 0.62;

  gl_FragColor = vec4(color * exposure, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

export interface EarthMaterialHandle {
  material: THREE.ShaderMaterial;
  ready: Promise<void>;
  setSun: (dir: THREE.Vector3) => void;
  dispose: () => void;
}

export function createEarthMaterial(quality: Quality): EarthMaterialHandle {
  const urls = earthTextureUrls(quality);
  const blank = new THREE.DataTexture(new Uint8Array([8, 12, 22, 255]), 1, 1);
  blank.needsUpdate = true;
  const material = new THREE.ShaderMaterial({
    uniforms: {
      dayMap: { value: blank },
      nightMap: { value: blank },
      waterMap: { value: blank },
      topoMap: { value: blank },
      sunDir: { value: new THREE.Vector3(-0.6, 0.35, 0.75).normalize() },
      bumpStrength: { value: 2.2 },
      nightIntensity: { value: 1.25 },
      exposure: { value: 1.0 },
      topoTexel: { value: new THREE.Vector2(1 / 2048, 1 / 1024) },
    },
    vertexShader: vertex,
    fragmentShader: fragment,
    defines: quality === 'low' ? {} : { USE_RELIEF: '' },
  });
  const ready = Promise.all([
    loadTexture(urls.day),
    loadTexture(urls.night),
    loadTexture(urls.water, false),
    quality === 'low' ? Promise.resolve(blank) : loadTexture(urls.topo, false),
  ]).then(([day, night, water, topo]) => {
    material.uniforms.dayMap.value = day;
    material.uniforms.nightMap.value = night;
    material.uniforms.waterMap.value = water;
    material.uniforms.topoMap.value = topo;
    material.needsUpdate = true;
  });
  return {
    material,
    ready,
    setSun: (dir) => material.uniforms.sunDir.value.copy(dir).normalize(),
    dispose: () => {
      material.dispose();
      blank.dispose();
    },
  };
}

/* ------------------------------------------------------------------ */
/* Nubes                                                              */
/* ------------------------------------------------------------------ */
const cloudFragment = /* glsl */ `
uniform sampler2D cloudMap;
uniform vec3 sunDir;
uniform float opacity;
varying vec2 vUv;
varying vec3 vNormalW;
varying vec3 vPosW;
void main() {
  float c = texture2D(cloudMap, vUv).r;
  vec3 N = normalize(vNormalW);
  float NdotL = dot(N, normalize(sunDir));
  float lit = smoothstep(-0.12, 0.35, NdotL);
  vec3 V = normalize(cameraPosition - vPosW);
  float rim = pow(1.0 - max(dot(N, V), 0.0), 2.0);
  vec3 color = mix(vec3(0.05, 0.07, 0.11), vec3(1.0, 0.98, 0.95), lit);
  color += vec3(1.0, 0.55, 0.25) * smoothstep(-0.08, 0.05, NdotL) * (1.0 - smoothstep(0.05, 0.25, NdotL)) * 0.35;
  float alpha = c * opacity * (0.35 + 0.65 * lit) * (1.0 - rim * 0.55);
  gl_FragColor = vec4(color, alpha);
  #include <colorspace_fragment>
}
`;

export interface CloudLayer {
  mesh: THREE.Mesh;
  setSun: (dir: THREE.Vector3) => void;
  setOpacity: (o: number) => void;
  update: (dt: number) => void;
  dispose: () => void;
}

export function createClouds(radius: number, quality: Quality): CloudLayer {
  const geometry = new THREE.SphereGeometry(radius, quality === 'high' ? 96 : 64, quality === 'high' ? 64 : 40);
  const material = new THREE.ShaderMaterial({
    uniforms: {
      cloudMap: { value: null },
      sunDir: { value: new THREE.Vector3(-0.6, 0.35, 0.75).normalize() },
      opacity: { value: 0 },
    },
    vertexShader: vertex,
    fragmentShader: cloudFragment,
    transparent: true,
    depthWrite: false,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.rotation.y = -Math.PI / 2; // misma orientación UV que la esfera de three-globe
  mesh.renderOrder = 1;
  mesh.visible = false;
  let target = 0.62;
  loadTexture(earthTextureUrls(quality).clouds, false)
    .then((tex) => {
      material.uniforms.cloudMap.value = tex;
      mesh.visible = true;
    })
    .catch(() => {
      mesh.visible = false;
    });
  return {
    mesh,
    setSun: (dir) => material.uniforms.sunDir.value.copy(dir).normalize(),
    setOpacity: (o) => {
      target = o;
    },
    update: (dt) => {
      mesh.rotation.y += dt * 0.0035;
      const u = material.uniforms.opacity;
      u.value += (target - u.value) * Math.min(1, dt * 2.5);
    },
    dispose: () => {
      geometry.dispose();
      material.dispose();
    },
  };
}

/* ------------------------------------------------------------------ */
/* Halo atmosférico (para la intro; el observatorio usa el de globe.gl) */
/* ------------------------------------------------------------------ */
export function createAtmosphere(radius: number, color = new THREE.Color('#79b4ff')): THREE.Mesh {
  const material = new THREE.ShaderMaterial({
    uniforms: { glowColor: { value: color }, intensity: { value: 1 } },
    vertexShader: /* glsl */ `
      varying vec3 vNormal;
      varying vec3 vView;
      void main() {
        vNormal = normalize(normalMatrix * normal);
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vView = normalize(-mv.xyz);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 glowColor;
      uniform float intensity;
      varying vec3 vNormal;
      varying vec3 vView;
      void main() {
        // Caras traseras de la cáscara: -dot crece desde el borde exterior (0) hacia el
        // limbo terrestre, así el halo se desvanece hacia fuera sin borde duro.
        float k = clamp(-dot(normalize(vNormal), normalize(vView)), 0.0, 1.0);
        float glow = smoothstep(0.0, 0.55, k);
        gl_FragColor = vec4(glowColor * glow * glow * intensity * 0.5, 1.0);
      }`,
    side: THREE.BackSide,
    blending: THREE.AdditiveBlending,
    transparent: true,
    depthWrite: false,
  });
  return new THREE.Mesh(new THREE.SphereGeometry(radius * 1.12, 64, 48), material);
}
