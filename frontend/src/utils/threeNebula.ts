import * as THREE from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";

/**
 * Recursively disposes Three.js geometries, materials, and textures inside a group/scene
 * to prevent WebGL resource leaks on topology switches or component unmounts.
 */
export function disposeObjectTree(group: THREE.Object3D): void {
  group.traverse((obj) => {
    if (
      obj instanceof THREE.Mesh ||
      obj instanceof THREE.Line ||
      obj instanceof THREE.LineSegments ||
      obj instanceof THREE.Points
    ) {
      obj.geometry?.dispose();
      const mat = obj.material;
      if (Array.isArray(mat)) {
        mat.forEach((m) => m.dispose());
      } else {
        mat?.dispose();
      }
    }
  });
}

/**
 * Generates an in-memory HDR studio reflection environment via RoomEnvironment + PMREM
 * and configures ACES Filmic tone mapping so smoked glass and brushed metals reflect realistically.
 */
export function setupStudioEnvironment(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene
): THREE.WebGLRenderTarget {
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.12;

  const pmrem = new THREE.PMREMGenerator(renderer);
  pmrem.compileEquirectangularShader();
  const roomEnv = new RoomEnvironment();
  const envRenderTarget = pmrem.fromScene(roomEnv, 0.04);
  scene.environment = envRenderTarget.texture;
  scene.environmentIntensity = 0.88;

  roomEnv.dispose();
  pmrem.dispose();
  return envRenderTarget;
}

/**
 * Adds SystemCraft's calibrated 3-point studio lighting rig alongside the IBL reflection cubemap.
 */
export function addStudioLighting(scene: THREE.Scene): void {
  const hemi = new THREE.HemisphereLight(0xdbeafe, 0x090d1f, 0.55);
  scene.add(hemi);

  const keyLight = new THREE.DirectionalLight(0xe0f2fe, 2.3);
  keyLight.position.set(7, 12, 9);
  scene.add(keyLight);

  const rimLight = new THREE.PointLight(0x818cf8, 2.8, 28);
  rimLight.position.set(-8, 5, -6);
  scene.add(rimLight);

  const cyanAccent = new THREE.PointLight(0x38bdf8, 2.1, 22);
  cyanAccent.position.set(6, 2, -5);
  scene.add(cyanAccent);
}

/**
 * Creates a smooth sky-dome gradient shader inside the scene so EffectComposer + UnrealBloomPass
 * renders cleanly across both Obsidian Dark and Opal Mist Light themes without alpha-black artifacts.
 */
export function createBackdropDome(scene: THREE.Scene): THREE.ShaderMaterial {
  const geo = new THREE.SphereGeometry(48, 28, 18);
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: {
      uLightMode: { value: 0 },
      uChaos: { value: 0 },
    },
    vertexShader: `
      varying vec3 vWorldPos;
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWorldPos = wp.xyz;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }
    `,
    fragmentShader: `
      uniform float uLightMode;
      uniform float uChaos;
      varying vec3 vWorldPos;

      void main() {
        float h = clamp(normalize(vWorldPos).y * 0.5 + 0.5, 0.0, 1.0);
        vec3 darkZenith = vec3(0.012, 0.018, 0.045);
        vec3 darkHorizon = mix(vec3(0.042, 0.082, 0.195), vec3(0.14, 0.035, 0.075), uChaos * 0.45);
        vec3 lightZenith = vec3(0.92, 0.945, 0.995);
        vec3 lightHorizon = vec3(0.80, 0.865, 0.985);

        vec3 darkCol = mix(darkZenith, darkHorizon, smoothstep(0.15, 0.58, 1.0 - abs(h - 0.45) * 2.0));
        vec3 lightCol = mix(lightHorizon, lightZenith, smoothstep(0.25, 0.85, h));
        gl_FragColor = vec4(mix(darkCol, lightCol, uLightMode), 1.0);
      }
    `,
  });
  scene.add(new THREE.Mesh(geo, mat));
  return mat;
}

/**
 * Creates an anti-aliased obsidian telemetry deck with horizon fade, precision coordinate grid,
 * and concentric radar reticles beneath the 3D hardware stage.
 */
