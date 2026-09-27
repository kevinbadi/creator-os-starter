"use client";

import { useEffect, useLayoutEffect, useRef } from "react";
import { neighborhood, TYPE_META, type BNode, type BrainModel } from "./brain-model";

/**
 * Orbital renderer. Marketing OS is the sun; every node type is a planet
 * ring on its own tilted plane (inner = engine, outer = audience), dense
 * types spread into belts. Positions are parametric in time, so the system
 * never stops moving. Edges are drawn between orbiting bodies and pulses
 * travel along them.
 */

type Props = {
  model: BrainModel;
  visible: boolean[];
  selected: number | null;
  emphasis: Set<number> | null;
  paused: boolean;
  onHover: (i: number | null) => void;
  onSelect: (i: number | null) => void;
  onFocus: (i: number) => void;
  resetSignal: number;
};

type Camera = {
  yaw: number;
  pitch: number;
  zoom: number;
  tx: number;
  ty: number;
  tz: number;
  vyaw: number;
  vpitch: number;
};

type Ring = {
  type: number;
  radius: number;
  belt: boolean;
  /** rad/s, sign = direction */
  omega: number;
  /** inclination (rotation about X) and node line (rotation about Y) */
  inc: number;
  node: number;
  members: number[];
};

type Orbit = { ring: number; theta0: number; dr: number; dy: number; bob: number };
type Proj = { sx: number; sy: number; p: number; depth: number; wx: number; wy: number; wz: number };
type Pulse = { li: number; t: number; speed: number; hot: boolean };
type Flash = { i: number; t0: number };

const F = 1400;
const RING_ORDER = ["scheduler", "automation", "helper", "skill", "script", "module", "route", "webhook", "page", "table", "service", "persona", "platform"];
const CORE_COLOR = "#2dd4bf";
const STARS = Array.from({ length: 170 }, (_, k) => {
  const h = (n: number) => ((Math.sin(k * 12.9898 + n * 78.233) * 43758.5453) % 1 + 1) % 1;
  return { x: h(1), y: h(2), z: h(3), a: 0.15 + h(4) * 0.45, tw: 0.4 + h(5) * 1.6 };
});

function nodeRadius(n: BNode, types: string[]): number {
  const size = TYPE_META[types[n.type]]?.size ?? 1;
  return Math.min(10, (1.9 + Math.sqrt(n.deg) * 0.6) * size);
}

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  const v = parseInt(h.length === 3 ? h.split("").map((c) => c + c).join("") : h, 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}
const rgbaCache = new Map<string, string>();
function rgba(hex: string, a: number): string {
  const key = hex + ((a * 100) | 0);
  let v = rgbaCache.get(key);
  if (!v) {
    const [r, g, b] = hexToRgb(hex);
    v = `rgba(${r},${g},${b},${Math.max(0, Math.min(1, a)).toFixed(2)})`;
    rgbaCache.set(key, v);
  }
  return v;
}
const spriteCache = new Map<string, HTMLCanvasElement>();
function glowSprite(hex: string): HTMLCanvasElement {
  let c = spriteCache.get(hex);
  if (c) return c;
  c = document.createElement("canvas");
  c.width = c.height = 64;
  const g = c.getContext("2d")!;
  const [r, gg, b] = hexToRgb(hex);
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, `rgba(${r},${gg},${b},0.85)`);
  grad.addColorStop(0.25, `rgba(${r},${gg},${b},0.35)`);
  grad.addColorStop(0.6, `rgba(${r},${gg},${b},0.08)`);
  grad.addColorStop(1, `rgba(${r},${gg},${b},0)`);
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  spriteCache.set(hex, c);
  return c;
}

/* ───────────── orbital layout ───────────── */

