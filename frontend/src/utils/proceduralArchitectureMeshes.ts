import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import type { LessonNode } from "../types/hld";

export interface HardwareRigInstance {
  root: THREE.Group;
  hitMeshes: THREE.Object3D[];
  chassisMaterials: THREE.MeshStandardMaterial[];
  trimMaterials: THREE.MeshStandardMaterial[];
  glassMaterials: THREE.MeshPhysicalMaterial[];
  emissiveMaterials: THREE.MeshStandardMaterial[];
  pulseSegments: Array<{ mesh: THREE.Mesh; mat: THREE.MeshStandardMaterial }>;
  rotors: Array<{ obj: THREE.Object3D; axis: "x" | "y" | "z"; speed: number }>;
  floatables: Array<{ obj: THREE.Object3D; baseY: number; amp: number; phase: number }>;
  haloRing: THREE.Mesh;
  shockRing: THREE.Mesh;
  basePos: THREE.Vector3;
  baseAccentHex: string;
}

interface PaletteConfig {
  chassisDark: number;
  chassisLight: number;
  trimDark: number;
  trimLight: number;
  glassDark: number;
  glassLight: number;
  accentHex: string;
}

function defaultPalette(accentHex: string): PaletteConfig {
  return {
    chassisDark: 0x131a2b,
    chassisLight: 0xdbe3f3,
    trimDark: 0x64748b,
    trimLight: 0x475569,
    glassDark: 0x0b1c3d,
    glassLight: 0xc7d9fc,
    accentHex,
  };
}

function createMaterials(pal: PaletteConfig) {
  const chassisMat = new THREE.MeshStandardMaterial({
    color: pal.chassisDark,
    metalness: 0.86,
    roughness: 0.24,
    envMapIntensity: 1.25,
  });
  const trimMat = new THREE.MeshStandardMaterial({
    color: pal.trimDark,
    metalness: 0.94,
    roughness: 0.14,
    envMapIntensity: 1.4,
  });
  const glassMat = new THREE.MeshPhysicalMaterial({
    color: pal.glassDark,
    roughness: 0.08,
    metalness: 0.06,
    clearcoat: 1.0,
    clearcoatRoughness: 0.06,
    transmission: 0.38,
    transparent: true,
    opacity: 0.86,
    ior: 1.52,
    thickness: 0.45,
    envMapIntensity: 1.5,
  });
  const glowMat = new THREE.MeshStandardMaterial({
    color: pal.accentHex,
    emissive: pal.accentHex,
    emissiveIntensity: 1.45,
    roughness: 0.18,
    metalness: 0.15,
  });

  return { chassisMat, trimMat, glassMat, glowMat };
}

function tagNodeId(obj: THREE.Object3D, nodeId: string, hitMeshes: THREE.Object3D[]) {
  obj.userData = { nodeId };
  hitMeshes.push(obj);
}

/**
 * Builds a precision multi-part PBR 3D hardware rig tailored to each System Design component kind.
 */
