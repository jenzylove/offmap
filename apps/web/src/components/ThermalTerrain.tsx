"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { ShaderPass } from "three/examples/jsm/postprocessing/ShaderPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { HorizontalTiltShiftShader } from "three/examples/jsm/shaders/HorizontalTiltShiftShader.js";
import { VerticalTiltShiftShader } from "three/examples/jsm/shaders/VerticalTiltShiftShader.js";

/** One public loan on the map: where it liquidates relative to today's price, and how big it is. */
export interface TerrainPoint {
  /** Liquidation price divided by today's price. 1 = liquidates now. */
  ratio: number;
  debtUsd: number;
  /** Stable 0..1 used for depth placement. */
  lane: number;
}

export type TerrainPhase = "drop" | "target" | "cool" | "gone";

export interface TerrainTick {
  ratio: number;
  label: string;
}

const BG = new THREE.Color("#0b0c0e");
const W = 22; // x extent: price axis
const D = 13; // z extent: depth
const GX = 200;
const GZ = 118;
export const RATIO_LO = 0.36;
export const RATIO_HI = 1.03;
const PEAK = 2.3;

const xOf = (ratio: number) => ((ratio - RATIO_LO) / (RATIO_HI - RATIO_LO) - 0.5) * W;
const zOf = (lane: number) => (lane - 0.5) * D * 0.86;

/** Debt piled into a grid, blurred into terrain. Returns normalized heights 0..1 per vertex. */
function heightField(points: TerrainPoint[]): Float32Array {
  const nx = GX + 1;
  const nz = GZ + 1;
  const g = new Float32Array(nx * nz);
  for (const p of points) {
    if (p.ratio < RATIO_LO || p.ratio > RATIO_HI) continue;
    const ix = Math.round(((xOf(p.ratio) + W / 2) / W) * GX);
    const iz = Math.round(((zOf(p.lane) + D / 2) / D) * GZ);
    if (ix < 0 || ix > GX || iz < 0 || iz > GZ) continue;
    g[iz * nx + ix]! += Math.sqrt(p.debtUsd);
  }
  const blur = (src: Float32Array, sigma: number, horizontal: boolean) => {
    const r = Math.ceil(sigma * 3);
    const k: number[] = [];
    for (let i = -r; i <= r; i++) k.push(Math.exp(-(i * i) / (2 * sigma * sigma)));
    const out = new Float32Array(src.length);
    for (let z = 0; z < nz; z++)
      for (let x = 0; x < nx; x++) {
        let s = 0;
        for (let i = -r; i <= r; i++) {
          const xx = horizontal ? x + i : x;
          const zz = horizontal ? z : z + i;
          if (xx < 0 || xx >= nx || zz < 0 || zz >= nz) continue;
          s += src[zz * nx + xx]! * k[i + r]!;
        }
        out[z * nx + x] = s;
      }
    return out;
  };
  const h = blur(blur(g, 2.2, true), 3.6, false);
  // a second, wider pass gives the ridges a low shoulder
  const wide = blur(blur(g, 8, true), 10, false);
  let max = 1e-9;
  let wmax = 1e-9;
  for (let i = 0; i < h.length; i++) {
    if (h[i]! > max) max = h[i]!;
    if (wide[i]! > wmax) wmax = wide[i]!;
  }
  for (let i = 0; i < h.length; i++) h[i] = Math.pow(h[i]! / max, 1.15) * 0.85 + Math.pow(wide[i]! / wmax, 1.4) * 0.15;
  return h;
}

const terrainVert = /* glsl */ `
  attribute float heat;
  varying float vHeat;
  varying vec3 vWorld;
  varying vec3 vNormal;
  varying float vDepth;
  void main() {
    vHeat = heat;
    vec4 w = modelMatrix * vec4(position, 1.0);
    vWorld = w.xyz;
    vNormal = normalize(mat3(modelMatrix) * normal);
    vec4 mv = viewMatrix * w;
    vDepth = -mv.z;
    gl_Position = projectionMatrix * mv;
  }
`;