function buildRings(model: BrainModel): { rings: Ring[]; orbits: Orbit[] } {
  const types = model.graph.types;
  const rings: Ring[] = [];
  const ringOfType = new Map<number, number>();
  let prev = 30;
  const order = RING_ORDER.map((t) => types.indexOf(t)).filter((k) => k >= 0);
  for (const k of types.map((_, i) => i)) if (!order.includes(k)) order.push(k);
  order.forEach((type, k) => {
    const members = model.nodes.filter((n) => n.type === type).map((n) => n.i);
    const belt = members.length > 30;
    const needed = (members.length * (belt ? 9 : 17)) / (Math.PI * 2);
    const radius = Math.max(prev + (belt ? 40 : 30), needed);
    prev = radius + (belt ? 14 : 0);
    const dir = k % 2 ? -1 : 1;
    rings.push({
      type,
      radius,
      belt,
      omega: (dir * 0.34) / Math.sqrt(radius / 50),
      inc: ((k % 2 ? 1 : -1) * (10 + ((k * 19) % 42)) * Math.PI) / 180,
      node: k * 2.39996323,
      members,
    });
    ringOfType.set(type, rings.length - 1);
  });

  // order each ring so bodies sit near the mean angle of their already-placed
  // neighbours (inner rings first) — tidy at t=0, then the orbits do their thing
  const theta = new Array<number>(model.nodes.length).fill(NaN);
  const orbits: Orbit[] = new Array(model.nodes.length);
  for (let ri = 0; ri < rings.length; ri++) {
    const ring = rings[ri];
    const pref = ring.members.map((i) => {
      let sx = 0, sy = 0, c = 0;
      for (const j of model.adj[i]) {
        if (!Number.isNaN(theta[j])) {
          sx += Math.cos(theta[j]);
          sy += Math.sin(theta[j]);
          c++;
        }
      }
      const hash = ((i * 2654435761) >>> 0) / 4294967296;
      return { i, a: c ? Math.atan2(sy, sx) : hash * Math.PI * 2, hash };
    });
    pref.sort((a, b) => a.a - b.a);
    pref.forEach((p, k) => {
      const t0 = (k / pref.length) * Math.PI * 2 + (ring.belt ? (p.hash - 0.5) * 0.25 : 0);
      theta[p.i] = t0;
      orbits[p.i] = {
        ring: ri,
        theta0: t0,
        dr: ring.belt ? (p.hash - 0.5) * 34 : 0,
        dy: ring.belt ? (Math.sin(p.hash * 97) * 0.5) * 16 : 0,
        bob: p.hash * Math.PI * 2,
      };
    });
  }
  return { rings, orbits };
}

function ringPoint(ring: Ring, theta: number, r: number, y: number): [number, number, number] {
  // local ring plane (XZ), then tilt about X, then rotate about Y
  const lx = Math.cos(theta) * r, lz = Math.sin(theta) * r, ly = y;
  const ci = Math.cos(ring.inc), si = Math.sin(ring.inc);
  const y1 = ly * ci - lz * si;
  const z1 = ly * si + lz * ci;
  const cn = Math.cos(ring.node), sn = Math.sin(ring.node);
  return [lx * cn + z1 * sn, y1, -lx * sn + z1 * cn];
}

/**
 * Camera yaw/pitch that puts the ring's normal ~35° off the view axis, so the
 * orbit reads as an open ellipse. Picks the candidate closest to where the
 * camera already is.
 */
function lookDownOn(ring: Ring, cam: Camera): { yaw: number; pitch: number } {
  const [nx, ny, nz] = ringPoint(ring, 0, 0, 1);
  const TILT = Math.PI / 2 - 0.61;
  let best: { yaw: number; pitch: number; cost: number } | null = null;
  for (const s of [1, -1]) {
    const x = nx * s, y = ny * s, z = nz * s;
    const yaw = Math.atan2(-x, z);
    const zz = -x * Math.sin(yaw) + z * Math.cos(yaw);
    const a = Math.atan2(zz, y);
    for (const sign of [1, -1]) {
      const pitch = sign * TILT - a;
      if (Math.abs(pitch) > 1.35) continue;
      const dyaw = Math.abs(Math.atan2(Math.sin(yaw - cam.yaw), Math.cos(yaw - cam.yaw)));
      const cost = dyaw + Math.abs(pitch - cam.pitch) * 1.5;
      if (!best || cost < best.cost) best = { yaw, pitch, cost };
    }
  }
  return best ?? { yaw: cam.yaw, pitch: cam.pitch };
}

