"use client";

import { useEffect, useRef } from "react";

/**
 * Jev decision globe (Kevin 2026-09-18): a calmer cousin of the System Brain
 * orbital. Jev is the sun; every tool in the catalog is a planet on its own
 * tilted ring. Idle: slow drift. Deciding: the core breathes and sparks run
 * out along the rings. Decided: the chosen tool flares and its ring brightens
 * in proportion to Jev's probability, the rest dim. Pure canvas, no deps.
 */

export type GlobePhase = "idle" | "listening" | "deciding" | "decided" | "speaking";

type Props = {
  phase: GlobePhase;
  tools: { id: string; label: string; color: string }[];
  chosen?: string | null;
  probabilities?: Record<string, number> | null;
  /** Small header strip vs. the big stage. */
  compact?: boolean;
  /** Horizontal centre of the system as a fraction of the canvas width (the
   *  canvas spans the whole card, chat pane included; 2026-09-19). */
  center?: number;
  /** Sun color (Jev teal, Laya cyan). */
  core?: string;
  coreLabel?: string;
};

const CORE = "#2dd4bf";
const F = 1200;

const STARS = Array.from({ length: 110 }, (_, k) => {
  const h = (n: number) => ((Math.sin(k * 12.9898 + n * 78.233) * 43758.5453) % 1 + 1) % 1;
  return { x: h(1), y: h(2), a: 0.12 + h(3) * 0.35, tw: 0.5 + h(4) * 1.4 };
});

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  const v = parseInt(h.length === 3 ? h.split("").map((c) => c + c).join("") : h, 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}
function rgba(hex: string, a: number): string {
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${r},${g},${b},${Math.max(0, Math.min(1, a)).toFixed(3)})`;
}
const sprites = new Map<string, HTMLCanvasElement>();
function glow(hex: string): HTMLCanvasElement {
  let c = sprites.get(hex);
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
  sprites.set(hex, c);
  return c;
}

type Ring = { id: string; label: string; color: string; radius: number; inc: number; node: number; omega: number; theta0: number };

function ringPoint(r: Ring, theta: number): [number, number, number] {
  const x0 = Math.cos(theta) * r.radius, z0 = Math.sin(theta) * r.radius;
  const ci = Math.cos(r.inc), si = Math.sin(r.inc);
  const y1 = -z0 * si, z1 = z0 * ci;
  const cn = Math.cos(r.node), sn = Math.sin(r.node);
  return [x0 * cn + z1 * sn, y1, -x0 * sn + z1 * cn];
}

function project(x: number, y: number, z: number, yaw: number, pitch: number, cx: number, cy: number, zoom: number) {
  const cyaw = Math.cos(yaw), syaw = Math.sin(yaw);
  const x1 = x * cyaw + z * syaw, z1 = -x * syaw + z * cyaw;
  const cp = Math.cos(pitch), sp = Math.sin(pitch);
  const y2 = y * cp - z1 * sp, z2 = y * sp + z1 * cp;
  const p = (F / (F + z2 + 600)) * zoom;
  return { sx: cx + x1 * p, sy: cy + y2 * p, p, depth: z2 };
}

export function JevGlobe({ phase, tools, chosen, probabilities, compact, center = 0.5, core = CORE, coreLabel = "JEV" }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const propsRef = useRef({ phase, tools, chosen, probabilities, compact, center, core, coreLabel });
  propsRef.current = { phase, tools, chosen, probabilities, compact, center, core, coreLabel };
  const stateRef = useRef({ t: 0, speed: 1, breathe: 0, flare: 0, dim: 0, decidedAt: 0 });

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    let raf = 0;
    let last = performance.now();
    let w = 0, h = 0, dpr = 1;
    const sparks: { ring: number; t: number; speed: number }[] = [];

    // Performance (Kevin 2026-09-19, a pinned Chrome tab): the canvas spans the
    // whole card (~1650x800 CSS px), so cap the backing store at 1.25x on big
    // canvases, pre-render the background + stars once per size, throttle to
    // 30 fps unless Jev is deciding, and stop drawing entirely when off-screen.
    const bg = document.createElement("canvas");
    let bgCx = -1, bgCy = -1;
    const paintBackground = (cx: number, cy: number, sun: string) => {
      bgCx = cx; bgCy = cy;
      bg.width = canvas.width; bg.height = canvas.height;
      const b = bg.getContext("2d");
      if (!b) return;
      b.setTransform(dpr, 0, 0, dpr, 0, 0);
      b.clearRect(0, 0, w, h);
      const grad = b.createRadialGradient(cx, cy, 6, cx, cy, Math.max(w, h) * 0.7);
      grad.addColorStop(0, rgba(sun, 0.12));
      grad.addColorStop(1, "rgba(0,0,0,0)");
      b.fillStyle = grad;
      b.fillRect(0, 0, w, h);
      for (const s of STARS) {
        b.fillStyle = light ? `rgba(40,50,70,${(s.a * 0.55).toFixed(3)})` : `rgba(200,210,230,${(s.a * 0.8).toFixed(3)})`;
        b.fillRect(s.x * w, s.y * h, light ? 1.6 : 1.2, light ? 1.6 : 1.2);
      }
    };
    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      w = Math.max(1, Math.floor(rect.width));
      h = Math.max(1, Math.floor(rect.height));
      dpr = Math.min(window.devicePixelRatio || 1, w * h > 900_000 ? 1.25 : 1.5);
      canvas.width = Math.floor(w * dpr);
      canvas.height = Math.floor(h * dpr);
      bgCx = -1; // repaint on next frame
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);
    // Light mode (Kevin 2026-09-19: "fix how it looks in light mode"): dark ink,
    // stronger orbit lines, bigger bolder labels. Follows the .dark class the
    // theme toggle sets on <html>.
    let light = !document.documentElement.classList.contains("dark");
    const mo = new MutationObserver(() => {
      light = !document.documentElement.classList.contains("dark");
      bgCx = -1; // stars are painted into the cached background
    });
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    let visible = true;
    const io = new IntersectionObserver((entries) => { visible = entries.some((e) => e.isIntersecting); }, { threshold: 0.01 });
    io.observe(canvas);
    let lastDraw = 0;

    const buildRings = (list: Props["tools"]): Ring[] =>
      list.map((t, i) => {
        const n = list.length;
        const golden = i * 2.399963;
        return {
          id: t.id,
          label: t.label,
          color: t.color,
          radius: 120 + (i / Math.max(1, n - 1)) * 230,
          inc: 0.55 + Math.sin(golden) * 0.35,
          node: golden,
          omega: (0.10 + 0.05 * ((i * 7) % 3)) * (i % 2 ? -1 : 1),
          theta0: golden * 1.7,
        };
      });
    let rings = buildRings(propsRef.current.tools);
    let ringsKey = propsRef.current.tools.map((t) => t.id).join("|");

    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      if (document.hidden || !visible || !w || !h) { last = now; return; }
      const { phase, tools, chosen, probabilities, compact, center, core: sun, coreLabel } = propsRef.current;
      const fpsInterval = phase === "deciding" ? 1000 / 60 : 1000 / 30;
      if (now - lastDraw < fpsInterval - 1) return;
      lastDraw = now;
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const key = tools.map((t) => t.id).join("|");
      if (key !== ringsKey) {
        rings = buildRings(tools);
        ringsKey = key;
      }
      const st = stateRef.current;
      // Speaking keeps the decided look (chosen planet lit) with the core
      // pulsing to the voice; listening is a slow breath while the mic is open.
      const settled = phase === "decided" || phase === "speaking";
      const wantSpeed = phase === "deciding" ? 2.2 : settled ? 0.5 : phase === "listening" ? 0.8 : 1;
      st.speed += (wantSpeed - st.speed) * 0.05;
      st.t += dt * st.speed;
      const wantBreathe = phase === "deciding" || phase === "speaking" ? 1 : phase === "listening" ? 0.5 : 0;
      st.breathe += (wantBreathe - st.breathe) * 0.06;
      st.dim += ((settled && chosen ? 1 : 0) - st.dim) * 0.06;
      st.flare += ((settled && chosen ? 1 : 0) - st.flare) * 0.08;
      if (phase === "deciding" && Math.random() < dt * 6 && sparks.length < 24) {
        sparks.push({ ring: Math.floor(Math.random() * rings.length), t: 0, speed: 0.8 + Math.random() * 0.8 });
      }
      for (let i = sparks.length - 1; i >= 0; i--) {
        sparks[i].t += dt * sparks[i].speed;
        if (sparks[i].t > 1) sparks.splice(i, 1);
      }

      // Fill the pane: rings reach r=350, so ~800px across at zoom 1. Scale with the
      // smaller side and let it grow past 1 on big screens.
      const cx = w * center;
      // Raised (Kevin 2026-09-19: "a lot of room above"); the caption lives below.
      const cy = compact ? h / 2 : h * 0.44;
      const regionHalf = Math.min(cx, w - cx);
      const zoom = compact
        ? 0.42
        : Math.max(0.6, Math.min(3.2, (regionHalf - 50) / 250, (cy - 30) / 165, (h - cy - 120) / 165));
      const yaw = st.t * 0.06;
      const pitch = 0.42 + Math.sin(st.t * 0.1) * 0.05;

      if (bgCx !== cx || bgCy !== cy) paintBackground(cx, cy, sun);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(bg, 0, 0);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      // breathing glow on top of the static ground (one gradient, only while active)
      if (st.breathe > 0.02) {
        const gl = ctx.createRadialGradient(cx, cy, 6, cx, cy, Math.max(w, h) * 0.45);
        gl.addColorStop(0, rgba(sun, 0.10 * st.breathe));
        gl.addColorStop(1, "rgba(0,0,0,0)");
        ctx.fillStyle = gl;
        ctx.fillRect(0, 0, w, h);
      }

      // Rings: one stroked path per ring per half (behind / in front of the core),
      // planets depth-sorted among themselves. No per-segment closures or sorting.
      const core = project(0, 0, 0, yaw, pitch, cx, cy, zoom);
      const N = compact ? 36 : 56;
      type Planet = { depth: number; draw: () => void };
      const planets: Planet[] = [];
      const ringPaths: { back: Path2D; front: Path2D; color: string; alpha: number; width: number }[] = [];

      rings.forEach((r, ri) => {
        const prob = probabilities?.[r.id] ?? 0;
        const isChosen = chosen === r.id;
        const ringA = (light ? 0.42 : 0.16) + (st.dim ? (isChosen ? 0.55 * st.flare : -0.10 * st.dim + 0.18 * prob) : 0);
        const back = new Path2D(), front = new Path2D();
        let prev = project(...ringPoint(r, 0), yaw, pitch, cx, cy, zoom);
        let prevBack = prev.depth > 0;
        let backOpen = false, frontOpen = false;
        for (let k = 1; k <= N; k++) {
          const cur = project(...ringPoint(r, (k / N) * Math.PI * 2), yaw, pitch, cx, cy, zoom);
          const isBack = (prev.depth + cur.depth) / 2 > 0;
          const path = isBack ? back : front;
          const open = isBack ? backOpen : frontOpen;
          if (!open || isBack !== prevBack) path.moveTo(prev.sx, prev.sy);
          path.lineTo(cur.sx, cur.sy);
          if (isBack) backOpen = true; else frontOpen = true;
          prevBack = isBack;
          prev = cur;
        }
        ringPaths.push({ back, front, color: r.color, alpha: Math.max(0.04, ringA), width: (compact ? 1 : 1.9) + (isChosen ? 1.2 * st.flare : 0) });

        // planet
        const theta = r.theta0 + st.t * r.omega;
        const pp = project(...ringPoint(r, theta), yaw, pitch, cx, cy, zoom);
        const base = compact ? 4 : 7;
        const size = (base + (isChosen ? 8 * st.flare : 0) + (st.dim ? prob * 5 : 0)) * pp.p;
        const alpha = st.dim ? (isChosen ? 1 : 0.35 + 0.5 * prob) : 0.95;
        planets.push({
          depth: pp.depth,
          draw: () => {
            const gs = size * (isChosen ? 5 : 3.2);
            ctx.globalAlpha = alpha;
            ctx.drawImage(glow(r.color), pp.sx - gs, pp.sy - gs, gs * 2, gs * 2);
            ctx.fillStyle = r.color;
            ctx.beginPath();
            ctx.arc(pp.sx, pp.sy, size, 0, Math.PI * 2);
            ctx.fill();
            ctx.globalAlpha = 1;
            if (!compact || isChosen) {
              const fs = Math.max(light ? 12 : 10, (isChosen ? (light ? 18 : 15) : light ? 14.5 : 12) * pp.p);
              ctx.font = `${isChosen ? 700 : light ? 650 : 500} ${fs}px ui-sans-serif, system-ui, sans-serif`;
              ctx.fillStyle = rgba(light ? "#111827" : "#e6e9ef", light ? Math.min(1, alpha) : alpha * 0.9);
              ctx.textBaseline = "middle";
              ctx.fillText(r.label + (st.dim && prob ? `  ${Math.round(prob * 100)}%` : ""), pp.sx + size + 8, pp.sy);
            }
          },
        });
        // sparks on this ring while deciding
        for (const s of sparks) {
          if (s.ring !== ri) continue;
          const sp = project(...ringPoint(r, theta - s.t * 2.2), yaw, pitch, cx, cy, zoom);
          planets.push({
            depth: sp.depth,
            draw: () => {
              const gs = 8 * sp.p;
              ctx.globalAlpha = 1 - s.t;
              ctx.drawImage(glow(sun), sp.sx - gs, sp.sy - gs, gs * 2, gs * 2);
              ctx.globalAlpha = 1;
            },
          });
        }
      });

      const drawCore = () => {
        const R = (compact ? 9 : 26) * core.p * (1 + 0.18 * st.breathe * Math.sin(st.t * 6));
        const gs = R * (3.4 + 1.6 * st.breathe);
        ctx.drawImage(glow(sun), core.sx - gs, core.sy - gs, gs * 2, gs * 2);
        ctx.fillStyle = sun;
        ctx.beginPath();
        ctx.arc(core.sx, core.sy, R, 0, Math.PI * 2);
        ctx.fill();
        const g2 = R * 1.1;
        ctx.drawImage(glow("#ffffff"), core.sx - g2, core.sy - g2, g2 * 2, g2 * 2);
        if (!compact) {
          ctx.font = `${light ? 700 : 600} ${Math.max(11, (light ? 16 : 13) * core.p)}px ui-sans-serif, system-ui, sans-serif`;
          ctx.fillStyle = light ? "rgba(17,24,39,0.95)" : "rgba(230,233,239,0.9)";
          ctx.textAlign = "center";
          ctx.textBaseline = "top";
          ctx.fillText(
            phase === "deciding" ? "deciding" : phase === "speaking" ? "speaking" : phase === "listening" ? "listening" : coreLabel,
            core.sx,
            core.sy + R + 8,
          );
          ctx.textAlign = "start";
        }
      };

      planets.sort((a, b) => b.depth - a.depth);
      ctx.lineCap = "round";
      for (const rp of ringPaths) { ctx.strokeStyle = rgba(rp.color, rp.alpha); ctx.lineWidth = rp.width; ctx.stroke(rp.back); }
      for (const p of planets) if (p.depth > 0) p.draw();
      drawCore();
      for (const rp of ringPaths) { ctx.strokeStyle = rgba(rp.color, rp.alpha); ctx.lineWidth = rp.width; ctx.stroke(rp.front); }
      for (const p of planets) if (p.depth <= 0) p.draw();
    };
    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      io.disconnect();
      mo.disconnect();
    };
  }, []);

  return <canvas ref={canvasRef} className="block h-full w-full" aria-hidden="true" />;
}
