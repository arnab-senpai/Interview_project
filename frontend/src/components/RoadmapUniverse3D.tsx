import React, { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { CheckCircle2, RotateCcw } from "lucide-react";
import { truncateText } from "../utils/format";
import {
  buildMacroGyroRig,
  type MacroGyroRigInstance,
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

export interface UniverseConstellationNode {
  id: string;
  code: string;
  shortLabel: string;
  subtitle: string;
  status: "completed" | "in_progress" | "not_started";
  position: [number, number, number];
  satelliteCount: number;
  shapeKind: "cluster" | "octahedron" | "icosahedron" | "cylinder" | "dodecahedron" | "box";
}

export interface UniverseLink {
  fromId: string;
  toId: string;
}

interface RoadmapUniverse3DProps {
  nodes: UniverseConstellationNode[];
  links: UniverseLink[];
  selectedId: string;
  theme: "light" | "dark";
  displayMode?: "3d" | "2d";
  onSelectNode: (id: string) => void;
}

const DEFAULT_UNIVERSE_ORBIT = { theta: 0.18, phi: 0.94, zoom: 13.0 };
const ORBIT_PARTICLE_COUNT = 64;

function shortestAngleDelta(from: number, to: number): number {
  return Math.atan2(Math.sin(to - from), Math.cos(to - from));
}

/**
 * Interactive Macro 3D Constellation Studio rendering HLD Modules (1–6) and Tiered Case
 * Studies as aerospace-grade titanium & borosilicate gyroscopic hardware constellations.
 */
export const RoadmapUniverse3D: React.FC<RoadmapUniverse3DProps> = ({
  nodes,
  links,
  selectedId,
  theme,
  displayMode = "3d",
  onSelectNode,
}) => {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const labelRefs = useRef<Map<string, HTMLButtonElement>>(new Map());
  const [webglFailed, setWebglFailed] = useState(false);
  const [hasDragged, setHasDragged] = useState(false);

  const liveRef = useRef({
    nodes,
    links,
    selectedId,
    theme,
    onSelectNode,
  });
  liveRef.current = {
    nodes,
    links,
    selectedId,
    theme,
    onSelectNode,
  };

  const sceneRefs = useRef<{
    scene: THREE.Scene;
    camera: THREE.PerspectiveCamera;
    stageGroup: THREE.Group;
    nodeRigs: Map<string, MacroGyroRigInstance>;
    linkCurves: THREE.QuadraticBezierCurve3[];
    conduitMaterials: THREE.ShaderMaterial[];
    shadowTex: THREE.Texture;
    swarmAttr: THREE.BufferAttribute;
    galaxyMat: THREE.ShaderMaterial;
    ambientMat: THREE.LineBasicMaterial;
    backdropMat: THREE.ShaderMaterial;
    floorDeckMat: THREE.ShaderMaterial;
    composerHandle: StudioComposerHandle | null;
    orbitTarget: { theta: number; phi: number; zoom: number };
    orbitCurrent: { theta: number; phi: number; zoom: number };
    mouseNdc: { x: number; y: number };
  } | null>(null);

  const rebuildConstellation = useMemo(
    () => () => {
      const refs = sceneRefs.current;
      if (!refs) return;
      const { stageGroup, nodeRigs, linkCurves, conduitMaterials, shadowTex } = refs;

      disposeObjectTree(stageGroup);
      stageGroup.clear();
      nodeRigs.clear();
      linkCurves.length = 0;
      conduitMaterials.length = 0;

      const posMap = new Map<string, THREE.Vector3>();
      for (const n of liveRef.current.nodes) {
        posMap.set(n.id, new THREE.Vector3(n.position[0], n.position[1], n.position[2]));
      }

      // Dual-layer curved optical fiber conduits between constellations
      for (const link of liveRef.current.links) {
        const p1 = posMap.get(link.fromId);
        const p2 = posMap.get(link.toId);
        if (!p1 || !p2) continue;

        const mid = p1.clone().add(p2).multiplyScalar(0.5);
        mid.y += Math.max(0.45, p1.distanceTo(p2) * 0.16);
        const curve = new THREE.QuadraticBezierCurve3(p1.clone(), mid, p2.clone());
        linkCurves.push(curve);

        const coreMat = createOpticalConduitMaterial("#38bdf8", 0.34);
        conduitMaterials.push(coreMat);
        stageGroup.add(new THREE.Mesh(new THREE.TubeGeometry(curve, 36, 0.02, 8, false), coreMat));

        const sheathMat = new THREE.MeshPhysicalMaterial({
          color: 0x1e3a8a,
          roughness: 0.12,
          transparent: true,
          opacity: 0.14,
          clearcoat: 1.0,
          depthWrite: false,
        });
        stageGroup.add(new THREE.Mesh(new THREE.TubeGeometry(curve, 36, 0.04, 8, false), sheathMat));
      }

      // Aerospace gyroscope rigs for each constellation
      for (const n of liveRef.current.nodes) {
        const pos = posMap.get(n.id) ?? new THREE.Vector3();
        const rig = buildMacroGyroRig(n.id, n.shapeKind, n.satelliteCount, pos, shadowTex);
        stageGroup.add(rig.group);
        nodeRigs.set(n.id, rig);
      }
    },
    []
  );

  useEffect(() => {
    if (displayMode !== "3d" || webglFailed) return;
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

    const width = container.clientWidth || 720;
    const height = container.clientHeight || 480;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(width, height);
    renderer.domElement.style.display = "block";
    renderer.domElement.style.width = "100%";
    renderer.domElement.style.height = "100%";
    container.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(40, width / height, 0.1, 100);
    const envRT = setupStudioEnvironment(renderer, scene);
    addStudioLighting(scene);
    const backdropMat = createBackdropDome(scene);
    const floorDeckMat = createSpatialFloorDeck(scene, -0.7, 9.6);
    const galaxyMat = createNebulaGalaxy(scene, 1050);
    const { lines: ambientConstellation, material: ambientMat } = createAmbientConstellation(scene);
    const glowTex = createRadialGlowTexture();
    const shadowTex = createContactShadowTexture();
    const composerHandle = createPostProcessingPipeline(renderer, scene, camera, width, height);

    const stageGroup = new THREE.Group();
    scene.add(stageGroup);

    const swarmPos = new Float32Array(ORBIT_PARTICLE_COUNT * 3);
    const swarmGeo = new THREE.BufferGeometry();
    const swarmAttr = new THREE.BufferAttribute(swarmPos, 3);
    swarmGeo.setAttribute("position", swarmAttr);
    const swarmMat = new THREE.PointsMaterial({
      color: 0x38bdf8,
      map: glowTex,
      size: 0.34,
      transparent: true,
      opacity: 0.9,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    scene.add(new THREE.Points(swarmGeo, swarmMat));

    sceneRefs.current = {
      scene,
      camera,
      stageGroup,
      nodeRigs: new Map(),
      linkCurves: [],
      conduitMaterials: [],
      shadowTex,
      swarmAttr,
      galaxyMat,
      ambientMat,
      backdropMat,
      floorDeckMat,
      composerHandle,
      orbitTarget: { ...DEFAULT_UNIVERSE_ORBIT },
      orbitCurrent: { ...DEFAULT_UNIVERSE_ORBIT },
      mouseNdc: { x: 0, y: 0 },
    };

    rebuildConstellation();

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
      if (Math.abs(dx) + Math.abs(dy) > 2) {
        setHasDragged(true);
      }
      sceneRefs.current.orbitTarget.theta -= dx * 0.006;
      sceneRefs.current.orbitTarget.phi = Math.max(
        0.58,
        Math.min(1.22, sceneRefs.current.orbitTarget.phi - dy * 0.005)
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
        const targets: THREE.Object3D[] = [];
        sceneRefs.current.nodeRigs.forEach((rig) => {
          targets.push(...rig.hitMeshes);
        });
        const hits = raycaster.intersectObjects(targets, false);
        if (hits.length > 0 && hits[0].object.userData?.nodeId) {
          liveRef.current.onSelectNode(hits[0].object.userData.nodeId);
        }
      }
    };

    const onWheel = (e: WheelEvent) => {
      if (!sceneRefs.current) return;
      e.preventDefault();
      sceneRefs.current.orbitTarget.zoom = Math.max(
        8.2,
        Math.min(17.2, sceneRefs.current.orbitTarget.zoom + e.deltaY * 0.006)
      );
      setHasDragged(true);
    };

    const el = renderer.domElement;
    el.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    el.addEventListener("wheel", onWheel, { passive: false });

    const resizeObserver = new ResizeObserver(() => {
      const w = container.clientWidth || 720;
      const h = container.clientHeight || 480;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
      if (sceneRefs.current?.composerHandle) {
        sceneRefs.current.composerHandle.composer.setSize(w, h);
        sceneRefs.current.composerHandle.bloomPass.setSize(w, h);
      }
    });
    resizeObserver.observe(container);

    let rafId = 0;
    const startMs = performance.now();
    let prevT = 0;
    const tmpVec = new THREE.Vector3();

    const animate = () => {
      rafId = requestAnimationFrame(animate);
      if (document.hidden) return;
      const refs = sceneRefs.current;
      if (!refs) return;

      const t = (performance.now() - startMs) * 0.001;
      const dt = Math.min(0.05, Math.max(0.001, t - prevT));
      prevT = t;

      const state = liveRef.current;
      const isLight = state.theme === "light" ? 1.0 : 0.0;

      scene.environmentIntensity = isLight ? 1.05 : 0.88;
      refs.backdropMat.uniforms.uLightMode.value = isLight;
      refs.floorDeckMat.uniforms.uTime.value = t;
      refs.floorDeckMat.uniforms.uLightMode.value = isLight;

      refs.galaxyMat.uniforms.uTime.value = t;
      refs.galaxyMat.uniforms.uMouse.value.set(refs.mouseNdc.x, refs.mouseNdc.y);
      refs.galaxyMat.uniforms.uOpacity.value = state.theme === "light" ? 0.22 : 0.84;
      refs.ambientMat.opacity = state.theme === "light" ? 0.04 : 0.08;
      ambientConstellation.rotation.y = t * 0.012;

      if (refs.composerHandle) {
        refs.composerHandle.bloomPass.strength = state.theme === "light" ? 0.14 : 0.42;
      }

      const oc = refs.orbitCurrent;
      const ot = refs.orbitTarget;
      oc.theta += (ot.theta + refs.mouseNdc.x * 0.055 - oc.theta) * 0.075;
      oc.phi += (ot.phi - refs.mouseNdc.y * 0.04 - oc.phi) * 0.075;
      oc.zoom += (ot.zoom - oc.zoom) * 0.08;

      camera.position.set(
        Math.sin(oc.theta) * Math.sin(oc.phi) * oc.zoom,
        Math.cos(oc.phi) * oc.zoom,
        Math.cos(oc.theta) * Math.sin(oc.phi) * oc.zoom
      );
      camera.lookAt(0, -0.25, 0);

      const w = container.clientWidth || 720;
      const h = container.clientHeight || 480;

      const chassisHex = isLight ? 0x64748b : 0x131a2b;
      const glassHex = isLight ? 0x7dd3fc : 0x0b1c3d;

      state.nodes.forEach((n, idx) => {
        const rig = refs.nodeRigs.get(n.id);
        if (!rig) return;
        const isSel = state.selectedId === n.id;

        for (const m of rig.chassisMaterials) m.color.setHex(chassisHex);
        for (const g of rig.glassMaterials) g.color.setHex(glassHex);

        const bob = Math.sin(t * 1.2 + idx * 0.9) * 0.045;
        rig.group.position.y = rig.basePos.y + bob + (isSel ? 0.16 : 0);

        const spinSpeed = isSel ? 0.85 : 0.32;
        rig.coreGlass.rotation.y += dt * spinSpeed * 0.45;
        rig.coreJewel.rotation.y -= dt * spinSpeed * 1.1;
        rig.gimbalInner.rotation.y += dt * spinSpeed * 0.9;
        rig.gimbalOuter.rotation.z -= dt * spinSpeed * 0.65;

        rig.satellites.forEach((sat, sIdx) => {
          const angle = t * 0.8 + sIdx * ((Math.PI * 2) / Math.max(1, rig.satellites.length));
          const rad = isSel ? 1.06 : 0.92;
          sat.position.set(Math.cos(angle) * rad, Math.sin(angle * 1.3) * 0.18, Math.sin(angle) * rad);
          sat.rotation.y = t * 1.4;
          sat.rotation.x = t * 0.8;
        });

        const glowColor =
          n.status === "completed"
            ? "#34d399"
            : isSel
            ? "#38bdf8"
            : n.status === "in_progress"
            ? "#818cf8"
            : "#60a5fa";
        const emissiveInt = isSel ? 1.95 : n.status === "completed" ? 1.5 : 1.05;

        for (const em of rig.emissiveMaterials) {
          em.color.set(glowColor);
          em.emissive.set(glowColor);
          em.emissiveIntensity = emissiveInt;
        }

        const rMat = rig.haloRing.material as THREE.MeshBasicMaterial;
        rMat.color.set(glowColor);
        rMat.opacity = isSel ? 0.72 : n.status === "completed" ? 0.4 : 0.22;
        rig.haloRing.scale.setScalar(isSel ? 1.14 + Math.sin(t * 2.8) * 0.06 : 1.0);

        const domEl = labelRefs.current.get(n.id);
        if (domEl) {
          tmpVec.copy(rig.group.position);
          tmpVec.y -= 0.86;
          tmpVec.project(camera);
          if (tmpVec.z < 1) {
            const rawX = (tmpVec.x * 0.5 + 0.5) * w;
            const rawY = (-tmpVec.y * 0.5 + 0.5) * h;
            const sx = Math.round(Math.max(82, Math.min(w - 82, rawX)));
            const sy = Math.round(Math.max(66, Math.min(h - 46, rawY)));
            domEl.style.transform = `translate3d(${sx}px, ${sy}px, 0) translate(-50%, 0)`;
            domEl.style.opacity = "1";
          } else {
            domEl.style.opacity = "0";
          }
        }
      });

      for (const cMat of refs.conduitMaterials) {
        cMat.uniforms.uTime.value = t;
      }

      if (refs.linkCurves.length > 0) {
        const arr = refs.swarmAttr.array as Float32Array;
        const perLink = Math.max(1, Math.floor(ORBIT_PARTICLE_COUNT / refs.linkCurves.length));
        let idx = 0;
        for (let lIdx = 0; lIdx < refs.linkCurves.length && idx < ORBIT_PARTICLE_COUNT; lIdx++) {
          const curve = refs.linkCurves[lIdx];
          for (let k = 0; k < perLink && idx < ORBIT_PARTICLE_COUNT; k++) {
            const u = ((t * 0.22 + k / perLink + lIdx * 0.14) % 1 + 1) % 1;
            const pt = curve.getPoint(u);
            arr[idx * 3] = pt.x;
            arr[idx * 3 + 1] = pt.y;
            arr[idx * 3 + 2] = pt.z;
            idx++;
          }
        }
        refs.swarmAttr.needsUpdate = true;
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
  }, [displayMode, webglFailed, rebuildConstellation]);

  useEffect(() => {
    rebuildConstellation();
  }, [nodes, links, rebuildConstellation]);

  useEffect(() => {
    const refs = sceneRefs.current;
    if (!refs) return;
    const node = nodes.find((n) => n.id === selectedId);
    if (!node) return;
    const targetAzimuth = Math.atan2(node.position[0], node.position[2]) * 0.45;
    const delta = shortestAngleDelta(refs.orbitTarget.theta, targetAzimuth);
    refs.orbitTarget.theta += delta;
  }, [selectedId, nodes]);

  if (displayMode === "2d" || webglFailed) {
    return (
      <div
        className="blueprint-grid"
        style={{
          flex: 1,
          padding: "70px 20px 24px",
          overflowY: "auto",
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))",
          gap: 12,
          alignContent: "start",
        }}
      >
        {nodes.map((n) => {
          const isSel = selectedId === n.id;
          return (
            <button
              key={n.id}
              onClick={() => onSelectNode(n.id)}
              className="card card-interactive"
              style={{
                textAlign: "left",
                cursor: "pointer",
                borderColor: isSel
                  ? "var(--accent)"
                  : n.status === "completed"
                  ? "var(--success)"
                  : undefined,
                background: isSel ? "var(--bg-active-card)" : undefined,
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                <span className="badge badge-accent">{n.code}</span>
                {n.status === "completed" && (
                  <span className="badge badge-success">
                    <CheckCircle2 size={10} /> DONE
                  </span>
                )}
              </div>
              <div className="mono" style={{ fontSize: 13, fontWeight: 700, color: "var(--ink-primary)" }}>
                {n.shortLabel}
              </div>
              <div className="mono" style={{ fontSize: 11, color: "var(--ink-muted)", marginTop: 4 }}>
                {n.subtitle}
              </div>
            </button>
          );
        })}
      </div>
    );
  }

  return (
    <div
      style={{
        position: "relative",
        flex: 1,
        overflow: "hidden",
        background: theme === "dark" ? "#03050c" : "#eef2ff",
        cursor: "grab",
      }}
    >
      <div ref={hostRef} style={{ position: "absolute", inset: 0 }} />

      {/* Projected frosted glass node labels */}
      <div style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
        {nodes.map((n) => {
          const isSel = selectedId === n.id;
          const isDone = n.status === "completed";
          return (
            <button
              key={n.id}
              ref={(el) => {
                if (el) labelRefs.current.set(n.id, el);
                else labelRefs.current.delete(n.id);
              }}
              onClick={() => onSelectNode(n.id)}
              style={{
                position: "absolute",
                left: 0,
                top: 0,
                opacity: 0,
                willChange: "transform, opacity",
                pointerEvents: "auto",
                padding: "5px 11px",
                borderRadius: 10,
                zIndex: isSel ? 5 : 1,
                border: isSel
                  ? "1px solid rgba(56, 189, 248, 0.9)"
                  : isDone
                  ? "1px solid rgba(52, 211, 153, 0.6)"
                  : "1px solid var(--border)",
                background:
                  theme === "dark"
                    ? isSel
                      ? "rgba(12, 24, 52, 0.9)"
                      : "rgba(8, 13, 28, 0.8)"
                    : "rgba(255, 255, 255, 0.92)",
                backdropFilter: "blur(12px)",
                color: "var(--ink-primary)",
                cursor: "pointer",
                textAlign: "center",
                boxShadow: isSel
                  ? "0 0 22px rgba(56, 189, 248, 0.42)"
                  : "0 4px 14px rgba(2, 6, 23, 0.3)",
              }}
            >
              <div
                className="mono"
                style={{
                  fontSize: 10.5,
                  fontWeight: 700,
                  whiteSpace: "nowrap",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 5,
                }}
              >
                <span style={{ color: isDone ? "var(--success)" : "var(--accent)" }}>{n.code}</span>
                <span>{truncateText(n.shortLabel, 22)}</span>
              </div>
              <div className="mono" style={{ fontSize: 9, color: "var(--ink-muted)", whiteSpace: "nowrap" }}>
                {n.subtitle}
              </div>
            </button>
          );
        })}
      </div>

      {/* Bottom-left orbit hint & reset camera trigger */}
      <div
        style={{
          position: "absolute",
          bottom: 14,
          left: 14,
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
              background: theme === "dark" ? "rgba(8, 12, 24, 0.65)" : "rgba(255, 255, 255, 0.8)",
              border: "1px solid var(--border-soft)",
              color: "var(--ink-muted)",
              backdropFilter: "blur(8px)",
            }}
          >
            Drag to orbit · Scroll zoom · Click constellation to focus
          </span>
        )}
        {hasDragged && (
          <button
            className="icon-btn"
            style={{ height: 24, fontSize: 9.5, borderRadius: 99 }}
            onClick={() => {
              if (sceneRefs.current) {
                sceneRefs.current.orbitTarget = { ...DEFAULT_UNIVERSE_ORBIT };
                setHasDragged(false);
              }
            }}
          >
            <RotateCcw size={10} /> Reset Orbit
          </button>
        )}
      </div>
    </div>
  );
};