export function BrainCanvas(props: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const propsRef = useRef(props);
  useLayoutEffect(() => {
    propsRef.current = props;
  });

  const camRef = useRef<Camera>({ yaw: 0.6, pitch: 0.42, zoom: 1, tx: 0, ty: 0, tz: 0, vyaw: 0, vpitch: 0 });
  const layoutRef = useRef<{ rings: Ring[]; orbits: Orbit[] } | null>(null);
  const projRef = useRef<Map<number, Proj>>(new Map());
  const hoverRef = useRef<number | null>(null);
  const pulsesRef = useRef<Pulse[]>([]);
  const flashesRef = useRef<Flash[]>([]);
  const dragRef = useRef<{ x0: number; y0: number; lx: number; ly: number; moved: boolean; hit: number | null } | null>(null);
  const sizeRef = useRef({ w: 0, h: 0, dpr: 1 });
  const timeRef = useRef(0);
  const speedRef = useRef(1);
  const spawnAccRef = useRef(0);
  const autoFitRef = useRef(true);
  const retargetRef = useRef(true);
  const goalRef = useRef<{ yaw: number; pitch: number } | null>(null);
  const lastResetRef = useRef(props.resetSignal);

  /* layout is a pure function of the model */
  useEffect(() => {
    layoutRef.current = buildRings(props.model);
    pulsesRef.current = [];
  }, [props.model]);

  /* refit whenever the set of visible bodies changes (solo a type, focus, clear) */
  useEffect(() => {
    autoFitRef.current = true;
    retargetRef.current = true;
  }, [props.visible]);

  /* reset camera */
  useEffect(() => {
    if (props.resetSignal === lastResetRef.current) return;
    lastResetRef.current = props.resetSignal;
    const cam = camRef.current;
    cam.yaw = 0.6;
    cam.pitch = 0.42;
    cam.vyaw = cam.vpitch = 0;
    autoFitRef.current = true;
    goalRef.current = null;
  }, [props.resetSignal]);

  /* resize */
  useEffect(() => {
    const wrap = wrapRef.current!;
    const canvas = canvasRef.current!;
    const ro = new ResizeObserver(() => {
      const r = wrap.getBoundingClientRect();
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      sizeRef.current = { w: r.width, h: r.height, dpr };
      canvas.width = Math.round(r.width * dpr);
      canvas.height = Math.round(r.height * dpr);
      canvas.style.width = `${r.width}px`;
      canvas.style.height = `${r.height}px`;
    });
    ro.observe(wrap);
    return () => ro.disconnect();
  }, []);

  /* ───────────── render loop ───────────── */
  useEffect(() => {
    const canvas = canvasRef.current!;
    const ctx = canvas.getContext("2d")!;
    let raf = 0;
    let last = performance.now();

    const project = (x: number, y: number, z: number, cam: Camera, w: number, h: number): Proj => {
      const dx = x - cam.tx, dy = y - cam.ty, dz = z - cam.tz;
      const cy = Math.cos(cam.yaw), sy = Math.sin(cam.yaw);
      const cp = Math.cos(cam.pitch), sp = Math.sin(cam.pitch);
      const x1 = dx * cy + dz * sy;
      const z1 = -dx * sy + dz * cy;
      const y2 = dy * cp - z1 * sp;
      const z2 = dy * sp + z1 * cp;
      const p = F / Math.max(150, F + z2);
      return { sx: w / 2 + x1 * p * cam.zoom, sy: h / 2 + y2 * p * cam.zoom, p, depth: z2, wx: x, wy: y, wz: z };
    };

    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      if (document.hidden) return;
      const { w, h, dpr } = sizeRef.current;
      const layout = layoutRef.current;
      if (!w || !h || !layout) return;
      const { model, selected, emphasis, paused, visible } = propsRef.current;
      const types = model.graph.types;
      const cam = camRef.current;
      const hover = hoverRef.current;
      const { rings, orbits } = layout;

      // time: slows down while you inspect something, freezes on pause
      const wantSpeed = paused ? 0 : selected !== null ? 0.22 : hover !== null ? 0.45 : 1;
      speedRef.current += (wantSpeed - speedRef.current) * 0.08;
      timeRef.current += dt * speedRef.current;
      const t = timeRef.current;
      const live = speedRef.current > 0.01;

      // when a single orbit is isolated, swing the camera to look down onto its plane
      if (retargetRef.current) {
        retargetRef.current = false;
        const shownRings = rings.filter((r) => r.members.some((i) => visible[i]));
        goalRef.current = shownRings.length === 1 ? lookDownOn(shownRings[0], cam) : null;
      }

      // camera: slow drift + inertia, or ease toward the goal view
      if (!dragRef.current) {
        const goal = goalRef.current;
        if (goal) {
          const dy = Math.atan2(Math.sin(goal.yaw - cam.yaw), Math.cos(goal.yaw - cam.yaw));
          cam.yaw += dy * 0.06;
          cam.pitch += (goal.pitch - cam.pitch) * 0.06;
        } else if (!paused) {
          cam.yaw += 0.035 * dt * speedRef.current;
        }
        cam.yaw += cam.vyaw;
        cam.pitch = Math.max(-1.35, Math.min(1.35, cam.pitch + cam.vpitch));
        cam.vyaw *= 0.92;
        cam.vpitch *= 0.92;
      }

      // world positions of visible bodies
      const world = new Map<number, [number, number, number]>();
      const focusNode = hover ?? selected;
      for (const n of model.nodes) {
        if (!visible[n.i]) continue;
        const o = orbits[n.i];
        const ring = rings[o.ring];
        const theta = o.theta0 + ring.omega * t;
        const bob = Math.sin(t * 0.9 + o.bob) * 2.2;
        world.set(n.i, ringPoint(ring, theta, ring.radius + o.dr, o.dy + bob));
      }

      // camera target eases halfway to the selection: the planet and the sun
      // stay in frame together while the planet keeps moving
      let gx = 0, gy = 0, gz = 0;
      if (selected !== null && world.has(selected)) {
        const [x, y, z] = world.get(selected)!;
        gx = x * 0.55;
        gy = y * 0.55;
        gz = z * 0.55;
      }
      cam.tx += (gx - cam.tx) * 0.06;
      cam.ty += (gy - cam.ty) * 0.06;
      cam.tz += (gz - cam.tz) * 0.06;

      // auto-fit the outermost populated ring; lean in a little on selection
      if (autoFitRef.current) {
        let R = 60;
        for (const ring of rings) if (ring.members.some((i) => visible[i])) R = Math.max(R, ring.radius + (ring.belt ? 20 : 0));
        const fit = Math.max(0.35, Math.min(5, (Math.min(w, h) * 0.45) / R));
        const target = selected !== null ? fit * 1.35 : fit;
        cam.zoom += (target - cam.zoom) * 0.06;
      }

      const proj = projRef.current;
      proj.clear();
      for (const [i, [x, y, z]] of world) proj.set(i, project(x, y, z, cam, w, h));
      const order = [...proj.keys()].sort((a, b) => proj.get(b)!.depth - proj.get(a)!.depth);
      const core = project(0, 0, 0, cam, w, h);

      const hot = focusNode !== null && visible[focusNode] ? neighborhood(model, focusNode, 1) : null;
      const dimOf = (i: number) => (hot ? (hot.has(i) ? 1 : 0.1) : emphasis ? (emphasis.has(i) ? 1 : 0.12) : 1);
      const fade = (p: number) => Math.max(0.25, Math.min(1, (p - 0.6) / 0.7));
      const zs = Math.sqrt(cam.zoom);

      /* ───── background */
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const bg = ctx.createRadialGradient(core.sx, core.sy, 10, w * 0.5, h * 0.5, Math.max(w, h) * 0.8);
      bg.addColorStop(0, "#0b1a24");
      bg.addColorStop(0.35, "#070d19");
      bg.addColorStop(1, "#02040a");
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, w, h);

      // starfield with a hint of parallax off the camera yaw
      for (let k = 0; k < STARS.length; k++) {
        const s = STARS[k];
        const x = (((s.x + cam.yaw * 0.02 * s.z) % 1) + 1) % 1;
        const tw = 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(t * s.tw + k));
        ctx.fillStyle = `rgba(190,215,235,${(s.a * tw).toFixed(2)})`;
        ctx.fillRect(x * w, s.y * h, s.z > 0.7 ? 1.5 : 1, s.z > 0.7 ? 1.5 : 1);
      }

      ctx.globalCompositeOperation = "lighter";
      ctx.lineCap = "round";

      /* ───── orbit rings */
      for (const ring of rings) {
        if (!ring.members.some((i) => visible[i])) continue;
        const color = TYPE_META[types[ring.type]]?.color ?? "#94a3b8";
        const ringHot = hot ? ring.members.some((i) => hot.has(i)) : true;
        const alpha = (ring.belt ? 0.05 : 0.11) * (ringHot ? 1 : 0.35);
        ctx.strokeStyle = rgba(color, alpha);
        ctx.lineWidth = ring.belt ? 10 * zs : 1;
        ctx.beginPath();
        const steps = 96;
        for (let k = 0; k <= steps; k++) {
          const [x, y, z] = ringPoint(ring, (k / steps) * Math.PI * 2, ring.radius, 0);
          const pr = project(x, y, z, cam, w, h);
          if (k === 0) ctx.moveTo(pr.sx, pr.sy);
          else ctx.lineTo(pr.sx, pr.sy);
        }
        ctx.stroke();
        // a bright comet arc sweeping the ring with its bodies
        if (live) {
          const a0 = ring.omega * t * 1.6 + ring.node;
          ctx.strokeStyle = rgba(color, 0.35 * (ringHot ? 1 : 0.3));
          ctx.lineWidth = 1.4;
          ctx.beginPath();
          for (let k = 0; k <= 18; k++) {
            const [x, y, z] = ringPoint(ring, a0 + (k / 18) * 0.5, ring.radius, 0);
            const pr = project(x, y, z, cam, w, h);
            if (k === 0) ctx.moveTo(pr.sx, pr.sy);
            else ctx.lineTo(pr.sx, pr.sy);
          }
          ctx.stroke();
        }
      }

      /* ───── edges */
      for (let li = 0; li < model.links.length; li++) {
        const l = model.links[li];
        const a = proj.get(l.source.i), b = proj.get(l.target.i);
        if (!a || !b) continue;
        const inHot = hot ? (l.source.i === focusNode || l.target.i === focusNode) && hot.has(l.source.i) && hot.has(l.target.i) : false;
        const dim = hot ? (inHot ? 1 : 0.15) : emphasis ? Math.min(dimOf(l.source.i), dimOf(l.target.i)) : 1;
        const pm = (a.p + b.p) / 2;
        const hub = Math.max(l.source.deg, l.target.deg) > 40 ? 0.5 : 1;
        const alpha = (inHot ? 0.9 : 0.12) * fade(pm) * dim * hub;
        if (alpha < 0.015) continue;
        const color = TYPE_META[types[(inHot && l.source.i !== focusNode ? l.source : l.target).type]]?.color ?? "#94a3b8";
        ctx.strokeStyle = rgba(color, alpha);
        ctx.lineWidth = (inHot ? 1.6 : 0.7) * pm * zs;
        ctx.beginPath();
        ctx.moveTo(a.sx, a.sy);
        // bow every edge slightly toward the core so they read as arcs, not spokes
        const mx = (a.sx + b.sx) / 2, my = (a.sy + b.sy) / 2;
        ctx.quadraticCurveTo(mx + (core.sx - mx) * 0.18, my + (core.sy - my) * 0.18, b.sx, b.sy);
        ctx.stroke();
      }

      /* ───── pulses */
      if (live) {
        const pulses = pulsesRef.current;
        const links = model.links;
        spawnAccRef.current += Math.min(45, links.length * 0.06) * dt * speedRef.current;
        while (spawnAccRef.current >= 1) {
          spawnAccRef.current--;
          if (pulses.length < 280) pulses.push({ li: Math.floor(Math.random() * links.length), t: 0, speed: 0.4 + Math.random() * 0.5, hot: false });
        }
        if (hot && focusNode !== null && Math.random() < dt * 14) {
          const my = model.nodeLinks[focusNode];
          if (my.length) pulses.push({ li: my[Math.floor(Math.random() * my.length)], t: 0, speed: 1.1, hot: true });
        }
        if (Math.random() < dt * 1.1 * speedRef.current) {
          const n = model.nodes[Math.floor(Math.random() * model.nodes.length)];
          if (n && n.deg > 0 && visible[n.i]) {
            flashesRef.current.push({ i: n.i, t0: t });
            for (const li of model.nodeLinks[n.i]) if (pulses.length < 320) pulses.push({ li, t: 0, speed: 0.8 + Math.random() * 0.3, hot: false });
          }
        }
        for (let k = pulses.length - 1; k >= 0; k--) {
          const pu = pulses[k];
          pu.t += pu.speed * dt * Math.max(speedRef.current, 0.35);
          const l = links[pu.li];
          const a = l && proj.get(l.source.i), b = l && proj.get(l.target.i);
          if (pu.t >= 1 || !a || !b) {
            pulses.splice(k, 1);
            continue;
          }
          const e = pu.t < 0.5 ? 2 * pu.t * pu.t : 1 - Math.pow(-2 * pu.t + 2, 2) / 2;
          const mx = (a.sx + b.sx) / 2, my = (a.sy + b.sy) / 2;
          const cx = mx + (core.sx - mx) * 0.18, cy = my + (core.sy - my) * 0.18;
          const x = (1 - e) * (1 - e) * a.sx + 2 * (1 - e) * e * cx + e * e * b.sx;
          const y = (1 - e) * (1 - e) * a.sy + 2 * (1 - e) * e * cy + e * e * b.sy;
          const p = a.p + (b.p - a.p) * e;
          const dim = hot ? (hot.has(l.source.i) && hot.has(l.target.i) ? 1 : 0.15) : 1;
          const color = TYPE_META[types[l.target.type]]?.color ?? "#94a3b8";
          const life = Math.sin(pu.t * Math.PI);
          const r = (pu.hot ? 2.6 : 1.6) * p * zs;
          ctx.globalAlpha = 0.9 * life * fade(p) * dim;
          ctx.drawImage(glowSprite(color), x - r * 4, y - r * 4, r * 8, r * 8);
          ctx.fillStyle = "#ffffff";
          ctx.beginPath();
          ctx.arc(x, y, r * 0.7, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.globalAlpha = 1;
      }

      /* ───── the sun: Marketing OS */
      {
        const R = 16 * core.p * zs;
        const pulse = 1 + Math.sin(t * 1.4) * 0.05;
        ctx.globalAlpha = 0.9;
        const gs = R * 9 * pulse;
        ctx.drawImage(glowSprite(CORE_COLOR), core.sx - gs, core.sy - gs, gs * 2, gs * 2);
        ctx.globalAlpha = 0.55;
        const gs2 = R * 3.2 * pulse;
        ctx.drawImage(glowSprite("#ffffff"), core.sx - gs2, core.sy - gs2, gs2 * 2, gs2 * 2);
        // corona: two thin counter-rotating ellipses
        for (let k = 0; k < 2; k++) {
          ctx.strokeStyle = rgba(k ? "#ffffff" : CORE_COLOR, 0.35);
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.ellipse(core.sx, core.sy, R * 1.9, R * (0.55 + 0.25 * Math.sin(t * 0.7 + k)), (k ? -1 : 1) * t * 0.5 + k * 1.2, 0, Math.PI * 2);
          ctx.stroke();
        }
        ctx.globalCompositeOperation = "source-over";
        ctx.globalAlpha = 1;
        const g = ctx.createRadialGradient(core.sx - R * 0.35, core.sy - R * 0.35, R * 0.1, core.sx, core.sy, R);
        g.addColorStop(0, "#ffffff");
        g.addColorStop(0.35, "#bff7ee");
        g.addColorStop(1, CORE_COLOR);
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(core.sx, core.sy, R, 0, Math.PI * 2);
        ctx.fill();
        ctx.textAlign = "center";
        ctx.textBaseline = "top";
        ctx.font = `600 ${Math.max(11, Math.min(15, 13 * Math.sqrt(core.p)))}px ui-sans-serif, system-ui, -apple-system, Segoe UI, sans-serif`;
        ctx.lineWidth = 3;
        ctx.strokeStyle = "rgba(3,6,14,0.85)";
        ctx.strokeText("Marketing OS", core.sx, core.sy + R + 6);
        ctx.fillStyle = "rgba(255,255,255,0.95)";
        ctx.fillText("Marketing OS", core.sx, core.sy + R + 6);
        ctx.globalCompositeOperation = "lighter";
      }

      /* ───── bodies (far → near) */
      for (const i of order) {
        const n = model.nodes[i];
        const pr = proj.get(i)!;
        const color = TYPE_META[types[n.type]]?.color ?? "#94a3b8";
        const dim = dimOf(i);
        const isSel = i === selected, isHov = i === hover;
        const r = nodeRadius(n, types) * pr.p * zs * (isHov ? 1.25 : 1);
        const fa = fade(pr.p);
        // orbit trail for the body you're looking at
        if (isSel || isHov) {
          const o = orbits[i];
          const ring = rings[o.ring];
          const theta = o.theta0 + ring.omega * t;
          const dir = Math.sign(ring.omega) || 1;
          ctx.strokeStyle = rgba(color, 0.6);
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          for (let k = 0; k <= 24; k++) {
            const [x, y, z] = ringPoint(ring, theta - dir * (k / 24) * 0.9, ring.radius + o.dr, o.dy);
            const q = project(x, y, z, cam, w, h);
            if (k === 0) ctx.moveTo(q.sx, q.sy);
            else ctx.lineTo(q.sx, q.sy);
          }
          ctx.globalAlpha = 0.8;
          ctx.stroke();
        }
        for (let k = flashesRef.current.length - 1; k >= 0; k--) {
          const fl = flashesRef.current[k];
          if (fl.i !== i) continue;
          const age = t - fl.t0;
          if (age > 1.1) {
            flashesRef.current.splice(k, 1);
            continue;
          }
          ctx.globalAlpha = (1 - age / 1.1) * 0.7 * fa * dim;
          ctx.strokeStyle = color;
          ctx.lineWidth = 1.2;
          ctx.beginPath();
          ctx.arc(pr.sx, pr.sy, r + age * 26 * pr.p, 0, Math.PI * 2);
          ctx.stroke();
        }
        ctx.globalAlpha = (isSel || isHov ? 1 : 0.45) * fa * dim;
        const gs = r * (isSel || isHov ? 6 : 3.6);
        ctx.drawImage(glowSprite(color), pr.sx - gs, pr.sy - gs, gs * 2, gs * 2);

        ctx.globalCompositeOperation = "source-over";
        ctx.globalAlpha = Math.min(1, (0.75 + 0.25 * fa) * (dim < 1 ? dim * 3 : 1));
        // lit from the sun side
        const lx = core.sx - pr.sx, ly = core.sy - pr.sy;
        const ll = Math.hypot(lx, ly) || 1;
        const shade = ctx.createRadialGradient(pr.sx + (lx / ll) * r * 0.45, pr.sy + (ly / ll) * r * 0.45, r * 0.1, pr.sx, pr.sy, r);
        shade.addColorStop(0, "#ffffff");
        shade.addColorStop(0.3, color);
        shade.addColorStop(1, rgba(color, 0.55));
        ctx.fillStyle = shade;
        ctx.beginPath();
        ctx.arc(pr.sx, pr.sy, r, 0, Math.PI * 2);
        ctx.fill();
        if (isSel) {
          ctx.globalAlpha = 0.95;
          ctx.strokeStyle = "#ffffff";
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.arc(pr.sx, pr.sy, r + 4, 0, Math.PI * 2);
          ctx.stroke();
          ctx.globalAlpha = 0.5 + 0.3 * Math.sin(now / 300);
          ctx.strokeStyle = color;
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.arc(pr.sx, pr.sy, r + 9 + Math.sin(now / 300) * 2, 0, Math.PI * 2);
          ctx.stroke();
        }
        ctx.globalCompositeOperation = "lighter";
      }
      ctx.globalCompositeOperation = "source-over";
      ctx.globalAlpha = 1;

      /* ───── labels (key + hot first, then by importance; skip overlaps) */
      // few bodies on screen → label them all (overlap check still applies)
      const budget = hot ? 6 : world.size <= 48 ? Infinity : 16 * Math.pow(cam.zoom, 1.6);
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      const placed: { x0: number; y0: number; x1: number; y1: number }[] = [];
      const coreLabelW = 90;
      placed.push({ x0: core.sx - coreLabelW / 2, y0: core.sy - 20, x1: core.sx + coreLabelW / 2, y1: core.sy + 40 });
      const candidates: number[] = [];
      for (const i of order) {
        const n = model.nodes[i];
        const isHot = hot?.has(i) ?? false;
        const isKey = i === selected || i === hover;
        if (!(isHot || isKey || n.rank < budget)) continue;
        if (emphasis && !emphasis.has(i) && !isKey) continue;
        candidates.push(i);
      }
      candidates.sort((a, b) => {
        const ka = a === selected || a === hover ? 0 : hot?.has(a) ? 1 : 2;
        const kb = b === selected || b === hover ? 0 : hot?.has(b) ? 1 : 2;
        return ka - kb || model.nodes[a].rank - model.nodes[b].rank;
      });
      for (const i of candidates) {
        const n = model.nodes[i];
        const pr = proj.get(i)!;
        const isHot = hot?.has(i) ?? false;
        const isKey = i === selected || i === hover;
        const r = nodeRadius(n, types) * pr.p * zs;
        const size = Math.max(9.5, Math.min(14, (isKey ? 13 : 11) * Math.sqrt(pr.p)));
        const alpha = (isKey ? 1 : isHot ? 0.92 : 0.72 * fade(pr.p)) * (hot && !isHot ? 0.25 : 1);
        ctx.font = `${isKey ? 600 : 500} ${size}px ui-sans-serif, system-ui, -apple-system, Segoe UI, sans-serif`;
        const label = n.label.length > 34 && !isKey ? n.label.slice(0, 32) + "…" : n.label;
        const y = pr.sy + r + 5;
        const tw = ctx.measureText(label).width;
        const box = { x0: pr.sx - tw / 2 - 3, y0: y - 2, x1: pr.sx + tw / 2 + 3, y1: y + size + 3 };
        if (!isKey && placed.some((b) => box.x0 < b.x1 && box.x1 > b.x0 && box.y0 < b.y1 && box.y1 > b.y0)) continue;
        placed.push(box);
        ctx.lineWidth = 3;
        ctx.lineJoin = "round";
        ctx.strokeStyle = `rgba(3,6,14,${(0.85 * alpha).toFixed(2)})`;
        ctx.strokeText(label, pr.sx, y);
        ctx.fillStyle = `rgba(${isKey ? "255,255,255" : "226,232,240"},${alpha.toFixed(2)})`;
        ctx.fillText(label, pr.sx, y);
        if (isKey) {
          const meta = TYPE_META[types[n.type]]?.label ?? types[n.type];
          ctx.font = `500 ${Math.max(9, size - 3)}px ui-monospace, SFMono-Regular, Menlo, monospace`;
          ctx.fillStyle = rgba(TYPE_META[types[n.type]]?.color ?? "#94a3b8", 0.95);
          ctx.fillText(meta.toUpperCase(), pr.sx, y + size + 3);
        }
      }
    };

    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, []);

  /* ───────────── interaction ───────────── */
  useEffect(() => {
    const canvas = canvasRef.current!;

    const pick = (x: number, y: number): number | null => {
      const { model } = propsRef.current;
      const cam = camRef.current;
      let best: number | null = null;
      let bestD = Infinity;
      for (const [i, pr] of projRef.current) {
        const r = nodeRadius(model.nodes[i], model.graph.types) * pr.p * Math.sqrt(cam.zoom) + 5;
        const d = Math.hypot(pr.sx - x, pr.sy - y);
        const score = d - pr.depth * 0.002;
        if (d <= r && score < bestD) {
          bestD = score;
          best = i;
        }
      }
      return best;
    };
    const local = (e: PointerEvent | MouseEvent) => {
      const r = canvas.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };

    const onDown = (e: PointerEvent) => {
      if (e.button !== 0) return;
      const { x, y } = local(e);
      dragRef.current = { x0: x, y0: y, lx: x, ly: y, moved: false, hit: pick(x, y) };
      try {
        canvas.setPointerCapture(e.pointerId);
      } catch {
        /* synthetic pointer ids */
      }
    };
    const onMove = (e: PointerEvent) => {
      const { x, y } = local(e);
      const d = dragRef.current;
      if (!d) {
        const hit = pick(x, y);
        if (hit !== hoverRef.current) {
          hoverRef.current = hit;
          propsRef.current.onHover(hit);
          canvas.style.cursor = hit !== null ? "pointer" : "grab";
        }
        return;
      }
      const dx = x - d.lx, dy = y - d.ly;
      d.lx = x;
      d.ly = y;
      if (Math.hypot(x - d.x0, y - d.y0) > 4) d.moved = true;
      if (d.moved) {
        goalRef.current = null;
        const cam = camRef.current;
        cam.yaw += dx * 0.0055;
        cam.pitch = Math.max(-1.35, Math.min(1.35, cam.pitch + dy * 0.0055));
        cam.vyaw = dx * 0.0009;
        cam.vpitch = dy * 0.0009;
        canvas.style.cursor = "grabbing";
      }
    };
    const onUp = (e: PointerEvent) => {
      const d = dragRef.current;
      dragRef.current = null;
      try {
        canvas.releasePointerCapture(e.pointerId);
      } catch {
        /* not captured */
      }
      canvas.style.cursor = hoverRef.current !== null ? "pointer" : "grab";
      if (!d || d.moved) return;
      propsRef.current.onSelect(d.hit);
    };
    const onDbl = (e: MouseEvent) => {
      const { x, y } = local(e);
      const hit = pick(x, y);
      if (hit !== null) propsRef.current.onFocus(hit);
    };
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const cam = camRef.current;
      autoFitRef.current = false;
      cam.zoom = Math.max(0.35, Math.min(5, cam.zoom * Math.exp(-e.deltaY * 0.0012)));
    };
    const onLeave = () => {
      if (hoverRef.current !== null) {
        hoverRef.current = null;
        propsRef.current.onHover(null);
      }
    };

    canvas.addEventListener("pointerdown", onDown);
    canvas.addEventListener("pointermove", onMove);
    canvas.addEventListener("pointerup", onUp);
    canvas.addEventListener("pointercancel", onUp);
    canvas.addEventListener("pointerleave", onLeave);
    canvas.addEventListener("dblclick", onDbl);
    canvas.addEventListener("wheel", onWheel, { passive: false });
    canvas.style.cursor = "grab";
    return () => {
      canvas.removeEventListener("pointerdown", onDown);
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerup", onUp);
      canvas.removeEventListener("pointercancel", onUp);
      canvas.removeEventListener("pointerleave", onLeave);
      canvas.removeEventListener("dblclick", onDbl);
      canvas.removeEventListener("wheel", onWheel);
    };
  }, []);

  return (
    <div ref={wrapRef} className="relative h-full w-full select-none overflow-hidden rounded-[10px]" style={{ background: "#04070f" }}>
      <canvas ref={canvasRef} className="block touch-none" />
    </div>
  );
}