export function createSpatialFloorDeck(
  scene: THREE.Scene,
  y = -0.46,
  radius = 10.5
): THREE.ShaderMaterial {
  const size = radius * 2.2;
  const geo = new THREE.PlaneGeometry(size, size, 1, 1);
  geo.rotateX(-Math.PI / 2);

  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: {
      uTime: { value: 0 },
      uLightMode: { value: 0 },
      uChaos: { value: 0 },
      uRadius: { value: radius },
    },
    vertexShader: `
      varying vec2 vWorldXZ;
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWorldXZ = wp.xz;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }
    `,
    fragmentShader: `
      uniform float uTime;
      uniform float uLightMode;
      uniform float uChaos;
      uniform float uRadius;
      varying vec2 vWorldXZ;

      float gridFactor(vec2 coord, float stepSize, float thickness) {
        vec2 p = coord / stepSize;
        vec2 grid = abs(fract(p - 0.5) - 0.5) / (fwidth(p) + 0.0001);
        float line = min(grid.x, grid.y);
        return 1.0 - min(line / thickness, 1.0);
      }

      void main() {
        float dist = length(vWorldXZ);
        float radialFade = 1.0 - smoothstep(uRadius * 0.42, uRadius, dist);
        if (radialFade <= 0.002) discard;

        float fineGrid = gridFactor(vWorldXZ, 1.0, 1.15);
        float majorGrid = gridFactor(vWorldXZ, 4.0, 1.5);

        float r1 = smoothstep(0.035, 0.0, abs(dist - 2.65));
        float r2 = smoothstep(0.038, 0.0, abs(dist - 5.2));
        float r3 = smoothstep(0.042, 0.0, abs(dist - 7.8));
        float ringMask = clamp(r1 + r2 + r3, 0.0, 1.0);

        // Subtle sweeping radar pulse across the floor rings
        float pulse = 0.5 + 0.5 * sin(dist * 1.4 - uTime * 1.8);
        vec3 baseDeck = mix(vec3(0.025, 0.042, 0.095), vec3(0.78, 0.84, 0.96), uLightMode);
        vec3 lineAccent = mix(
          vec3(0.22, 0.74, 0.97),
          vec3(0.24, 0.22, 0.78),
          uLightMode
        );
        lineAccent = mix(lineAccent, vec3(0.95, 0.25, 0.37), uChaos * 0.65);

        float lineEnergy = fineGrid * (0.14 + uLightMode * 0.1) + majorGrid * (0.24 + uLightMode * 0.14) + ringMask * (0.3 + pulse * 0.18);
        vec3 col = mix(baseDeck, lineAccent, clamp(lineEnergy * 1.4, 0.0, 1.0));
        float baseAlpha = mix(0.56, 0.44, uLightMode);
        float alpha = clamp((baseAlpha + lineEnergy * 0.48) * radialFade, 0.0, 0.92);
        gl_FragColor = vec4(col, alpha);
      }
    `,
  });

  const deck = new THREE.Mesh(geo, mat);
  deck.position.y = y;
  scene.add(deck);
  return mat;
}

/**
 * Generates a soft Gaussian circular glow sprite texture so WebGL PointsMaterial
 * particles render as luminous bokeh light orbs instead of hard pixels/squares.
 */
export function createRadialGlowTexture(): THREE.CanvasTexture {
  const size = 64;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    const half = size / 2;
    const grad = ctx.createRadialGradient(half, half, 0, half, half, half);
    grad.addColorStop(0.0, "rgba(255, 255, 255, 1.0)");
    grad.addColorStop(0.24, "rgba(220, 245, 255, 0.85)");
    grad.addColorStop(0.55, "rgba(56, 189, 248, 0.28)");
    grad.addColorStop(1.0, "rgba(56, 189, 248, 0.0)");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, size, size);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.needsUpdate = true;
  return tex;
}

/**
 * Generates a soft radial ambient-occlusion disc texture for grounding 3D hardware rigs.
 */