const terrainFrag = /* glsl */ `
  uniform vec3 uBg;
  uniform float uFog;
  uniform float uTime;
  uniform float uReveal;
  varying float vHeat;
  varying vec3 vWorld;
  varying vec3 vNormal;
  varying float vDepth;

  vec3 ramp(float h) {
    vec3 c0 = vec3(0.030, 0.034, 0.040);
    vec3 c1 = vec3(0.16, 0.025, 0.10);
    vec3 c2 = vec3(0.78, 0.09, 0.33);
    vec3 c3 = vec3(1.0, 0.30, 0.08);
    vec3 c4 = vec3(1.0, 0.66, 0.36);
    vec3 c = mix(c0, c1, smoothstep(0.04, 0.2, h));
    c = mix(c, c2, smoothstep(0.16, 0.38, h));
    c = mix(c, c3, smoothstep(0.38, 0.68, h));
    c = mix(c, c4, smoothstep(0.82, 1.0, h));
    return c;
  }

  void main() {
    float h = vHeat * uReveal;
    vec3 n = normalize(vNormal);
    vec3 L = normalize(vec3(-0.4, 0.9, 0.35));
    float diff = clamp(dot(n, L), 0.0, 1.0) * 0.7 + 0.3;
    vec3 col = ramp(h) * diff;

    // contour lines, like a survey sheet
    float k = vWorld.y * 5.0;
    float f = abs(fract(k) - 0.5);
    float lf = 1.0 - smoothstep(0.0, fwidth(k) * 1.2, 0.5 - f);
    vec3 cold = vec3(0.50, 0.91, 1.0);
    vec3 lineCol = mix(cold * 0.16, ramp(min(1.0, h + 0.2)) * 0.9, smoothstep(0.08, 0.3, h));
    col += lineCol * lf * 0.55;

    // survey grid on the cold ground
    vec2 gp = vWorld.xz;
    vec2 gw = fwidth(gp);
    vec2 gg = abs(fract(gp + 0.5) - 0.5) / gw;
    float grid = 1.0 - clamp(min(gg.x, gg.y), 0.0, 1.0);
    col += cold * grid * 0.07 * (1.0 - smoothstep(0.1, 0.4, h));

    // heat glows on its own so bloom picks up the peaks
    col += ramp(h) * smoothstep(0.6, 1.0, h) * 0.55;

    float fogF = 1.0 - exp(-uFog * uFog * vDepth * vDepth);
    col = mix(col, uBg, clamp(fogF, 0.0, 1.0));
    gl_FragColor = vec4(col, 1.0);
  }
`;

const glowVert = /* glsl */ `
  attribute float size;
  attribute vec3 color;
  attribute float alpha;
  varying vec3 vColor;
  varying float vAlpha;
  uniform float uPixel;
  void main() {
    vColor = color;
    vAlpha = alpha;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = size * uPixel * (14.0 / -mv.z);
    gl_Position = projectionMatrix * mv;
  }
`;
const glowFrag = /* glsl */ `
  varying vec3 vColor;
  varying float vAlpha;
  void main() {
    vec2 p = gl_PointCoord - 0.5;
    float d = length(p) * 2.0;
    float core = smoothstep(0.32, 0.0, d);
    float halo = smoothstep(1.0, 0.0, d) * 0.45;
    float a = (core + halo * halo) * vAlpha;
    if (a < 0.004) discard;
    gl_FragColor = vec4(vColor * (core * 1.6 + halo), a);
  }
`;

const HOT = new THREE.Color("#ff5b1f");
const MAG = new THREE.Color("#ff2d78");
const AMBER = new THREE.Color("#ffc07a");
const COLD = new THREE.Color("#7fe9ff");

function heatColor(t: number) {
  const c = new THREE.Color();
  if (t < 0.5) c.copy(MAG).lerp(HOT, t * 2);
  else c.copy(HOT).lerp(AMBER, (t - 0.5) * 2);
  return c;
}

