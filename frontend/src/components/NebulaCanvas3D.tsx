import React, { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { RotateCcw } from "lucide-react";
import type { LessonEdge, LessonNode, TraceStep } from "../types/hld";
import { truncateText } from "../utils/format";
import {
  animateHardwareRig,
  buildHardwareRig,
  type HardwareRigInstance,
} from "../utils/proceduralArchitectureMeshes";
import {
  addStudioLighting,
  createAmbientConstellation,
  createBackdropDome,
  createContactShadowTexture,
  createNebulaGalaxy,
  createOpticalConduitMaterial,
  createPostProcessingPipeline,
  createRadialGlowTexture,
  createSpatialFloorDeck,
  disposeObjectTree,
  setupStudioEnvironment,
  type StudioComposerHandle,
} from "../utils/threeNebula";
import { IsometricCanvas, type PlaybackState } from "./IsometricCanvas";

interface NebulaCanvas3DProps {
  nodes: LessonNode[];
  edges: LessonEdge[];
  steps: TraceStep[];
  activeStepIndex: number;
  playbackState: PlaybackState;
  flightProgress: number;
  selectedNodeId: string | null;
  faultNodeId: string | null;
  theme: "light" | "dark";
  loadFactor?: number;
  nodeUtilization?: Record<string, number>;
  hudRightInsetPx?: number;
  hudBottomInsetPx?: number;
  onSelectNode: (nodeId: string) => void;
  onSelectStep: (stepIndex: number) => void;
}

const CATEGORY_HEX: Record<string, string> = {
  network: "#38bdf8",
  read: "#38bdf8",
  cache_hit: "#34d399",
  cache_miss: "#fbbf24",
  write: "#c084fc",
  async: "#818cf8",
  consensus: "#60a5fa",
  llm: "#e879f9",
  failover: "#f43f5e",
};

/**
 * Projects 2D curriculum grid coordinates onto the grounded 3D deck and runs
 * a minimum-distance relaxation pass so vertical stacks (e.g. App Pods) stay clear.
 */
function computeWorldPositions(nodes: LessonNode[]): Map<string, THREE.Vector3> {
  const map = new Map<string, THREE.Vector3>();
  if (nodes.length === 0) return map;

  let minGx = Infinity,
    maxGx = -Infinity,
    minGy = Infinity,
    maxGy = -Infinity;
  for (const n of nodes) {
    minGx = Math.min(minGx, n.gridPos.gx);
    maxGx = Math.max(maxGx, n.gridPos.gx);
    minGy = Math.min(minGy, n.gridPos.gy);
    maxGy = Math.max(maxGy, n.gridPos.gy);
  }
  const midGx = (minGx + maxGx) / 2;
  const midGy = (minGy + maxGy) / 2;
  const span = Math.max(2, maxGx - minGx, maxGy - minGy);
  const scale = Math.min(2.25, 8.2 / span);

  const pts = nodes.map((n, i) => ({
    id: n.id,
    x: (n.gridPos.gx - midGx) * scale,
    z: (n.gridPos.gy - midGy) * (scale * 0.94),
    seed: i,
  }));

  const minSep = 2.42;
  for (let iter = 0; iter < 14; iter++) {
    for (let i = 0; i < pts.length; i++) {
      for (let j = i + 1; j < pts.length; j++) {
        let dx = pts[j].x - pts[i].x;
        let dz = pts[j].z - pts[i].z;
        let dist = Math.hypot(dx, dz);
        if (dist < 0.001) {
          dx = 0.1 * ((i % 2) * 2 - 1);
          dz = 0.1;
          dist = Math.hypot(dx, dz);
        }
        if (dist < minSep) {
          const push = (minSep - dist) * 0.5;
          const nx = dx / dist;
          const nz = dz / dist;
          pts[i].x -= nx * push;
          pts[i].z -= nz * push;
          pts[j].x += nx * push;
          pts[j].z += nz * push;
        }
      }
    }
  }

  let cx = 0;
  let cz = 0;
  for (const p of pts) {
    cx += p.x;
    cz += p.z;
  }
  cx /= pts.length;
  cz /= pts.length;

  for (const p of pts) {
    map.set(p.id, new THREE.Vector3(p.x - cx, 0, p.z - cz));
  }
  return map;
}

const DEFAULT_ORBIT = { theta: 0.22, phi: 0.92, zoom: 14.3 };
const MAX_SWARM_PARTICLES = 120;

export const NebulaCanvas3D: React.FC<NebulaCanvas3DProps> = ({
  nodes,
  edges,
  steps,
  activeStepIndex,
  playbackState,
  flightProgress,
  selectedNodeId,
  faultNodeId,
  theme,
  loadFactor = 1,
  nodeUtilization,
  hudRightInsetPx = 0,
  hudBottomInsetPx = 0,
  onSelectNode,
  onSelectStep,
}) => {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const labelRefs = useRef<Map<string, HTMLButtonElement>>(new Map());
  const packetHudRef = useRef<HTMLDivElement | null>(null);
  const [webglFailed, setWebglFailed] = useState(false);
  const [hasDragged, setHasDragged] = useState(false);

  const activeStep = activeStepIndex >= 0 ? steps[activeStepIndex] ?? null : null;
  const activeStepColor = activeStep ? CATEGORY_HEX[activeStep.category] ?? "#38bdf8" : "#38bdf8";

  const liveRef = useRef({
    nodes,
    edges,
    steps,
    activeStepIndex,
    playbackState,
    flightProgress,
    selectedNodeId,
    faultNodeId,
    theme,
    loadFactor,
    nodeUtilization: nodeUtilization ?? {},
    hudRightInsetPx,
    hudBottomInsetPx,
    onSelectNode,
  });
  liveRef.current = {
    nodes,
    edges,
    steps,
    activeStepIndex,
    playbackState,
    flightProgress,
    selectedNodeId,
    faultNodeId,
    theme,
    loadFactor,
    nodeUtilization: nodeUtilization ?? {},
    hudRightInsetPx,
    hudBottomInsetPx,
    onSelectNode,
  };

  const sceneRefs = useRef<{
    scene: THREE.Scene;
    camera: THREE.PerspectiveCamera;
    topologyGroup: THREE.Group;
    nodeRigs: Map<string, HardwareRigInstance>;
    edgeCurves: Map<
      string,
      {
        curve: THREE.QuadraticBezierCurve3;
        coreMat: THREE.ShaderMaterial;
        sheathMat: THREE.MeshPhysicalMaterial;
        defaultColor: string;
      }
    >;
    shadowTex: THREE.Texture;
    packetSwarm: THREE.Points;
    packetSwarmGeo: THREE.BufferGeometry;
    packetSwarmAttr: THREE.BufferAttribute;
    packetSwarmMat: THREE.PointsMaterial;
    packetLeader: THREE.Mesh;
    galaxyMat: THREE.ShaderMaterial;
    ambientMat: THREE.LineBasicMaterial;
    backdropMat: THREE.ShaderMaterial;
    floorDeckMat: THREE.ShaderMaterial;
    composerHandle: StudioComposerHandle | null;
    orbitTarget: { theta: number; phi: number; zoom: number };
    orbitCurrent: { theta: number; phi: number; zoom: number };
    viewOffsetCurrent: { rx: number; by: number };
    lastViewport: { w: number; h: number; rx: number; by: number };
    mouseNdc: { x: number; y: number };
  } | null>(null);

  const rebuildTopology = useMemo(
    () => () => {
      const refs = sceneRefs.current;
      if (!refs) return;
      const { topologyGroup, nodeRigs, edgeCurves, shadowTex } = refs;

      disposeObjectTree(topologyGroup);
      topologyGroup.clear();
      nodeRigs.clear();
      edgeCurves.clear();

      const positions = computeWorldPositions(liveRef.current.nodes);

      // Dual-layer glass & optical-pulse fiber conduits between hardware rigs
      for (const edge of liveRef.current.edges) {
        const p1 = positions.get(edge.from);
        const p2 = positions.get(edge.to);
        if (!p1 || !p2) continue;

        const startPt = new THREE.Vector3(p1.x, 0.14, p1.z);
        const endPt = new THREE.Vector3(p2.x, 0.14, p2.z);
        const mid = startPt.clone().add(endPt).multiplyScalar(0.5);
        const dist = startPt.distanceTo(endPt);
        mid.y += Math.max(0.65, dist * 0.24);

        const curve = new THREE.QuadraticBezierCurve3(startPt, mid, endPt);
        const defaultColor = edge.transport === "async" ? "#818cf8" : "#38bdf8";

        const coreGeo = new THREE.TubeGeometry(curve, 44, 0.022, 10, false);
        const coreMat = createOpticalConduitMaterial(defaultColor, 0.36);
        topologyGroup.add(new THREE.Mesh(coreGeo, coreMat));

        const sheathGeo = new THREE.TubeGeometry(curve, 44, 0.046, 10, false);
        const sheathMat = new THREE.MeshPhysicalMaterial({
          color: 0x1e3a8a,
          roughness: 0.1,
          metalness: 0.05,
          transparent: true,
          opacity: 0.14,
          clearcoat: 1.0,
          depthWrite: false,
        });
        topologyGroup.add(new THREE.Mesh(sheathGeo, sheathMat));

        edgeCurves.set(edge.id, { curve, coreMat, sheathMat, defaultColor });
      }

      // Grounded multi-part PBR hardware assemblies per component node
      for (const n of liveRef.current.nodes) {
        const pos = positions.get(n.id) ?? new THREE.Vector3();
        const rig = buildHardwareRig(n.id, n.kind, pos, shadowTex);
        topologyGroup.add(rig.root);
        nodeRigs.set(n.id, rig);
      }
    },
    []
  );

  // Initialize persistent Three.js WebGL studio stage once
  useEffect(() => {
    const container = hostRef.current;
    if (!container) return;

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({
        antialias: true,
        powerPreference: "high-performance",
      });
    } catch {
      setWebglFailed(true);
      return;
    }

    const width = container.clientWidth || 800;
    const height = container.clientHeight || 420;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(width, height);
    renderer.domElement.style.display = "block";
    renderer.domElement.style.width = "100%";
    renderer.domElement.style.height = "100%";
    container.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(40, width / height, 0.1, 100);
    const orbitDefault = { ...DEFAULT_ORBIT };

    const envRT = setupStudioEnvironment(renderer, scene);
    addStudioLighting(scene);
    const backdropMat = createBackdropDome(scene);
    const floorDeckMat = createSpatialFloorDeck(scene, -0.59, 11.4);
    const galaxyMat = createNebulaGalaxy(scene, 1150);
    const { lines: ambientConstellation, material: ambientMat } = createAmbientConstellation(scene);
    const glowTex = createRadialGlowTexture();
    const shadowTex = createContactShadowTexture();
    const composerHandle = createPostProcessingPipeline(renderer, scene, camera, width, height);

    const topologyGroup = new THREE.Group();
    scene.add(topologyGroup);

    const packetGroup = new THREE.Group();
    scene.add(packetGroup);

    const swarmPos = new Float32Array(MAX_SWARM_PARTICLES * 3);
    const packetSwarmGeo = new THREE.BufferGeometry();
    const packetSwarmAttr = new THREE.BufferAttribute(swarmPos, 3);
    packetSwarmGeo.setAttribute("position", packetSwarmAttr);
    packetSwarmGeo.setDrawRange(0, 54);
    const packetSwarmMat = new THREE.PointsMaterial({
      color: 0x38bdf8,
      map: glowTex,
      size: 0.36,
      transparent: true,
      opacity: 0.92,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const packetSwarm = new THREE.Points(packetSwarmGeo, packetSwarmMat);
    packetGroup.add(packetSwarm);

    const leaderGeo = new THREE.SphereGeometry(0.15, 20, 20);
    const leaderMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      emissive: 0x38bdf8,
      emissiveIntensity: 2.6,
      roughness: 0.1,
    });
    const packetLeader = new THREE.Mesh(leaderGeo, leaderMat);
    packetGroup.add(packetLeader);

    const applyCameraViewport = (w: number, h: number, rx: number, by: number) => {
      const effRx = w >= 920 ? Math.max(0, Math.round(rx)) : 0;
      const effBy = h >= 540 ? Math.max(0, Math.round(by)) : 0;
      camera.aspect = w / h;
      if (effRx > 0 || effBy > 0) {
        camera.setViewOffset(w + effRx, h + effBy, effRx, effBy, w, h);
      } else {
        camera.clearViewOffset();
      }
      camera.updateProjectionMatrix();
    };

    const initRx = width >= 920 ? liveRef.current.hudRightInsetPx : 0;
    const initBy = height >= 540 ? liveRef.current.hudBottomInsetPx : 0;
    applyCameraViewport(width, height, initRx, initBy);

    sceneRefs.current = {
      scene,
      camera,
      topologyGroup,
      nodeRigs: new Map(),
      edgeCurves: new Map(),
      shadowTex,
      packetSwarm,
      packetSwarmGeo,
      packetSwarmAttr,
      packetSwarmMat,
      packetLeader,
      galaxyMat,
      ambientMat,
      backdropMat,
      floorDeckMat,
      composerHandle,
      orbitTarget: { ...orbitDefault },
      orbitCurrent: { ...orbitDefault },
      viewOffsetCurrent: { rx: initRx, by: initBy },
      lastViewport: { w: width, h: height, rx: initRx, by: initBy },
      mouseNdc: { x: 0, y: 0 },
    };

    rebuildTopology();

    const raycaster = new THREE.Raycaster();
    let dragging = false;
    let pointerDownPos = { x: 0, y: 0 };
    let lastPos = { x: 0, y: 0 };

    const onPointerDown = (e: PointerEvent) => {
      dragging = true;
      pointerDownPos = { x: e.clientX, y: e.clientY };
      lastPos = { x: e.clientX, y: e.clientY };
    };

    const onPointerMove = (e: PointerEvent) => {
      const rect = renderer.domElement.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;
      const nx = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      const ny = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      if (sceneRefs.current) {
        sceneRefs.current.mouseNdc = { x: nx, y: ny };
      }
      if (!dragging || !sceneRefs.current) return;
      const dx = e.clientX - lastPos.x;
      const dy = e.clientY - lastPos.y;
      lastPos = { x: e.clientX, y: e.clientY };
      if (Math.abs(dx) + Math.abs(dy) > 1) {
        setHasDragged(true);
      }
      sceneRefs.current.orbitTarget.theta -= dx * 0.0065;
      sceneRefs.current.orbitTarget.phi = Math.max(
        0.56,
        Math.min(1.22, sceneRefs.current.orbitTarget.phi - dy * 0.0055)
      );
    };

    const onPointerUp = (e: PointerEvent) => {
      if (!dragging) return;
      dragging = false;
      const moved = Math.hypot(e.clientX - pointerDownPos.x, e.clientY - pointerDownPos.y);
      if (moved < 6 && sceneRefs.current) {
        const rect = renderer.domElement.getBoundingClientRect();
        const ptr = new THREE.Vector2(
          ((e.clientX - rect.left) / rect.width) * 2 - 1,
          -((e.clientY - rect.top) / rect.height) * 2 + 1
        );
        raycaster.setFromCamera(ptr, sceneRefs.current.camera);
        const hitTargets: THREE.Object3D[] = [];
        sceneRefs.current.nodeRigs.forEach((rig) => {
          hitTargets.push(...rig.hitMeshes);
        });
        const hits = raycaster.intersectObjects(hitTargets, false);
        if (hits.length > 0 && hits[0].object.userData?.nodeId) {
          liveRef.current.onSelectNode(hits[0].object.userData.nodeId);
        }
      }
    };

    const onWheel = (e: WheelEvent) => {
      if (!sceneRefs.current) return;
      e.preventDefault();
      sceneRefs.current.orbitTarget.zoom = Math.max(
        7.6,
        Math.min(17.5, sceneRefs.current.orbitTarget.zoom + e.deltaY * 0.006)
      );
      setHasDragged(true);
    };

    const el = renderer.domElement;
    el.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    el.addEventListener("wheel", onWheel, { passive: false });

    const resizeObserver = new ResizeObserver(() => {
      const w = container.clientWidth || 800;
      const h = container.clientHeight || 420;
      const refs = sceneRefs.current;
      if (refs) {
        applyCameraViewport(w, h, refs.viewOffsetCurrent.rx, refs.viewOffsetCurrent.by);
        refs.lastViewport = {
          w,
          h,
          rx: Math.round(refs.viewOffsetCurrent.rx),
          by: Math.round(refs.viewOffsetCurrent.by),
        };
        if (refs.composerHandle) {
          refs.composerHandle.composer.setSize(w, h);
          refs.composerHandle.bloomPass.setSize(w, h);
        }
      } else {
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
      }
      renderer.setSize(w, h);
    });
    resizeObserver.observe(container);

    let rafId = 0;
    const startTimeMs = performance.now();
    let prevTime = 0;
    const tmpVec = new THREE.Vector3();

    const animate = () => {
      rafId = requestAnimationFrame(animate);
      if (document.hidden) return;
      const refs = sceneRefs.current;
      if (!refs) return;

      const t = (performance.now() - startTimeMs) * 0.001;
      const dt = Math.min(0.05, Math.max(0.001, t - prevTime));
      prevTime = t;

      const state = liveRef.current;
      const active = state.activeStepIndex >= 0 ? state.steps[state.activeStepIndex] ?? null : null;
      const isFlowActive = state.playbackState !== "idle" && active !== null;
      const load = Math.max(0.35, Math.min(2.6, state.loadFactor ?? 1));
      const isLight = state.theme === "light" ? 1.0 : 0.0;
      const chaosFloat = state.faultNodeId ? 1.0 : Math.max(0, (load - 1.55) * 0.65);

      scene.environmentIntensity = isLight ? 1.05 : 0.88;
      refs.backdropMat.uniforms.uLightMode.value = isLight;
      refs.backdropMat.uniforms.uChaos.value = chaosFloat;
      refs.floorDeckMat.uniforms.uTime.value = t;
      refs.floorDeckMat.uniforms.uLightMode.value = isLight;
      refs.floorDeckMat.uniforms.uChaos.value = chaosFloat;

      refs.galaxyMat.uniforms.uTime.value = t;
      refs.galaxyMat.uniforms.uMouse.value.set(refs.mouseNdc.x, refs.mouseNdc.y);
      refs.galaxyMat.uniforms.uChaos.value = chaosFloat;
      refs.galaxyMat.uniforms.uOpacity.value = state.theme === "light" ? 0.24 : 0.84;
      refs.ambientMat.opacity = state.theme === "light" ? 0.04 : 0.09;
      ambientConstellation.rotation.y = t * 0.012;

      if (refs.composerHandle) {
        refs.composerHandle.bloomPass.strength = state.theme === "light" ? 0.14 : 0.44;
      }

      const oc = refs.orbitCurrent;
      const ot = refs.orbitTarget;
      oc.theta += (ot.theta + refs.mouseNdc.x * 0.055 - oc.theta) * 0.075;
      oc.phi += (ot.phi - refs.mouseNdc.y * 0.035 - oc.phi) * 0.075;
      oc.zoom += (ot.zoom - oc.zoom) * 0.08;

      camera.position.set(
        Math.sin(oc.theta) * Math.sin(oc.phi) * oc.zoom,
        Math.cos(oc.phi) * oc.zoom,
        Math.cos(oc.theta) * Math.sin(oc.phi) * oc.zoom
      );
      camera.lookAt(0, -0.35, 0);

      const w = container.clientWidth || 800;
      const h = container.clientHeight || 420;
      const targetRx = w >= 920 ? state.hudRightInsetPx : 0;
      const targetBy = h >= 540 ? state.hudBottomInsetPx : 0;
      refs.viewOffsetCurrent.rx += (targetRx - refs.viewOffsetCurrent.rx) * 0.16;
      refs.viewOffsetCurrent.by += (targetBy - refs.viewOffsetCurrent.by) * 0.16;
      const nextRx = Math.round(refs.viewOffsetCurrent.rx);
      const nextBy = Math.round(refs.viewOffsetCurrent.by);
      if (
        w !== refs.lastViewport.w ||
        h !== refs.lastViewport.h ||
        nextRx !== refs.lastViewport.rx ||
        nextBy !== refs.lastViewport.by
      ) {
        applyCameraViewport(w, h, nextRx, nextBy);
        refs.lastViewport = { w, h, rx: nextRx, by: nextBy };
      }

      // Compute kinetic arrival shockwave when active packet reaches destination rig
      const arrivingPulse =
        isFlowActive && state.flightProgress > 0.82
          ? Math.sin(((state.flightProgress - 0.82) / 0.18) * Math.PI)
          : 0;

      state.nodes.forEach((n) => {
        const rig = refs.nodeRigs.get(n.id);
        if (!rig) return;
        const isSelected = state.selectedNodeId === n.id;
        const isEndpoint = isFlowActive && (active?.sourceNodeId === n.id || active?.targetNodeId === n.id);
        const isTargetArrival = isFlowActive && active?.targetNodeId === n.id;
        const isFault = state.faultNodeId === n.id;
        const util = state.nodeUtilization?.[n.id] ?? 0;

        animateHardwareRig(rig, t, dt, {
          theme: state.theme,
          isSelected,
          isEndpoint,
          isFault,
          util,
          loadFactor: load,
          hitPulse: isTargetArrival ? arrivingPulse : 0,
        });

        const domEl = labelRefs.current.get(n.id);
        if (domEl) {
          tmpVec.copy(rig.root.position);
          tmpVec.y -= 0.78;
          tmpVec.project(camera);
          if (tmpVec.z < 1) {
            const rawX = (tmpVec.x * 0.5 + 0.5) * w;
            const rawY = (-tmpVec.y * 0.5 + 0.5) * h;
            const sx = Math.round(Math.max(80, Math.min(w - 80, rawX)));
            const sy = Math.round(Math.max(64, Math.min(h - 86, rawY)));
            domEl.style.transform = `translate3d(${sx}px, ${sy}px, 0) translate(-50%, 0)`;
            domEl.style.opacity = "1";
          } else {
            domEl.style.opacity = "0";
          }
        }
      });

      const activeSwarmCount = isFlowActive
        ? Math.min(MAX_SWARM_PARTICLES, Math.round(44 + load * 26))
        : Math.min(MAX_SWARM_PARTICLES, Math.round(28 + load * 32));
      refs.packetSwarmGeo.setDrawRange(0, activeSwarmCount);
      refs.packetSwarmMat.size = 0.34 + Math.min(0.16, Math.max(0, load - 1) * 0.09);

      let activeArcPos: THREE.Vector3 | null = null;
      state.edges.forEach((edge) => {
        const arc = refs.edgeCurves.get(edge.id);
        if (!arc) return;
        const isActiveEdge = isFlowActive && active?.edgeId === edge.id;
        arc.coreMat.uniforms.uTime.value = t;
        arc.coreMat.uniforms.uSpeed.value = 0.6 + load * 0.5;

        if (isActiveEdge && active) {
          const hex = CATEGORY_HEX[active.category] ?? "#38bdf8";
          arc.coreMat.uniforms.uColor.value.set(hex);
          arc.coreMat.uniforms.uOpacity.value = 0.78;
          arc.coreMat.uniforms.uActive.value = 1.0;

          const reversed = active.sourceNodeId === edge.to;
          const progress = Math.max(0, Math.min(1, state.flightProgress));
          const headT = reversed ? 1 - progress : progress;
          activeArcPos = arc.curve.getPoint(headT);
          refs.packetLeader.position.copy(activeArcPos);
          (refs.packetLeader.material as THREE.MeshStandardMaterial).emissive.set(hex);
          refs.packetSwarmMat.color.set(hex);

          const arr = refs.packetSwarmAttr.array as Float32Array;
          for (let p = 0; p < activeSwarmCount; p++) {
            const lag = (p / activeSwarmCount) * 0.28;
            const u = reversed ? Math.min(1, headT + lag) : Math.max(0, headT - lag);
            const pt = arc.curve.getPoint(u);
            const jitter = (1 - p / activeSwarmCount) * 0.055;
            arr[p * 3] = pt.x + Math.sin(t * 14 + p * 1.9) * jitter;
            arr[p * 3 + 1] = pt.y + Math.cos(t * 16 + p * 2.3) * jitter;
            arr[p * 3 + 2] = pt.z + Math.sin(t * 12 + p * 3.1) * jitter;
          }
          refs.packetSwarmAttr.needsUpdate = true;
        } else {
          arc.coreMat.uniforms.uColor.value.set(load >= 1.9 ? "#fbbf24" : arc.defaultColor);
          arc.coreMat.uniforms.uOpacity.value = isFlowActive ? 0.14 : 0.34;
          arc.coreMat.uniforms.uActive.value = 0.0;
        }
      });

      if (!isFlowActive && state.edges.length > 0) {
        const arr = refs.packetSwarmAttr.array as Float32Array;
        const perEdge = Math.max(1, Math.floor(activeSwarmCount / state.edges.length));
        const flowSpeed = 0.18 + load * 0.22;
        refs.packetSwarmMat.color.set(load >= 1.9 ? "#fbbf24" : "#38bdf8");
        refs.packetLeader.visible = false;
        let idx = 0;
        for (let eIdx = 0; eIdx < state.edges.length && idx < activeSwarmCount; eIdx++) {
          const arc = refs.edgeCurves.get(state.edges[eIdx].id);
          if (!arc) continue;
          for (let k = 0; k < perEdge && idx < activeSwarmCount; k++) {
            const u = ((t * flowSpeed + k / perEdge + eIdx * 0.17) % 1 + 1) % 1;
            const pt = arc.curve.getPoint(u);
            arr[idx * 3] = pt.x;
            arr[idx * 3 + 1] = pt.y;
            arr[idx * 3 + 2] = pt.z;
            idx++;
          }
        }
        refs.packetSwarmAttr.needsUpdate = true;
      } else {
        refs.packetLeader.visible = isFlowActive && activeArcPos !== null;
      }

      const hudEl = packetHudRef.current;
      if (hudEl) {
        if (isFlowActive && active && activeArcPos) {
          tmpVec.copy(activeArcPos);
          tmpVec.y += 0.56;
          tmpVec.project(camera);
          if (tmpVec.z < 1) {
            const rawHx = (tmpVec.x * 0.5 + 0.5) * w;
            const rawHy = (-tmpVec.y * 0.5 + 0.5) * h;
            const hx = Math.round(Math.max(78, Math.min(w - 78, rawHx)));
            const hy = Math.round(Math.max(76, Math.min(h - 90, rawHy)));
            hudEl.style.transform = `translate3d(${hx}px, ${hy}px, 0) translate(-50%, -100%)`;
            hudEl.style.opacity = "1";
          } else {
            hudEl.style.opacity = "0";
          }
        } else {
          hudEl.style.opacity = "0";
        }
      }

      if (refs.composerHandle) {
        refs.composerHandle.composer.render();
      } else {
        renderer.render(scene, camera);
      }
    };

    rafId = requestAnimationFrame(animate);

    return () => {
      cancelAnimationFrame(rafId);
      resizeObserver.disconnect();
      el.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      el.removeEventListener("wheel", onWheel);
      composerHandle?.dispose();
      glowTex.dispose();
      shadowTex.dispose();
      envRT.dispose();
      disposeObjectTree(scene);
      renderer.dispose();
      if (el.parentNode === container) {
        container.removeChild(el);
      }
      sceneRefs.current = null;
    };
  }, [rebuildTopology]);

  // Rebuild 3D hardware rigs cleanly whenever lesson nodes or edges switch
  useEffect(() => {
    rebuildTopology();
    if (sceneRefs.current) {
      sceneRefs.current.orbitTarget = { ...DEFAULT_ORBIT };
      setHasDragged(false);
    }
  }, [nodes, edges, rebuildTopology]);

  if (webglFailed) {
    return (
      <IsometricCanvas
        nodes={nodes}
        edges={edges}
        steps={steps}
        activeStepIndex={activeStepIndex}
        playbackState={playbackState}
        flightProgress={flightProgress}
        selectedNodeId={selectedNodeId}
        faultNodeId={faultNodeId}
        viewMode="network"
        onSelectNode={onSelectNode}
        onSelectStep={onSelectStep}
      />
    );
  }

  return (
    <div
      style={{
        flex: 1,
        position: "relative",
        overflow: "hidden",
        background:
          theme === "dark"
            ? "#03050c"
            : "#eef2ff",
        cursor: "grab",
      }}
    >
      <div ref={hostRef} style={{ position: "absolute", inset: 0 }} />

      {/* Projected razor-sharp glass HUD labels tracking each 3D hardware rig */}
      <div style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
        {nodes.map((n) => {
          const isSelected = selectedNodeId === n.id;
          const isFault = faultNodeId === n.id;
          const util = nodeUtilization?.[n.id] ?? 0;
          const isHot = !isFault && util >= 0.95;
          const isWarm = !isFault && util >= 0.72 && util < 0.95;
          return (
            <button
              key={n.id}
              ref={(el) => {
                if (el) labelRefs.current.set(n.id, el);
                else labelRefs.current.delete(n.id);
              }}
              onClick={() => onSelectNode(n.id)}
              title={`${n.label} — ${n.sublabel}`}
              style={{
                position: "absolute",
                left: 0,
                top: 0,
                opacity: 0,
                willChange: "transform, opacity",
                pointerEvents: "auto",
                padding: "4px 9px",
                borderRadius: 8,
                zIndex: isSelected ? 5 : 1,
                border:
                  isFault || isHot
                    ? "1px solid rgba(244, 63, 94, 0.8)"
                    : isWarm
                    ? "1px solid rgba(251, 191, 36, 0.75)"
                    : isSelected
                    ? "1px solid rgba(56, 189, 248, 0.9)"
                    : "1px solid var(--border)",
                background: theme === "dark" ? "rgba(8, 13, 28, 0.8)" : "rgba(255, 255, 255, 0.9)",
                backdropFilter: "blur(10px)",
                color: "var(--ink-primary)",
                cursor: "pointer",
                textAlign: "center",
                boxShadow:
                  isHot || isFault
                    ? "0 0 18px rgba(244, 63, 94, 0.32)"
                    : isSelected
                    ? "0 0 16px rgba(56, 189, 248, 0.35)"
                    : "0 4px 12px rgba(2, 6, 23, 0.28)",
              }}
            >
              <div
                className="mono"
                style={{
                  fontSize: 10,
                  fontWeight: 700,
                  whiteSpace: "nowrap",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 5,
                }}
              >
                <span>{truncateText(n.label, 24)}</span>
                {(isFault || isHot || isWarm) && (
                  <span
                    style={{
                      width: 6,
                      height: 6,
                      borderRadius: "50%",
                      background: isFault || isHot ? "#fb7185" : "#fbbf24",
                      display: "inline-block",
                    }}
                  />
                )}
              </div>
              <div className="mono" style={{ fontSize: 8.5, color: "var(--ink-muted)", whiteSpace: "nowrap" }}>
                {truncateText(n.sublabel, 26)}
              </div>
            </button>
          );
        })}

        {/* Active Packet Telemetry Badge projected over the 3D optical burst */}
        {playbackState !== "idle" && activeStep && (
          <div
            ref={packetHudRef}
            className="mono"
            style={{
              position: "absolute",
              left: 0,
              top: 0,
              opacity: 0,
              willChange: "transform, opacity",
              padding: "3px 9px",
              borderRadius: 99,
              fontSize: 10,
              fontWeight: 700,
              background: theme === "dark" ? "rgba(6, 11, 24, 0.9)" : "rgba(255, 255, 255, 0.95)",
              color: activeStepColor,
              border: `1px solid ${activeStepColor}`,
              boxShadow: `0 0 18px ${activeStepColor}55`,
              whiteSpace: "nowrap",
            }}
          >
            {activeStep.protocol} · +{activeStep.latencyDeltaMs}ms
          </div>
        )}
      </div>

      {/* Subtle 3D Orbit Hint / Reset Camera Pill */}
      <div
        style={{
          position: "absolute",
          bottom: 18,
          left: 16,
          display: "flex",
          alignItems: "center",
          gap: 6,
          pointerEvents: "auto",
          zIndex: 8,
        }}
      >
        {!hasDragged && (
          <span
            className="mono"
            style={{
              fontSize: 9.5,
              padding: "4px 10px",
              borderRadius: 99,
              background: theme === "dark" ? "rgba(8, 12, 24, 0.62)" : "rgba(255, 255, 255, 0.76)",
              border: "1px solid var(--border-soft)",
              color: "var(--ink-muted)",
              backdropFilter: "blur(10px)",
            }}
          >
            Drag to orbit · Scroll zoom · Click hardware
          </span>
        )}
        {hasDragged && (
          <button
            className="icon-btn"
            style={{ height: 24, fontSize: 9.5, borderRadius: 99 }}
            onClick={() => {
              if (sceneRefs.current) {
                sceneRefs.current.orbitTarget = { ...DEFAULT_ORBIT };
                setHasDragged(false);
              }
            }}
          >
            <RotateCcw size={10} /> Reset View
          </button>
        )}
      </div>
    </div>
  );
};