export function createContactShadowTexture(): THREE.CanvasTexture {
  const size = 64;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    const half = size / 2;
    const grad = ctx.createRadialGradient(half, half, 2, half, half, half);
    grad.addColorStop(0.0, "rgba(2, 6, 20, 0.72)");
    grad.addColorStop(0.5, "rgba(2, 6, 20, 0.34)");
    grad.addColorStop(1.0, "rgba(2, 6, 20, 0.0)");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, size, size);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.needsUpdate = true;
  return tex;
}

/**
 * GLSL shader material for curved fiber-optic conduits featuring directional glowing energy pulses.
 */
export function createOpticalConduitMaterial(
  colorHex: string,
  baseOpacity = 0.38
): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: {
      uTime: { value: 0 },
      uSpeed: { value: 0.75 },
      uColor: { value: new THREE.Color(colorHex) },
      uOpacity: { value: baseOpacity },
      uActive: { value: 0 },
    },
    vertexShader: `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform float uTime;
      uniform float uSpeed;
      uniform vec3 uColor;
      uniform float uOpacity;
      uniform float uActive;
      varying vec2 vUv;

      void main() {
        float wave = pow(0.5 + 0.5 * sin((vUv.x * 16.0) - uTime * uSpeed * 4.2), 3.0);
        float coreBoost = 1.0 + uActive * 1.35 + wave * (0.65 + uActive * 1.1);
        vec3 col = uColor * coreBoost;
        float alpha = clamp(uOpacity + wave * (0.28 + uActive * 0.42), 0.08, 0.96);
        gl_FragColor = vec4(col, alpha);
      }
    `,
  });
}

export interface StudioComposerHandle {
  composer: EffectComposer;
  bloomPass: UnrealBloomPass;
  renderTarget: THREE.WebGLRenderTarget;
  dispose: () => void;
}

/**
 * Creates a selectively bloomed ACES post-processing pipeline with MSAA WebGL2 target when supported.
 */
export function createPostProcessingPipeline(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.PerspectiveCamera,
  width: number,
  height: number
): StudioComposerHandle | null {
  try {
    const safeW = Math.max(2, width);
    const safeH = Math.max(2, height);
    const renderTarget = new THREE.WebGLRenderTarget(safeW, safeH, {
      type: THREE.HalfFloatType,
      samples: renderer.capabilities.isWebGL2 ? 4 : 0,
    });
    const composer = new EffectComposer(renderer, renderTarget);
    composer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    composer.setSize(safeW, safeH);

    const renderPass = new RenderPass(scene, camera);
    composer.addPass(renderPass);

    const bloomPass = new UnrealBloomPass(
      new THREE.Vector2(safeW, safeH),
      0.42, // restrained selective glow so hardware bevels stay crisp
      0.42,
      0.86  // high threshold so only LEDs, conduits & bokeh particles bloom
    );
    composer.addPass(bloomPass);

    const outputPass = new OutputPass();
    composer.addPass(outputPass);

    return {
      composer,
      bloomPass,
      renderTarget,
      dispose: () => {
        composer.dispose();
        renderTarget.dispose();
      },
    };
  } catch {
    return null;
  }
}

/**
 * Builds the GPU-accelerated cursor-reactive GLSL nebula star particle galaxy.
 */