export function buildHardwareRig(
  nodeId: string,
  kind: LessonNode["kind"],
  basePos: THREE.Vector3,
  shadowTexture: THREE.Texture
): HardwareRigInstance {
  const root = new THREE.Group();
  root.position.copy(basePos);
  root.userData = { nodeId };

  const accentMap: Record<LessonNode["kind"], string> = {
    client: "#38bdf8",
    dns: "#38bdf8",
    cdn: "#06b6d4",
    load_balancer: "#38bdf8",
    api_gateway: "#818cf8",
    compute: "#38bdf8",
    cache: "#34d399",
    db_sql: "#38bdf8",
    db_nosql: "#a855f7",
    object_store: "#60a5fa",
    queue: "#818cf8",
    search_index: "#22d3ee",
    vector_db: "#e879f9",
    gpu_cluster: "#f472b6",
    external: "#94a3b8",
  };

  const accentHex = accentMap[kind] ?? "#38bdf8";
  const pal = defaultPalette(accentHex);
  const { chassisMat, trimMat, glassMat, glowMat } = createMaterials(pal);

  const hitMeshes: THREE.Object3D[] = [];
  const chassisMaterials = [chassisMat];
  const trimMaterials = [trimMat];
  const glassMaterials = [glassMat];
  const emissiveMaterials = [glowMat];
  const pulseSegments: Array<{ mesh: THREE.Mesh; mat: THREE.MeshStandardMaterial }> = [];
  const rotors: Array<{ obj: THREE.Object3D; axis: "x" | "y" | "z"; speed: number }> = [];
  const floatables: Array<{ obj: THREE.Object3D; baseY: number; amp: number; phase: number }> = [];

  const body = new THREE.Group();
  root.add(body);

  // Soft Ambient Occlusion shadow disc anchored on the deck below each hardware rig
  const shadowGeo = new THREE.PlaneGeometry(1.75, 1.75);
  shadowGeo.rotateX(-Math.PI / 2);
  const shadowMat = new THREE.MeshBasicMaterial({
    map: shadowTexture,
    transparent: true,
    opacity: 0.72,
    depthWrite: false,
  });
  const shadowDisc = new THREE.Mesh(shadowGeo, shadowMat);
  shadowDisc.position.y = -0.58;
  root.add(shadowDisc);

  // Precision Halo Reticle Ring (status / hover / bottleneck beacon)
  const haloGeo = new THREE.RingGeometry(0.76, 0.84, 48);
  haloGeo.rotateX(-Math.PI / 2);
  const haloMat = new THREE.MeshBasicMaterial({
    color: accentHex,
    transparent: true,
    opacity: 0.28,
    side: THREE.DoubleSide,
  });
  const haloRing = new THREE.Mesh(haloGeo, haloMat);
  haloRing.position.y = -0.55;
  root.add(haloRing);

  // Kinetic shockwave ring emitted on packet absorption
  const shockGeo = new THREE.RingGeometry(0.68, 0.74, 48);
  shockGeo.rotateX(-Math.PI / 2);
  const shockMat = new THREE.MeshBasicMaterial({
    color: accentHex,
    transparent: true,
    opacity: 0,
    side: THREE.DoubleSide,
  });
  const shockRing = new THREE.Mesh(shockGeo, shockMat);
  shockRing.position.y = -0.54;
  root.add(shockRing);

  // Build hardware silhouettes per NodeKind
  if (kind === "load_balancer") {
    // Hexagonal Titanium Turbine Stator + Glass Top + 6 Rotating Rotor Blades
    const stator = new THREE.Mesh(new THREE.CylinderGeometry(0.64, 0.72, 0.24, 6), chassisMat);
    stator.position.y = -0.18;
    tagNodeId(stator, nodeId, hitMeshes);
    body.add(stator);

    const trimRing = new THREE.Mesh(new THREE.TorusGeometry(0.56, 0.045, 12, 6), trimMat);
    trimRing.rotation.x = Math.PI / 2;
    trimRing.rotation.z = Math.PI / 6;
    trimRing.position.y = -0.05;
    body.add(trimRing);

    const turbineGroup = new THREE.Group();
    turbineGroup.position.y = 0.08;
    for (let i = 0; i < 6; i++) {
      const blade = new THREE.Mesh(new RoundedBoxGeometry(0.42, 0.09, 0.12, 2, 0.025), trimMat);
      const a = (i / 6) * Math.PI * 2;
      blade.position.set(Math.cos(a) * 0.22, 0, Math.sin(a) * 0.22);
      blade.rotation.y = -a + 0.42;
      blade.rotation.x = 0.35;
      tagNodeId(blade, nodeId, hitMeshes);
      turbineGroup.add(blade);
    }
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.16, 0.26, 20), glowMat);
    tagNodeId(hub, nodeId, hitMeshes);
    turbineGroup.add(hub);
    body.add(turbineGroup);
    rotors.push({ obj: turbineGroup, axis: "y", speed: 1.45 });

    const dome = new THREE.Mesh(new THREE.CylinderGeometry(0.56, 0.6, 0.3, 6), glassMat);
    dome.position.y = 0.08;
    tagNodeId(dome, nodeId, hitMeshes);
    body.add(dome);
  } else if (kind === "api_gateway") {
    // Sleek Twin-Stanchion Glass Monolith + Internal Optical Inspection Baffles
    const plinth = new THREE.Mesh(new RoundedBoxGeometry(1.06, 0.12, 0.76, 3, 0.04), chassisMat);
    plinth.position.y = -0.34;
    tagNodeId(plinth, nodeId, hitMeshes);
    body.add(plinth);

    [-0.4, 0.4].forEach((x) => {
      const pillar = new THREE.Mesh(new RoundedBoxGeometry(0.14, 0.88, 0.54, 3, 0.04), chassisMat);
      pillar.position.set(x, 0.12, 0);
      tagNodeId(pillar, nodeId, hitMeshes);
      body.add(pillar);
    });

    const coreGlass = new THREE.Mesh(new RoundedBoxGeometry(0.68, 0.78, 0.38, 3, 0.05), glassMat);
    coreGlass.position.y = 0.12;
    tagNodeId(coreGlass, nodeId, hitMeshes);
    body.add(coreGlass);

    for (let i = 0; i < 3; i++) {
      const segMat = glowMat.clone();
      emissiveMaterials.push(segMat);
      const pane = new THREE.Mesh(new RoundedBoxGeometry(0.52, 0.04, 0.24, 2, 0.015), segMat);
      pane.position.set(0, -0.08 + i * 0.2, 0);
      pane.rotation.x = 0.22;
      body.add(pane);
      pulseSegments.push({ mesh: pane, mat: segMat });
    }
  } else if (kind === "compute" || kind === "search_index") {
    // 3U Rackmount Server Blade Tower with Smoked Front Door & Sequential Bay LEDs
    const rack = new THREE.Mesh(new RoundedBoxGeometry(0.98, 0.92, 0.78, 4, 0.06), chassisMat);
    rack.position.y = 0.08;
    tagNodeId(rack, nodeId, hitMeshes);
    body.add(rack);

    const door = new THREE.Mesh(new RoundedBoxGeometry(0.84, 0.78, 0.08, 3, 0.03), glassMat);
    door.position.set(0, 0.08, 0.38);
    tagNodeId(door, nodeId, hitMeshes);
    body.add(door);

    for (let i = 0; i < 3; i++) {
      const sled = new THREE.Mesh(new RoundedBoxGeometry(0.76, 0.18, 0.66, 2, 0.025), trimMat);
      sled.position.set(0, -0.18 + i * 0.26, 0.03);
      body.add(sled);

      const ledMat = glowMat.clone();
      emissiveMaterials.push(ledMat);
      const led = new THREE.Mesh(new RoundedBoxGeometry(0.46, 0.04, 0.04, 2, 0.015), ledMat);
      led.position.set(-0.08, -0.18 + i * 0.26, 0.41);
      body.add(led);
      pulseSegments.push({ mesh: led, mat: ledMat });
    }
  } else if (kind === "db_sql" || kind === "db_nosql" || kind === "object_store") {
    // Precision Stacked Storage Vault Engine with 3 Hovering Spinning Platters
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.68, 0.14, 32), chassisMat);
    base.position.y = -0.34;
    tagNodeId(base, nodeId, hitMeshes);
    body.add(base);

    const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.58, 0.62, 0.12, 32), chassisMat);
    cap.position.y = 0.44;
    tagNodeId(cap, nodeId, hitMeshes);
    body.add(cap);

    // 3 precision structural chrome tie-rods
    for (let r = 0; r < 3; r++) {
      const a = (r / 3) * Math.PI * 2 + 0.4;
      const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.032, 0.032, 0.8, 12), trimMat);
      rod.position.set(Math.cos(a) * 0.56, 0.05, Math.sin(a) * 0.56);
      body.add(rod);
    }

    const platterGroup = new THREE.Group();
    const layers = kind === "object_store" ? 2 : 3;
    for (let p = 0; p < layers; p++) {
      const py = -0.14 + p * (kind === "object_store" ? 0.34 : 0.2);
      const platter = new THREE.Mesh(
        new THREE.CylinderGeometry(0.5, 0.5, kind === "object_store" ? 0.24 : 0.11, 32),
        chassisMat
      );
      platter.position.y = py;
      tagNodeId(platter, nodeId, hitMeshes);
      platterGroup.add(platter);

      const seamMat = glowMat.clone();
      emissiveMaterials.push(seamMat);
      const seam = new THREE.Mesh(new THREE.TorusGeometry(0.49, 0.022, 10, 36), seamMat);
      seam.rotation.x = Math.PI / 2;
      seam.position.y = py + (kind === "object_store" ? 0.13 : 0.065);
      platterGroup.add(seam);
      pulseSegments.push({ mesh: seam, mat: seamMat });
    }
    body.add(platterGroup);
    rotors.push({ obj: platterGroup, axis: "y", speed: 0.48 });

    const shroud = new THREE.Mesh(new THREE.CylinderGeometry(0.58, 0.58, 0.74, 32, 1, true), glassMat);
    shroud.position.y = 0.05;
    tagNodeId(shroud, nodeId, hitMeshes);
    body.add(shroud);
  } else if (kind === "cache") {
    // Open Heatsink Cage Suspending Spinning Faceted DRAM Diamond Core
    const frameBottom = new THREE.Mesh(new RoundedBoxGeometry(0.88, 0.1, 0.88, 3, 0.03), chassisMat);
    frameBottom.position.y = -0.34;
    tagNodeId(frameBottom, nodeId, hitMeshes);
    body.add(frameBottom);

    const frameTop = new THREE.Mesh(new RoundedBoxGeometry(0.84, 0.08, 0.84, 3, 0.03), chassisMat);
    frameTop.position.y = 0.44;
    tagNodeId(frameTop, nodeId, hitMeshes);
    body.add(frameTop);

    [
      [-0.36, -0.36],
      [0.36, -0.36],
      [-0.36, 0.36],
      [0.36, 0.36],
    ].forEach(([cx, cz]) => {
      const fin = new THREE.Mesh(new THREE.CylinderGeometry(0.038, 0.038, 0.78, 12), trimMat);
      fin.position.set(cx, 0.05, cz);
      body.add(fin);
    });

    const core = new THREE.Mesh(new THREE.OctahedronGeometry(0.38, 0), glassMat);
    core.position.y = 0.06;
    tagNodeId(core, nodeId, hitMeshes);
    body.add(core);

    const innerGlow = new THREE.Mesh(new THREE.OctahedronGeometry(0.22, 0), glowMat);
    innerGlow.position.y = 0.06;
    body.add(innerGlow);
    rotors.push({ obj: core, axis: "y", speed: 0.9 });
    rotors.push({ obj: innerGlow, axis: "y", speed: -1.4 });
    floatables.push({ obj: core, baseY: 0.06, amp: 0.04, phase: 0 });
    floatables.push({ obj: innerGlow, baseY: 0.06, amp: 0.04, phase: 0 });
  } else if (kind === "queue") {
    // Partitioned Append-Log Conveyor Bus with 5 Illuminated Ripple Partition Blocks
    const trough = new THREE.Mesh(new RoundedBoxGeometry(1.42, 0.24, 0.66, 3, 0.05), chassisMat);
    trough.position.y = -0.14;
    tagNodeId(trough, nodeId, hitMeshes);
    body.add(trough);

    const glassCover = new THREE.Mesh(new RoundedBoxGeometry(1.36, 0.24, 0.58, 3, 0.06), glassMat);
    glassCover.position.y = 0.1;
    tagNodeId(glassCover, nodeId, hitMeshes);
    body.add(glassCover);

    for (let i = 0; i < 5; i++) {
      const segMat = glowMat.clone();
      emissiveMaterials.push(segMat);
      const cell = new THREE.Mesh(new RoundedBoxGeometry(0.18, 0.14, 0.42, 2, 0.02), segMat);
      cell.position.set(-0.48 + i * 0.24, 0.09, 0);
      tagNodeId(cell, nodeId, hitMeshes);
      body.add(cell);
      pulseSegments.push({ mesh: cell, mat: segMat });
    }
  } else if (kind === "dns" || kind === "cdn") {
    // Geodesic Orbital Relay Dome + Dual Gimbal Telemetry Rings
    const pedestal = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.46, 0.16, 24), chassisMat);
    pedestal.position.y = -0.34;
    tagNodeId(pedestal, nodeId, hitMeshes);
    body.add(pedestal);

    const sphereGlass = new THREE.Mesh(new THREE.IcosahedronGeometry(0.38, 2), glassMat);
    sphereGlass.position.y = 0.12;
    tagNodeId(sphereGlass, nodeId, hitMeshes);
    body.add(sphereGlass);

    const innerOrb = new THREE.Mesh(new THREE.SphereGeometry(0.2, 20, 16), glowMat);
    innerOrb.position.y = 0.12;
    body.add(innerOrb);

    const gimbal1 = new THREE.Mesh(new THREE.TorusGeometry(0.56, 0.032, 12, 42), trimMat);
    gimbal1.position.y = 0.12;
    gimbal1.rotation.x = 0.55;
    tagNodeId(gimbal1, nodeId, hitMeshes);
    body.add(gimbal1);

    const gimbal2 = new THREE.Mesh(new THREE.TorusGeometry(0.66, 0.025, 12, 42), trimMat);
    gimbal2.position.y = 0.12;
    gimbal2.rotation.y = 0.8;
    gimbal2.rotation.x = -0.5;
    body.add(gimbal2);

    rotors.push({ obj: gimbal1, axis: "y", speed: 0.85 });
    rotors.push({ obj: gimbal2, axis: "z", speed: -0.65 });
  } else if (kind === "gpu_cluster" || kind === "vector_db") {
    // Dual-Slot Tensor Fin Array / Illuminated Vector Prism Core
    const dock = new THREE.Mesh(new RoundedBoxGeometry(1.1, 0.16, 0.82, 3, 0.04), chassisMat);
    dock.position.y = -0.3;
    tagNodeId(dock, nodeId, hitMeshes);
    body.add(dock);

    for (let i = 0; i < 4; i++) {
      const blade = new THREE.Mesh(new RoundedBoxGeometry(0.14, 0.66, 0.68, 3, 0.03), trimMat);
      blade.position.set(-0.33 + i * 0.22, 0.1, 0);
      tagNodeId(blade, nodeId, hitMeshes);
      body.add(blade);
    }

    const shroud = new THREE.Mesh(new RoundedBoxGeometry(1.04, 0.56, 0.74, 3, 0.06), glassMat);
    shroud.position.y = 0.12;
    tagNodeId(shroud, nodeId, hitMeshes);
    body.add(shroud);

    const bridge = new THREE.Mesh(new RoundedBoxGeometry(0.86, 0.07, 0.16, 2, 0.02), glowMat);
    bridge.position.set(0, 0.44, 0);
    body.add(bridge);
  } else {
    // Sleek Sculpted Edge Terminal Console / External Bridge Monolith (NEVER a bare cube)
    const stand = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.42, 0.12, 24), chassisMat);
    stand.position.y = -0.36;
    tagNodeId(stand, nodeId, hitMeshes);
    body.add(stand);

    const neck = new THREE.Mesh(new RoundedBoxGeometry(0.14, 0.34, 0.14, 2, 0.03), trimMat);
    neck.position.set(0, -0.16, -0.14);
    neck.rotation.x = 0.22;
    body.add(neck);

    const panelFrame = new THREE.Mesh(new RoundedBoxGeometry(1.02, 0.64, 0.12, 3, 0.04), chassisMat);
    panelFrame.position.set(0, 0.12, 0);
    panelFrame.rotation.x = -0.18;
    tagNodeId(panelFrame, nodeId, hitMeshes);
    body.add(panelFrame);

    const screenGlass = new THREE.Mesh(new RoundedBoxGeometry(0.92, 0.54, 0.06, 3, 0.025), glassMat);
    screenGlass.position.set(0, 0.12, 0.05);
    screenGlass.rotation.x = -0.18;
    tagNodeId(screenGlass, nodeId, hitMeshes);
    body.add(screenGlass);

    const scanBar = new THREE.Mesh(new RoundedBoxGeometry(0.72, 0.045, 0.03, 2, 0.012), glowMat);
    scanBar.position.set(0, 0.14, 0.09);
    scanBar.rotation.x = -0.18;
    body.add(scanBar);
    floatables.push({ obj: scanBar, baseY: 0.14, amp: 0.12, phase: 0.7 });
  }

  return {
    root,
    hitMeshes,
    chassisMaterials,
    trimMaterials,
    glassMaterials,
    emissiveMaterials,
    pulseSegments,
    rotors,
    floatables,
    haloRing,
    shockRing,
    basePos: basePos.clone(),
    baseAccentHex: accentHex,
  };
}