export function ThermalTerrain({
  points,
  cohortRatio,
  animate = true,
  onPhase,
  ticks = [],
  className = "",
  camera: camPreset = "hero",
}: {
  points: TerrainPoint[] | null;
  cohortRatio: number | null;
  animate?: boolean;
  onPhase?: (p: TerrainPhase) => void;
  ticks?: TerrainTick[];
  className?: string;
  camera?: "hero" | "flat";
}) {
  const host = useRef<HTMLDivElement>(null);
  const labels = useRef<HTMLDivElement>(null);
  const api = useRef<{ setData: (p: TerrainPoint[], c: number | null) => void } | null>(null);
  const phaseCb = useRef(onPhase);
  phaseCb.current = onPhase;

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance", alpha: false });
    } catch {
      el.dataset.webgl = "off";
      return;
    }
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const dpr = Math.min(window.devicePixelRatio || 1, 1.75);
    renderer.setPixelRatio(dpr);
    renderer.setClearColor(BG, 1);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 0.95;
    el.appendChild(renderer.domElement);
    renderer.domElement.style.display = "block";
    renderer.domElement.style.width = "100%";
    renderer.domElement.style.height = "100%";

    const scene = new THREE.Scene();
    scene.background = BG;
    const camera = new THREE.PerspectiveCamera(34, 1, 0.1, 120);

    /* terrain */
    const geo = new THREE.PlaneGeometry(W, D, GX, GZ);
    geo.rotateX(-Math.PI / 2);
    const heatAttr = new THREE.BufferAttribute(new Float32Array((GX + 1) * (GZ + 1)), 1);
    geo.setAttribute("heat", heatAttr);
    const base = new Float32Array(geo.attributes.position!.count);
    {
      const pos = geo.attributes.position!;
      for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i);
        const z = pos.getZ(i);
        base[i] = (Math.sin(x * 0.9 + z * 0.4) * Math.cos(z * 0.7 - x * 0.2) + Math.sin(x * 2.1 - z * 1.7) * 0.35) * 0.07;
      }
    }
    let target: Float32Array = new Float32Array(base.length);
    let current: Float32Array = new Float32Array(base.length);
    const terrainMat = new THREE.ShaderMaterial({
      vertexShader: terrainVert,
      fragmentShader: terrainFrag,
      uniforms: { uBg: { value: BG }, uFog: { value: 0.045 }, uTime: { value: 0 }, uReveal: { value: 1 } },
    });
    const terrain = new THREE.Mesh(geo, terrainMat);
    scene.add(terrain);

    const applyHeights = () => {
      const pos = geo.attributes.position!;
      for (let i = 0; i < pos.count; i++) {
        pos.setY(i, base[i]! + current[i]! * PEAK);
        heatAttr.setX(i, current[i]!);
      }
      pos.needsUpdate = true;
      heatAttr.needsUpdate = true;
      geo.computeVertexNormals();
    };
    applyHeights();

    const surfaceAt = (x: number, z: number, field: Float32Array = current) => {
      const ix = Math.max(0, Math.min(GX, Math.round(((x + W / 2) / W) * GX)));
      const iz = Math.max(0, Math.min(GZ, Math.round(((z + D / 2) / D) * GZ)));
      const i = iz * (GX + 1) + ix;
      return base[i]! + field[i]! * PEAK;
    };

    /* pins: one glow per large public loan */
    const MAXPINS = 90;
    const pinGeo = new THREE.BufferGeometry();
    const pinPos = new Float32Array(MAXPINS * 3);
    const pinCol = new Float32Array(MAXPINS * 3);
    const pinSize = new Float32Array(MAXPINS);
    const pinAlpha = new Float32Array(MAXPINS);
    pinGeo.setAttribute("position", new THREE.BufferAttribute(pinPos, 3));
    pinGeo.setAttribute("color", new THREE.BufferAttribute(pinCol, 3));
    pinGeo.setAttribute("size", new THREE.BufferAttribute(pinSize, 1));
    pinGeo.setAttribute("alpha", new THREE.BufferAttribute(pinAlpha, 1));
    const glowMat = new THREE.ShaderMaterial({
      vertexShader: glowVert,
      fragmentShader: glowFrag,
      uniforms: { uPixel: { value: dpr } },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const pins = new THREE.Points(pinGeo, glowMat);
    scene.add(pins);

    const stemGeo = new THREE.BufferGeometry();
    const stemPos = new Float32Array(MAXPINS * 6);
    const stemCol = new Float32Array(MAXPINS * 6);
    stemGeo.setAttribute("position", new THREE.BufferAttribute(stemPos, 3));
    stemGeo.setAttribute("color", new THREE.BufferAttribute(stemCol, 3));
    const stems = new THREE.LineSegments(stemGeo, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false }));
    scene.add(stems);
    let pinList: { x: number; z: number; t: number; debt: number }[] = [];

    const placePins = () => {
      const n = Math.min(MAXPINS, pinList.length);
      for (let i = 0; i < MAXPINS; i++) {
        const p = pinList[i];
        if (!p || i >= n) {
          pinAlpha[i] = 0;
          stemPos.fill(0, i * 6, i * 6 + 6);
          continue;
        }
        const y = surfaceAt(p.x, p.z);
        const lift = 0.35 + p.t * 0.9;
        pinPos.set([p.x, y + lift, p.z], i * 3);
        const c = heatColor(p.t);
        pinCol.set([c.r, c.g, c.b], i * 3);
        pinSize[i] = 2.4 + p.t * 4;
        pinAlpha[i] = 0.45 + p.t * 0.5;
        stemPos.set([p.x, y, p.z, p.x, y + lift, p.z], i * 6);
        stemCol.set([c.r * 0.2, c.g * 0.2, c.b * 0.2, c.r, c.g, c.b], i * 6);
      }
      pinGeo.attributes.position!.needsUpdate = true;
      pinGeo.attributes.color!.needsUpdate = true;
      pinGeo.attributes.size!.needsUpdate = true;
      pinGeo.attributes.alpha!.needsUpdate = true;
      stemGeo.attributes.position!.needsUpdate = true;
      stemGeo.attributes.color!.needsUpdate = true;
    };

    /* the Offmap cohort: one cold point, one beacon */
    const coldGeo = new THREE.BufferGeometry();
    const coldPos = new Float32Array(3);
    coldGeo.setAttribute("position", new THREE.BufferAttribute(coldPos, 3));
    coldGeo.setAttribute("color", new THREE.BufferAttribute(new Float32Array([COLD.r, COLD.g, COLD.b]), 3));
    const coldSize = new THREE.BufferAttribute(new Float32Array([16]), 1);
    coldGeo.setAttribute("size", coldSize);
    coldGeo.setAttribute("alpha", new THREE.BufferAttribute(new Float32Array([1]), 1));
    const cold = new THREE.Points(coldGeo, glowMat);
    scene.add(cold);
    const beaconGeo = new THREE.BufferGeometry();
    const beaconPos = new Float32Array(6);
    beaconGeo.setAttribute("position", new THREE.BufferAttribute(beaconPos, 3));
    const beacon = new THREE.Line(beaconGeo, new THREE.LineBasicMaterial({ color: COLD, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false }));
    scene.add(beacon);
    const coldRing = new THREE.Mesh(
      new THREE.RingGeometry(0.42, 0.47, 64),
      new THREE.MeshBasicMaterial({ color: COLD, transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }),
    );
    coldRing.rotation.x = -Math.PI / 2;
    scene.add(coldRing);
    let coldX = xOf(0.42);
    const coldZ = -D * 0.05;
    const placeCold = () => {
      const y = surfaceAt(coldX, coldZ);
      coldPos.set([coldX, y + 0.7, coldZ]);
      coldGeo.attributes.position!.needsUpdate = true;
      beaconPos.set([coldX, y, coldZ, coldX, y + 4.2, coldZ]);
      beaconGeo.attributes.position!.needsUpdate = true;
      coldRing.position.set(coldX, y + 0.03, coldZ);
    };

    /* the loop: a new loan drops in hot, gets targeted, cools, sinks */
    const actorGeo = new THREE.BufferGeometry();
    const actorPos = new Float32Array(6);
    const actorCol = new Float32Array(6);
    const actorSize = new Float32Array([14, 5]);
    const actorAlpha = new Float32Array([0, 0]);
    actorGeo.setAttribute("position", new THREE.BufferAttribute(actorPos, 3));
    actorGeo.setAttribute("color", new THREE.BufferAttribute(actorCol, 3));
    actorGeo.setAttribute("size", new THREE.BufferAttribute(actorSize, 1));
    actorGeo.setAttribute("alpha", new THREE.BufferAttribute(actorAlpha, 1));
    const actor = new THREE.Points(actorGeo, glowMat);
    scene.add(actor);
    const ringMat = new THREE.MeshBasicMaterial({ color: HOT, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
    const rings = [0, 1, 2].map(() => {
      const r = new THREE.Mesh(new THREE.RingGeometry(0.9, 0.96, 72), ringMat.clone());
      r.rotation.x = -Math.PI / 2;
      scene.add(r);
      return r;
    });
    const crossMat = new THREE.LineBasicMaterial({ color: HOT, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
    const crossGeo = new THREE.BufferGeometry();
    crossGeo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(12), 3));
    const cross = new THREE.LineSegments(crossGeo, crossMat);
    scene.add(cross);

    let actorX = 0;
    let actorZ = 0;
    let actorGround = 0;
    const pickSpot = () => {
      const pool = pinList.slice(0, 24);
      const p = pool.length ? pool[Math.floor(Math.random() * pool.length)]! : { x: (Math.random() - 0.2) * W * 0.4, z: (Math.random() - 0.5) * D * 0.5 };
      actorX = THREE.MathUtils.clamp(p.x + (Math.random() - 0.5) * 1.6, -W / 2 + 2, W / 2 - 1.5);
      actorZ = THREE.MathUtils.clamp(p.z + (Math.random() - 0.5) * 1.6, -D / 2 + 2, D / 2 - 2.5);
      actorGround = surfaceAt(actorX, actorZ, target);
    };
    pickSpot();

    const CYCLE = 8.2;
    let cycleStart = 0;
    let lastPhase: TerrainPhase | null = null;
    const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
    const outBack = (t: number) => {
      const c1 = 1.4;
      const c3 = c1 + 1;
      return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
    };

    const stepActor = (time: number) => {
      if (!cycleStart) cycleStart = time;
      let t = time - cycleStart;
      if (t > CYCLE) {
        cycleStart = time;
        t = 0;
        pickSpot();
      }
      let phase: TerrainPhase;
      const hot = new THREE.Color();
      let y = actorGround + 0.9;
      let alpha = 1;
      let size = 14;
      let ringO = 0;
      let crossO = 0;
      let trail = 0;
      if (t < 1.1) {
        phase = "drop";
        const k = outBack(Math.min(1, t / 1.1));
        y = actorGround + 0.9 + (1 - k) * 6;
        hot.copy(AMBER).lerp(HOT, k);
        size = 10 + k * 6;
        alpha = Math.min(1, t * 3);
      } else if (t < 3.4) {
        phase = "target";
        hot.copy(HOT).lerp(MAG, 0.5 + 0.5 * Math.sin(t * 6));
        ringO = 1;
        crossO = Math.min(1, (t - 1.1) * 2);
        size = 16 + Math.sin(t * 6) * 2;
      } else if (t < 5.0) {
        phase = "cool";
        const k = ease((t - 3.4) / 1.6);
        hot.copy(HOT).lerp(COLD, k);
        ringO = 1 - k;
        crossO = 1 - k;
        size = 16 - k * 4;
      } else if (t < 6.6) {
        phase = "gone";
        const k = ease((t - 5.0) / 1.6);
        hot.copy(COLD);
        y = actorGround + 0.9 - k * 2.6;
        alpha = 1 - k;
        size = 12 - k * 6;
        trail = k;
      } else {
        phase = "gone";
        alpha = 0;
        trail = 1;
      }
      if (phase !== lastPhase) {
        lastPhase = phase;
        phaseCb.current?.(phase);
      }
      actorPos.set([actorX, y, actorZ], 0);
      actorCol.set([hot.r, hot.g, hot.b], 0);
      actorSize[0] = size;
      actorAlpha[0] = alpha;
      // a cold spark travels from the sunk loan into the cohort point
      if (trail > 0 && trail < 1) {
        const sx = THREE.MathUtils.lerp(actorX, coldX, trail);
        const sz = THREE.MathUtils.lerp(actorZ, coldZ, trail);
        const sy = THREE.MathUtils.lerp(actorGround, surfaceAt(coldX, coldZ) + 0.7, trail) + Math.sin(trail * Math.PI) * 1.6;
        actorPos.set([sx, sy, sz], 3);
        actorCol.set([COLD.r, COLD.g, COLD.b], 3);
        actorAlpha[1] = Math.sin(trail * Math.PI);
      } else actorAlpha[1] = 0;
      actorGeo.attributes.position!.needsUpdate = true;
      actorGeo.attributes.color!.needsUpdate = true;
      actorGeo.attributes.size!.needsUpdate = true;
      actorGeo.attributes.alpha!.needsUpdate = true;

      rings.forEach((r, i) => {
        const k = ((t * 0.7 + i / 3) % 1 + 1) % 1;
        r.position.set(actorX, actorGround + 0.05, actorZ);
        r.scale.setScalar(0.3 + k * 1.6);
        const m = r.material as THREE.MeshBasicMaterial;
        m.color.copy(hot);
        m.opacity = ringO * (1 - k) * 0.85;
      });
      const cp = crossGeo.attributes.position as THREE.BufferAttribute;
      const L = 0.55;
      const yy = actorGround + 0.9;
      cp.set([actorX - L * 2.2, yy, actorZ, actorX - L, yy, actorZ, actorX + L, yy, actorZ, actorX + L * 2.2, yy, actorZ], 0);
      cp.needsUpdate = true;
      crossMat.color.copy(hot);
      crossMat.opacity = crossO * 0.9;

      // the cohort breathes, and brightens when a loan joins it
      const join = trail > 0.8 && trail < 1 ? (trail - 0.8) * 5 : t > 6.6 && t < 7.4 ? 1 - (t - 6.6) / 0.8 : 0;
      coldSize.setX(0, 16 + Math.sin(time * 1.8) * 1.6 + join * 12);
      coldSize.needsUpdate = true;
      coldRing.scale.setScalar(1 + join * 1.2 + Math.sin(time * 1.8) * 0.05);
      (coldRing.material as THREE.MeshBasicMaterial).opacity = 0.45 + join * 0.5;
    };

    /* post: bloom for the glow, tilt shift for a miniature map's depth of field */
    const composer = new EffectComposer(renderer);
    composer.addPass(new RenderPass(scene, camera));
    const bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.7, 0.45, 0.62);
    composer.addPass(bloom);
    const hts = new ShaderPass(HorizontalTiltShiftShader);
    const vts = new ShaderPass(VerticalTiltShiftShader);
    hts.uniforms.r!.value = 0.5;
    vts.uniforms.r!.value = 0.5;
    composer.addPass(hts);
    composer.addPass(vts);
    composer.addPass(new OutputPass());

    let width = 1;
    let height = 1;
    const resize = () => {
      width = Math.max(1, el.clientWidth);
      height = Math.max(1, el.clientHeight);
      renderer.setSize(width, height, false);
      composer.setSize(width, height);
      bloom.resolution.set(width / 2, height / 2);
      camera.aspect = width / height;
      const narrow = camera.aspect < 0.9;
      camera.fov = narrow ? 52 : 34;
      camera.updateProjectionMatrix();
      hts.uniforms.h!.value = 1.6 / width;
      vts.uniforms.v!.value = 1.6 / height;
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(el);

    const mouse = { x: 0, y: 0, tx: 0, ty: 0 };
    const onMove = (e: PointerEvent) => {
      const r = el.getBoundingClientRect();
      mouse.tx = ((e.clientX - r.left) / r.width - 0.5) * 2;
      mouse.ty = ((e.clientY - r.top) / r.height - 0.5) * 2;
    };
    window.addEventListener("pointermove", onMove, { passive: true });

    const tickEls = labels.current ? Array.from(labels.current.children) as HTMLElement[] : [];
    const v3 = new THREE.Vector3();
    const placeLabels = () => {
      tickEls.forEach((node) => {
        const ratio = Number(node.dataset.ratio);
        v3.set(xOf(ratio), 0.02, D / 2 - 0.4).project(camera);
        const x = (v3.x * 0.5 + 0.5) * width;
        const y = (-v3.y * 0.5 + 0.5) * height;
        const vis = v3.z < 1 && x > 8 && x < width - 8 && y < height - 8;
        node.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
        node.style.opacity = vis ? "1" : "0";
      });
    };

    let reveal = 0;
    let revealing = false;
    api.current = {
      setData(points, cohortRatio) {
        target = heightField(points);
        // biggest loans first, as pins
        pinList = [...points]
          .filter((p) => p.ratio >= RATIO_LO && p.ratio <= RATIO_HI)
          .sort((a, b) => b.debtUsd - a.debtUsd)
          .slice(0, MAXPINS)
          .map((p, i, arr) => ({ x: xOf(p.ratio), z: zOf(p.lane), debt: p.debtUsd, t: Math.pow(1 - i / Math.max(1, arr.length), 1.4) }));
        coldX = xOf(Math.max(RATIO_LO + 0.1, Math.min(RATIO_HI - 0.05, cohortRatio ?? 0.42)));
        if (reduced) {
          current = target.slice();
          applyHeights();
          placePins();
          placeCold();
        } else {
          reveal = 0;
          revealing = true;
        }
        pickSpot();
      },
    };

    let raf = 0;
    let visible = true;
    const io = new IntersectionObserver(([e]) => {
      visible = !!e?.isIntersecting;
      if (visible && !raf) raf = requestAnimationFrame(frame);
    });
    io.observe(el);
    const clock = new THREE.Clock();
    const from = new Float32Array(base.length);

    // adaptive quality: a slow GPU drops the post effects and resolution instead of stuttering
    let quality: "high" | "low" = "high";
    const forceHigh = new URLSearchParams(window.location.search).has("hq");
    let frames = 0;
    let slowSum = 0;
    let lastT = performance.now();
    let revealStart = 0;

    function frame() {
      raf = 0;
      const now = performance.now();
      const dt = now - lastT;
      lastT = now;
      if (quality === "high" && frames > 2 && !forceHigh) {
        slowSum += dt;
        if (frames === 8) {
          if (slowSum / 5 > 48) {
            quality = "low";
            renderer.setPixelRatio(Math.min(dpr, 0.8));
            resize();
          }
        }
      }
      frames++;
      const time = clock.getElapsedTime();
      if (revealing) {
        if (reveal === 0) {
          from.set(current);
          revealStart = now;
        }
        reveal = Math.min(1, Math.max(0.0001, (now - revealStart) / 1700));
        const k = ease(reveal);
        for (let i = 0; i < current.length; i++) current[i] = from[i]! + (target[i]! - from[i]!) * k;
        applyHeights();
        placePins();
        placeCold();
        if (reveal >= 1) revealing = false;
      }
      mouse.x += (mouse.tx - mouse.x) * 0.04;
      mouse.y += (mouse.ty - mouse.y) * 0.04;
      const narrow = camera.aspect < 0.9;
      const drift = reduced ? 0 : time * 0.05;
      if (camPreset === "flat") {
        camera.position.set(Math.sin(drift) * 1.2 + mouse.x * 0.8, 15.5 - mouse.y * 0.5, 10.5);
        camera.lookAt(0, 0, 0.6);
      } else {
        const r = narrow ? 17 : 15.5;
        const a = -0.16 + Math.sin(drift) * 0.1 + mouse.x * 0.06;
        camera.position.set(Math.sin(a) * r, (narrow ? 12 : 9.2) - mouse.y * 0.5, Math.cos(a) * r);
        camera.lookAt(narrow ? -0.6 : -3.2, narrow ? 2.4 : 1.6, narrow ? -0.6 : -1.2);
      }
      if (animate && !reduced) stepActor(time);
      placeLabels();
      if (quality === "high") composer.render();
      else renderer.render(scene, camera);
      if (visible && !(reduced && !revealing)) raf = requestAnimationFrame(frame);
    }
    placeCold();
    raf = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(raf);
      io.disconnect();
      ro.disconnect();
      window.removeEventListener("pointermove", onMove);
      api.current = null;
      scene.traverse((o) => {
        const m = o as THREE.Mesh;
        m.geometry?.dispose?.();
        const mat = m.material as THREE.Material | THREE.Material[] | undefined;
        if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
        else mat?.dispose?.();
      });
      composer.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [animate, camPreset]);

  useEffect(() => {
    if (points && api.current) api.current.setData(points, cohortRatio);
  }, [points, cohortRatio]);

  return (
    <div className={className || "relative"}>
      <div ref={host} className="absolute inset-0" aria-hidden="true" />
      <div ref={labels} className="pointer-events-none absolute inset-0" aria-hidden="true">
        {ticks.map((t) => (
          <div key={t.ratio} data-ratio={t.ratio} className="num absolute left-0 top-0 -ml-6 whitespace-nowrap text-[10px] uppercase tracking-[0.14em] text-ink-3 opacity-0 transition-opacity">
            <span className="mb-1 block h-2 w-px bg-[var(--ink-3)]" />
            {t.label}
          </div>
        ))}
      </div>
    </div>
  );
}