export function createNebulaGalaxy(scene: THREE.Scene, galaxyCount = 1200): THREE.ShaderMaterial {
  const gPositions = new Float32Array(galaxyCount * 3);
  const gColors = new Float32Array(galaxyCount * 3);
  const gScales = new Float32Array(galaxyCount);
  const palette = [
    new THREE.Color("#38bdf8"),
    new THREE.Color("#818cf8"),
    new THREE.Color("#c084fc"),
    new THREE.Color("#e879f9"),
  ];

  for (let i = 0; i < galaxyCount; i++) {
    const r = 3.5 + Math.pow(Math.random(), 0.78) * 15.0;
    const angle = r * 0.65 + (i % 3) * ((Math.PI * 2) / 3) + (Math.random() - 0.5) * 1.4;
    gPositions[i * 3] = Math.cos(angle) * r;
    gPositions[i * 3 + 1] = (Math.random() - 0.5) * 6.5;
    gPositions[i * 3 + 2] = Math.sin(angle) * r - 1.5;
    gScales[i] = 0.45 + Math.random() * 1.7;

    const c = palette[i % palette.length];
    gColors[i * 3] = c.r;
    gColors[i * 3 + 1] = c.g;
    gColors[i * 3 + 2] = c.b;
  }

  const galaxyGeo = new THREE.BufferGeometry();
  galaxyGeo.setAttribute("position", new THREE.BufferAttribute(gPositions, 3));
  galaxyGeo.setAttribute("aColor", new THREE.BufferAttribute(gColors, 3));
  galaxyGeo.setAttribute("aScale", new THREE.BufferAttribute(gScales, 1));

  const galaxyMat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: {
      uTime: { value: 0 },
      uMouse: { value: new THREE.Vector2(0, 0) },
      uChaos: { value: 0 },
      uOpacity: { value: 0.78 },
    },
    vertexShader: `
      uniform float uTime;
      uniform vec2 uMouse;
      uniform float uChaos;
      attribute vec3 aColor;
      attribute float aScale;
      varying vec3 vColor;
      varying float vAlpha;

      void main() {
        vColor = mix(aColor, vec3(0.96, 0.25, 0.37), uChaos * 0.55);
        vec3 pos = position;
        float angle = uTime * (0.04 + uChaos * 0.035);
        float s = sin(angle);
        float c = cos(angle);
        pos.xz = mat2(c, -s, s, c) * pos.xz;
        pos.y += sin(uTime * 0.55 + pos.x * 0.45) * 0.2;

        vec2 delta = pos.xy - uMouse * 4.5;
        float d = length(delta);
        if (d < 3.4) {
          pos.xy += normalize(delta + 0.0001) * (3.4 - d) * 0.2;
        }

        vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        gl_PointSize = clamp((aScale * 40.0) / -mvPosition.z, 1.5, 8.5);
        vAlpha = smoothstep(-28.0, -3.5, mvPosition.z);
      }
    `,
    fragmentShader: `
      uniform float uOpacity;
      varying vec3 vColor;
      varying float vAlpha;

      void main() {
        vec2 uv = gl_PointCoord - vec2(0.5);
        float dist = length(uv);
        if (dist > 0.5) discard;
        float glow = pow(1.0 - dist * 2.0, 2.0);
        gl_FragColor = vec4(vColor, glow * uOpacity * vAlpha);
      }
    `,
  });

  scene.add(new THREE.Points(galaxyGeo, galaxyMat));
  return galaxyMat;
}

/**
 * Adds faint rotating neural filament lines behind the crystal stage for spatial depth.
 */
export function createAmbientConstellation(scene: THREE.Scene): {
  lines: THREE.LineSegments;
  material: THREE.LineBasicMaterial;
} {
  const lineVerts: number[] = [];
  const anchors: THREE.Vector3[] = [];
  for (let i = 0; i < 42; i++) {
    const a = (i / 42) * Math.PI * 4;
    const rad = 6.2 + (i % 5) * 1.4;
    anchors.push(new THREE.Vector3(Math.cos(a) * rad, ((i % 7) - 3) * 0.9, Math.sin(a) * rad - 2));
  }
  for (let i = 0; i < anchors.length; i++) {
    for (let j = i + 1; j < anchors.length; j++) {
      if (anchors[i].distanceTo(anchors[j]) < 4.6) {
        lineVerts.push(anchors[i].x, anchors[i].y, anchors[i].z, anchors[j].x, anchors[j].y, anchors[j].z);
      }
    }
  }
  const ambientGeo = new THREE.BufferGeometry();
  ambientGeo.setAttribute("position", new THREE.Float32BufferAttribute(lineVerts, 3));
  const ambientMat = new THREE.LineBasicMaterial({
    color: 0x6366f1,
    transparent: true,
    opacity: 0.08,
  });
  const ambientConstellation = new THREE.LineSegments(ambientGeo, ambientMat);
  scene.add(ambientConstellation);
  return { lines: ambientConstellation, material: ambientMat };
}