/**
 * Updates hardware rig material themes, internal mechanical motion, thermal hotspots,
 * chaos faults, and arrival recoil waves inside the 60fps loop.
 */
export function animateHardwareRig(
  rig: HardwareRigInstance,
  t: number,
  dt: number,
  opts: {
    theme: "light" | "dark";
    isSelected: boolean;
    isEndpoint: boolean;
    isFault: boolean;
    util: number;
    loadFactor: number;
    hitPulse: number; // 0..1 when a packet hits/originates
  }
): void {
  const { theme, isSelected, isEndpoint, isFault, util, loadFactor, hitPulse } = opts;

  const isLight = theme === "light";
  const chassisHex = isLight ? 0x94a3b8 : 0x131a2b;
  const trimHex = isLight ? 0x334155 : 0x64748b;
  const glassHex = isLight ? 0x7dd3fc : 0x0b1c3d;

  for (const m of rig.chassisMaterials) {
    m.color.setHex(chassisHex);
  }
  for (const m of rig.trimMaterials) {
    m.color.setHex(trimHex);
  }
  for (const m of rig.glassMaterials) {
    m.color.setHex(glassHex);
  }

  let activeColor = rig.baseAccentHex;
  let glowStrength = 1.15;

  if (isFault) {
    activeColor = "#f43f5e";
    glowStrength = 2.1 + Math.sin(t * 7.5) * 0.75;
  } else if (util >= 0.95) {
    activeColor = "#fb7185";
    glowStrength = 1.9 + Math.sin(t * 5) * 0.45;
  } else if (util >= 0.72) {
    activeColor = "#fbbf24";
    glowStrength = 1.55;
  } else if (isSelected || isEndpoint) {
    activeColor = "#38bdf8";
    glowStrength = 2.0 + hitPulse * 0.8;
  }

  for (const em of rig.emissiveMaterials) {
    em.color.set(activeColor);
    em.emissive.set(activeColor);
    em.emissiveIntensity = glowStrength;
  }

  // Sequential wave across internal server/partition LEDs
  if (rig.pulseSegments.length > 0) {
    const wavePos = (t * (1.4 + loadFactor * 1.1)) % rig.pulseSegments.length;
    rig.pulseSegments.forEach(({ mat }, i) => {
      const dist = Math.abs(i - wavePos);
      const pulse = Math.max(0, 1 - dist * 0.85);
      mat.color.set(activeColor);
      mat.emissive.set(activeColor);
      mat.emissiveIntensity = isFault
        ? (i % 2 === 0 ? 2.2 : 0.2)
        : glowStrength * (0.55 + pulse * 1.15 + hitPulse * 0.5);
    });
  }

  // Internal turbines, DB platters, DRAM cores spin faster with QPS load, or stutter under Fault
  const rotMul = isFault ? (Math.sin(t * 14) > 0.4 ? 0.25 : 0) : 0.7 + loadFactor * 0.55;
  for (const r of rig.rotors) {
    r.obj.rotation[r.axis] += dt * r.speed * rotMul;
  }

  for (const fl of rig.floatables) {
    fl.obj.position.y = fl.baseY + Math.sin(t * 2.1 + fl.phase) * fl.amp;
  }

  // Grounded gentle suspension + kinetic micro-lift when active
  const lift = isSelected || isEndpoint ? 0.1 + hitPulse * 0.05 : 0;
  rig.root.position.y = rig.basePos.y + Math.sin(t * 1.3 + rig.basePos.x) * 0.032 + lift;

  const haloMat = rig.haloRing.material as THREE.MeshBasicMaterial;
  haloMat.color.set(activeColor);
  haloMat.opacity = isFault
    ? 0.52 + Math.sin(t * 6.5) * 0.3
    : isSelected || isEndpoint
    ? 0.72
    : util >= 0.72
    ? 0.48
    : 0.22;
  rig.haloRing.scale.setScalar(
    isSelected || isEndpoint ? 1.12 + Math.sin(t * 3.2) * 0.05 : 1.0
  );

  // Expanding packet-arrival shockwave ring
  const shockMat = rig.shockRing.material as THREE.MeshBasicMaterial;
  if (hitPulse > 0.02) {
    shockMat.color.set(activeColor);
    const wave = 1 - hitPulse;
    rig.shockRing.scale.setScalar(1.0 + wave * 0.9);
    shockMat.opacity = hitPulse * 0.65;
  } else {
    shockMat.opacity = 0;
  }
}

export interface MacroGyroRigInstance {
  group: THREE.Group;
  hitMeshes: THREE.Object3D[];
  chassisMaterials: THREE.MeshStandardMaterial[];
  glassMaterials: THREE.MeshPhysicalMaterial[];
  emissiveMaterials: THREE.MeshStandardMaterial[];
  gimbalInner: THREE.Mesh;
  gimbalOuter: THREE.Mesh;
  coreGlass: THREE.Mesh;
  coreJewel: THREE.Mesh;
  haloRing: THREE.Mesh;
  satellites: THREE.Mesh[];
  basePos: THREE.Vector3;
}

/**
 * Builds an aerospace-grade gyroscopic crystal relic rig for Roadmap Modules (1-6)
 * and Tiered Case Studies, replacing plain primitive polyhedrons + wireframe edges.
 */
export function buildMacroGyroRig(
  nodeId: string,
  shapeKind: "cluster" | "octahedron" | "icosahedron" | "cylinder" | "dodecahedron" | "box",
  satelliteCount: number,
  basePos: THREE.Vector3,
  shadowTexture: THREE.Texture
): MacroGyroRigInstance {
  const group = new THREE.Group();
  group.position.copy(basePos);
  group.userData = { nodeId };

  const pal = defaultPalette("#38bdf8");
  const { chassisMat, trimMat, glassMat, glowMat } = createMaterials(pal);
  const hitMeshes: THREE.Object3D[] = [];

  // Ground contact shadow & precision reticle halo
  const shadowGeo = new THREE.PlaneGeometry(1.9, 1.9);
  shadowGeo.rotateX(-Math.PI / 2);
  const shadowDisc = new THREE.Mesh(
    shadowGeo,
    new THREE.MeshBasicMaterial({ map: shadowTexture, transparent: true, opacity: 0.68, depthWrite: false })
  );
  shadowDisc.position.y = -0.68;
  group.add(shadowDisc);

  const haloGeo = new THREE.RingGeometry(0.86, 0.95, 48);
  haloGeo.rotateX(-Math.PI / 2);
  const haloRing = new THREE.Mesh(
    haloGeo,
    new THREE.MeshBasicMaterial({ color: 0x38bdf8, transparent: true, opacity: 0.32, side: THREE.DoubleSide })
  );
  haloRing.position.y = -0.64;
  group.add(haloRing);

  // Machined Titanium Pedestal Ring
  const collar = new THREE.Mesh(new THREE.CylinderGeometry(0.46, 0.56, 0.14, 24), chassisMat);
  collar.position.y = -0.46;
  tagNodeId(collar, nodeId, hitMeshes);
  group.add(collar);

  let coreGeo: THREE.BufferGeometry;
  switch (shapeKind) {
    case "cylinder":
      coreGeo = new THREE.CylinderGeometry(0.48, 0.48, 0.66, 24);
      break;
    case "octahedron":
      coreGeo = new THREE.OctahedronGeometry(0.54, 0);
      break;
    case "dodecahedron":
      coreGeo = new THREE.DodecahedronGeometry(0.5, 0);
      break;
    case "icosahedron":
      coreGeo = new THREE.IcosahedronGeometry(0.52, 0);
      break;
    case "cluster":
      coreGeo = new THREE.OctahedronGeometry(0.56, 1);
      break;
    default:
      coreGeo = new RoundedBoxGeometry(0.68, 0.54, 0.68, 4, 0.08);
  }

  const coreGlass = new THREE.Mesh(coreGeo, glassMat);
  tagNodeId(coreGlass, nodeId, hitMeshes);
  group.add(coreGlass);

  const coreJewel = new THREE.Mesh(new THREE.OctahedronGeometry(0.24, 0), glowMat);
  tagNodeId(coreJewel, nodeId, hitMeshes);
  group.add(coreJewel);

  const gimbalInner = new THREE.Mesh(new THREE.TorusGeometry(0.68, 0.032, 12, 48), trimMat);
  gimbalInner.rotation.x = 0.6;
  tagNodeId(gimbalInner, nodeId, hitMeshes);
  group.add(gimbalInner);

  const gimbalOuter = new THREE.Mesh(new THREE.TorusGeometry(0.82, 0.025, 12, 48), chassisMat);
  gimbalOuter.rotation.y = 0.7;
  gimbalOuter.rotation.x = -0.45;
  group.add(gimbalOuter);

  const satellites: THREE.Mesh[] = [];
  const satCount = Math.min(4, Math.max(0, satelliteCount));
  for (let s = 0; s < satCount; s++) {
    const satMat = glowMat.clone();
    const sat = new THREE.Mesh(new RoundedBoxGeometry(0.16, 0.16, 0.16, 2, 0.03), satMat);
    tagNodeId(sat, nodeId, hitMeshes);
    group.add(sat);
    satellites.push(sat);
  }

  return {
    group,
    hitMeshes,
    chassisMaterials: [chassisMat, trimMat],
    glassMaterials: [glassMat],
    emissiveMaterials: [glowMat, ...satellites.map((s) => s.material as THREE.MeshStandardMaterial)],
    gimbalInner,
    gimbalOuter,
    coreGlass,
    coreJewel,
    haloRing,
    satellites,
    basePos: basePos.clone(),
  };
}

