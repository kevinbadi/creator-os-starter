"use client";

import {
  forceCenter,
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  forceX,
  forceY,
  type Simulation,
} from "d3-force";
import { useEffect, useLayoutEffect, useRef } from "react";
import { clusterColor, type Mode, type View, type VLink, type VNode } from "./graph-view";

type Props = {
  view: View;
  mode: Mode;
  dark: boolean;
  selectedId: string | null;
  /** Ordered node ids of a highlighted execution flow (symbols mode). */
  flowPath: string[] | null;
  /** Bumped by the parent to re-fit / re-run the layout. */
  fitSignal: number;
  relayoutSignal: number;
  /** Center the viewport on this node (set on search / panel navigation). */
  followId: string | null;
  onSelect: (id: string | null) => void;
  onDrill: (id: string) => void;
};

type Transform = { k: number; x: number; y: number };

const ACCENT = "#2dd4bf";
const LABEL_FONT = "500 11px var(--font-geist-sans), system-ui, sans-serif";
const CLUSTER_FONT = "600 12.5px var(--font-geist-sans), system-ui, sans-serif";
const SUB_FONT = "500 9.5px var(--font-geist-mono), ui-monospace, monospace";

export function GraphCanvas(props: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const propsRef = useRef(props);
  useLayoutEffect(() => {
    propsRef.current = props;
  });

  const simRef = useRef<Simulation<VNode, VLink> | null>(null);
  const tRef = useRef<Transform>({ k: 1, x: 0, y: 0 });
  const targetTRef = useRef<Transform | null>(null);
  const autoFitRef = useRef(true);
  const followRef = useRef<string | null>(null);
  const hoverRef = useRef<VNode | null>(null);
  const pointerRef = useRef<{ x: number; y: number } | null>(null);
  const dirtyRef = useRef(true);
  const rafRef = useRef<number | null>(null);
  const sizeRef = useRef({ w: 0, h: 0, dpr: 1 });
  /** Last known positions by id so switching views doesn't explode the layout. */
  const memoryRef = useRef(new Map<string, { x: number; y: number }>());
  const topLabelsRef = useRef(new Set<string>());
  const lastRelayoutRef = useRef(0);
  const dragRef = useRef<
    | { kind: "node"; node: VNode; moved: boolean; sx: number; sy: number }
    | { kind: "pan"; moved: boolean; sx: number; sy: number; ox: number; oy: number }
    | null
  >(null);

  const requestDraw = () => {
    dirtyRef.current = true;
    if (rafRef.current === null) rafRef.current = requestAnimationFrame(frame);
  };

  const frame = () => {
    rafRef.current = null;
    const sim = simRef.current;
    const running = sim ? sim.alpha() > sim.alphaMin() : false;

    // Smooth camera: auto-fit while the layout settles, or follow a node.
    if (autoFitRef.current && sim) targetTRef.current = fitTransform();
    if (followRef.current) {
      const n = propsRef.current.view.byId.get(followRef.current);
      if (n && n.x !== undefined && n.y !== undefined) {
        const { w, h } = sizeRef.current;
        const k = Math.max(tRef.current.k, 1.1);
        targetTRef.current = { k, x: w / 2 - n.x * k, y: h / 2 - n.y * k };
      }
      if (!running) followRef.current = null;
    }
    let camMoving = false;
    if (targetTRef.current) {
      const t = tRef.current;
      const g = targetTRef.current;
      const ease = 0.16;
      t.k += (g.k - t.k) * ease;
      t.x += (g.x - t.x) * ease;
      t.y += (g.y - t.y) * ease;
      if (Math.abs(g.k - t.k) < 1e-3 && Math.abs(g.x - t.x) < 0.3 && Math.abs(g.y - t.y) < 0.3) {
        tRef.current = { ...g };
        targetTRef.current = null;
      } else camMoving = true;
    }

    if (dirtyRef.current || running || camMoving) {
      draw();
      dirtyRef.current = false;
    }
    if (running || camMoving) rafRef.current = requestAnimationFrame(frame);
  };

  const fitTransform = (): Transform => {
    const all = propsRef.current.view.nodes;
    const { w, h } = sizeRef.current;
    if (!all.length || !w || !h) return tRef.current;
    // With a focus active, frame the core (non-dim) nodes; context stays at the edges.
    const core = all.filter((n) => !n.dim);
    const nodes = core.length ? core : all;
    let x0 = Infinity,
      y0 = Infinity,
      x1 = -Infinity,
      y1 = -Infinity;
    for (const n of nodes) {
      if (n.x === undefined || n.y === undefined) continue;
      x0 = Math.min(x0, n.x - n.r);
      y0 = Math.min(y0, n.y - n.r);
      x1 = Math.max(x1, n.x + n.r);
      y1 = Math.max(y1, n.y + n.r);
    }
    if (!Number.isFinite(x0)) return tRef.current;
    const pad = 48;
    const bw = Math.max(x1 - x0, 1);
    const bh = Math.max(y1 - y0, 1);
    const k = Math.min((w - pad * 2) / bw, (h - pad * 2) / bh, 2.2);
    return { k, x: w / 2 - ((x0 + x1) / 2) * k, y: h / 2 - ((y0 + y1) / 2) * k };
  };

  /* ───────────── layout ───────────── */
  // d3-force owns node positions and mutates the view's node objects in place;
  // that is the whole point of the simulation, so the immutability lint is off here.
  /* eslint-disable react-hooks/immutability */
  useEffect(() => {
    const { view, mode, relayoutSignal } = propsRef.current;
    const { nodes, links } = view;
    simRef.current?.stop();

    const mem = memoryRef.current;
    if (relayoutSignal !== lastRelayoutRef.current) {
      lastRelayoutRef.current = relayoutSignal;
      mem.clear();
      for (const n of nodes) {
        n.x = undefined;
        n.y = undefined;
        n.fx = null;
        n.fy = null;
      }
    }
    let seeded = 0;
    for (const n of nodes) {
      const m = mem.get(n.id);
      if (m) {
        n.x = m.x;
        n.y = m.y;
        seeded++;
      }
    }
    // Cluster anchors on a ring so functional areas settle into islands.
    const clusters = Array.from(new Set(nodes.map((n) => n.cluster))).sort((a, b) => a - b);
    const ring = mode === "files" ? 90 + 24 * Math.sqrt(clusters.length) : 140 + 30 * Math.sqrt(clusters.length);
    const anchor = new Map<number, { x: number; y: number }>();
    clusters.forEach((c, i) => {
      const a = (i / clusters.length) * Math.PI * 2 - Math.PI / 2;
      anchor.set(c, c < 0 ? { x: 0, y: 0 } : { x: Math.cos(a) * ring, y: Math.sin(a) * ring });
    });
    nodes.forEach((n, i) => {
      if (n.x !== undefined && n.y !== undefined) return;
      const a = anchor.get(n.cluster) ?? { x: 0, y: 0 };
      const jitter = mode === "clusters" ? 160 : 40;
      // Deterministic scatter (golden-angle spiral) so a fresh layout of the
      // same view lands the same way every time.
      const ang = i * 2.399963;
      const rad = Math.sqrt(i + 1) * jitter * 0.12;
      n.x = a.x + Math.cos(ang) * rad;
      n.y = a.y + Math.sin(ang) * rad;
    });

    const sim = forceSimulation<VNode, VLink>(nodes)
      .alphaDecay(seeded > nodes.length * 0.6 ? 0.05 : 0.026)
      .velocityDecay(0.38);

    if (mode === "clusters") {
      // Islands with no cross-talk would otherwise drift to distanceMax; the
      // x/y springs keep the whole map inside one compact frame.
      sim
        .force(
          "link",
          forceLink<VNode, VLink>(links)
            .distance((l) => 40 + l.source.r + l.target.r)
            .strength((l) => Math.min(0.6, 0.1 + Math.log2(l.w + 1) * 0.07)),
        )
        .force("charge", forceManyBody<VNode>().strength((d) => -220 - d.r * 6).distanceMax(700))
        .force("collide", forceCollide<VNode>((d) => d.r + 14).iterations(3))
        .force("x", forceX<VNode>(0).strength(0.09))
        .force("y", forceY<VNode>(0).strength(0.09))
        .force("center", forceCenter(0, 0));
    } else {
      const files = mode === "files";
      sim
        .force(
          "link",
          forceLink<VNode, VLink>(links)
            .distance(files ? 34 : 22)
            .strength((l) => (l.source.dim || l.target.dim ? 0.25 : 0.55)),
        )
        .force("charge", forceManyBody<VNode>().strength(files ? -80 : -30).distanceMax(files ? 520 : 420))
        .force("collide", forceCollide<VNode>((d) => d.r + (files ? 2.5 : 1.5)).iterations(1))
        .force("x", forceX<VNode>((d) => anchor.get(d.cluster)?.x ?? 0).strength(files ? 0.07 : 0.055))
        .force("y", forceY<VNode>((d) => anchor.get(d.cluster)?.y ?? 0).strength(files ? 0.07 : 0.055));
    }

    const ranked = [...nodes].sort((a, b) => b.degree - a.degree).slice(0, mode === "files" ? 28 : 40);
    topLabelsRef.current = new Set(ranked.map((n) => n.id));

    sim.on("tick", () => {
      for (const n of nodes) if (n.x !== undefined && n.y !== undefined) mem.set(n.id, { x: n.x, y: n.y });
      dirtyRef.current = true;
    });
    simRef.current = sim;
    autoFitRef.current = true;
    hoverRef.current = null;
    requestDraw();
    return () => {
      sim.stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.view, props.relayoutSignal]);
  /* eslint-enable react-hooks/immutability */

  useEffect(() => {
    if (props.fitSignal === 0) return;
    autoFitRef.current = true;
    followRef.current = null;
    requestDraw();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.fitSignal]);

  useEffect(() => {
    const id = props.followId?.split("#")[0];
    if (!id || !props.view.byId.has(id)) return;
    followRef.current = id;
    autoFitRef.current = false;
    requestDraw();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.followId, props.view]);

  useEffect(() => {
    requestDraw();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.dark, props.selectedId, props.flowPath]);

  /* ───────────── sizing ───────────── */
  useEffect(() => {
    const wrap = wrapRef.current;
    const canvas = canvasRef.current;
    if (!wrap || !canvas) return;
    const ro = new ResizeObserver(() => {
      const r = wrap.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      sizeRef.current = { w: r.width, h: r.height, dpr };
      canvas.width = Math.round(r.width * dpr);
      canvas.height = Math.round(r.height * dpr);
      canvas.style.width = `${r.width}px`;
      canvas.style.height = `${r.height}px`;
      requestDraw();
    });
    ro.observe(wrap);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ───────────── drawing ───────────── */
  const draw = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const { view, mode, dark, selectedId, flowPath } = propsRef.current;
    const { w, h, dpr } = sizeRef.current;
    const { k, x: tx, y: ty } = tRef.current;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    const hover = hoverRef.current;
    const selected = selectedId ? view.byId.get(selectedId) ?? null : null;
    const active = hover ?? selected;
    const neighbors = new Set<string>();
    if (active) {
      for (const l of view.links) {
        if (l.source === active) neighbors.add(l.target.id);
        else if (l.target === active) neighbors.add(l.source.id);
      }
    }
    const pathIds = flowPath && mode === "symbols" ? flowPath : null;
    const pathSet = pathIds ? new Set(pathIds) : null;
    const pathEdges = new Set<string>();
    if (pathIds) for (let i = 0; i < pathIds.length - 1; i++) pathEdges.add(`${pathIds[i]}>${pathIds[i + 1]}`);

    const ink = dark ? "#f4f5f7" : "#171717";
    const muted = dark ? "#c3c7ce" : "#6b7280";
    const lineBase = dark ? "255,255,255" : "0,0,0";

    // ── links (world space)
    ctx.save();
    ctx.translate(tx, ty);
    ctx.scale(k, k);
    ctx.lineCap = "round";
    for (const l of view.links) {
      const a = l.source;
      const b = l.target;
      if (a.x === undefined || b.x === undefined || a.y === undefined || b.y === undefined) continue;
      const onPath = pathEdges.has(`${a.id}>${b.id}`) || pathEdges.has(`${b.id}>${a.id}`);
      const touches = active ? a === active || b === active : false;
      let alpha: number;
      let width: number;
      // Cluster edges take the source island's hue; file/symbol edges stay neutral.
      let color = mode === "clusters" ? clusterColor(a.cluster, dark) : `rgb(${lineBase})`;
      if (mode === "clusters") {
        width = 0.9 + Math.log2(l.w + 1) * 0.9;
        alpha = 0.16 + Math.min(0.4, Math.log2(l.w + 1) * 0.06);
      } else {
        width = mode === "files" ? 0.9 : 0.7;
        alpha = mode === "files" ? 0.18 : 0.13;
      }
      if (pathSet) {
        if (onPath) {
          color = ACCENT;
          alpha = 0.95;
          width = 2.2;
        } else alpha *= 0.25;
      } else if (active) {
        if (touches) {
          color = ACCENT;
          alpha = 0.9;
          width += 0.8;
        } else alpha *= 0.3;
      }
      if (a.dim || b.dim) alpha *= 0.6;
      ctx.strokeStyle = withAlpha(color, alpha);
      ctx.lineWidth = width / Math.sqrt(k);
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
      if (onPath) drawArrow(ctx, a, b, k);
    }

    // ── nodes (world space)
    for (const n of view.nodes) {
      if (n.x === undefined || n.y === undefined) continue;
      const color = clusterColor(n.cluster, dark);
      let alpha = n.dim ? 0.42 : 1;
      if (pathSet) alpha *= pathSet.has(n.id) ? 1 : 0.14;
      else if (active) alpha *= n === active || neighbors.has(n.id) ? 1 : 0.22;
      ctx.globalAlpha = alpha;
      ctx.beginPath();
      ctx.arc(n.x, n.y, n.r, 0, Math.PI * 2);
      if (mode === "clusters") {
        ctx.fillStyle = withAlpha(color, dark ? 0.22 : 0.16);
        ctx.fill();
        ctx.lineWidth = 1.6 / Math.sqrt(k);
        ctx.strokeStyle = color;
        ctx.stroke();
      } else {
        ctx.fillStyle = color;
        ctx.fill();
        if (n.dim) {
          ctx.lineWidth = 1 / k;
          ctx.strokeStyle = dark ? "rgba(36,39,44,0.9)" : "rgba(255,255,255,0.9)";
          ctx.stroke();
        }
      }
      if (n === selected || n === hover) {
        ctx.globalAlpha = 1;
        ctx.beginPath();
        ctx.arc(n.x, n.y, n.r + 3.5 / k, 0, Math.PI * 2);
        ctx.lineWidth = 2 / k;
        ctx.strokeStyle = ACCENT;
        ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;
    ctx.restore();

    // ── labels (screen space for crisp constant-size text)
    ctx.textBaseline = "middle";
    if (mode === "clusters") {
      for (const n of view.nodes) {
        if (n.x === undefined || n.y === undefined) continue;
        const sx = n.x * k + tx;
        const sy = n.y * k + ty;
        const isActive = n === active || neighbors.has(n.id);
        const faded = active && !isActive;
        ctx.font = CLUSTER_FONT;
        ctx.textAlign = "center";
        ctx.fillStyle = faded ? withAlpha(ink, 0.3) : ink;
        strokeText(ctx, n.label, sx, sy - 6, dark);
        ctx.font = SUB_FONT;
        ctx.fillStyle = faded ? withAlpha(muted, 0.35) : muted;
        strokeText(ctx, n.sub.split(" · ")[0], sx, sy + 8, dark);
      }
    } else {
      // Candidates ranked (selected > active/neighbours > hubs), then greedily
      // placed with a screen-space rect check so labels never pile up.
      const showAll = k >= 2.4;
      const top = topLabelsRef.current;
      const cands: { n: VNode; sx: number; sy: number; pri: number; strong: boolean }[] = [];
      for (const n of view.nodes) {
        if (n.x === undefined || n.y === undefined) continue;
        const sx = n.x * k + tx;
        const sy = n.y * k + ty;
        if (sx < -80 || sy < -20 || sx > w + 80 || sy > h + 20) continue;
        // While a flow is lit, only its steps (and whatever is hovered) get names.
        const isActive = pathSet
          ? pathSet.has(n.id) || n === hover
          : n === active || neighbors.has(n.id);
        const passive = !active && !pathSet;
        const want = isActive || showAll || (passive && (top.has(n.id) || n.r * k >= 7)) || n.id === selectedId;
        if (!want) continue;
        if (!isActive && (active || pathSet)) continue;
        const pri = (n.id === selectedId ? 1e6 : 0) + (n === active ? 5e5 : 0) + (isActive ? 1e4 : 0) + n.degree;
        cands.push({ n, sx, sy, pri, strong: isActive });
      }
      cands.sort((a, b) => b.pri - a.pri);
      const placed: { x0: number; y0: number; x1: number; y1: number }[] = [];
      ctx.font = LABEL_FONT;
      ctx.textAlign = "left";
      for (const c of cands) {
        const tw = ctx.measureText(c.n.label).width;
        const x0 = c.sx + c.n.r * k + 5;
        const box = { x0: x0 - 2, y0: c.sy - 7, x1: x0 + tw + 2, y1: c.sy + 7 };
        let hit = false;
        for (const p of placed) {
          if (box.x0 < p.x1 && box.x1 > p.x0 && box.y0 < p.y1 && box.y1 > p.y0) {
            hit = true;
            break;
          }
        }
        // The selected / hovered node always gets its label, even if crowded.
        if (hit && !(c.n.id === selectedId || c.n === active)) continue;
        placed.push(box);
        ctx.fillStyle = c.n.dim && !c.strong ? withAlpha(ink, 0.55) : ink;
        strokeText(ctx, c.n.label, x0, c.sy, dark);
      }
    }

    // ── flow step badges
    if (pathIds) {
      pathIds.forEach((id, i) => {
        const n = view.byId.get(id);
        if (!n || n.x === undefined || n.y === undefined) return;
        const sx = n.x * k + tx;
        const sy = n.y * k + ty;
        const rr = 8;
        ctx.beginPath();
        ctx.arc(sx - n.r * k - 4, sy - n.r * k - 4, rr, 0, Math.PI * 2);
        ctx.fillStyle = ACCENT;
        ctx.fill();
        ctx.font = "700 9.5px var(--font-geist-mono), ui-monospace, monospace";
        ctx.textAlign = "center";
        ctx.fillStyle = "#0b1f1c";
        ctx.fillText(String(i + 1), sx - n.r * k - 4, sy - n.r * k - 3.5);
      });
    }

    // ── tooltip
    if (hover && pointerRef.current) {
      const p = pointerRef.current;
      ctx.font = LABEL_FONT;
      const l1 = hover.label;
      ctx.font = SUB_FONT;
      const l2 = hover.sub;
      ctx.font = LABEL_FONT;
      const w1 = ctx.measureText(l1).width;
      ctx.font = SUB_FONT;
      const w2 = ctx.measureText(l2).width;
      const bw = Math.max(w1, w2) + 20;
      const bh = 40;
      let bx = p.x + 14;
      let by = p.y + 14;
      if (bx + bw > w - 8) bx = p.x - bw - 14;
      if (by + bh > h - 8) by = p.y - bh - 14;
      ctx.fillStyle = dark ? "rgba(51,55,64,0.96)" : "rgba(255,255,255,0.97)";
      ctx.strokeStyle = dark ? "rgba(255,255,255,0.18)" : "rgba(0,0,0,0.12)";
      ctx.lineWidth = 1;
      roundRect(ctx, bx, by, bw, bh, 7);
      ctx.fill();
      ctx.stroke();
      ctx.textAlign = "left";
      ctx.font = LABEL_FONT;
      ctx.fillStyle = ink;
      ctx.fillText(l1, bx + 10, by + 13);
      ctx.font = SUB_FONT;
      ctx.fillStyle = muted;
      ctx.fillText(l2, bx + 10, by + 28);
    }
  };

  /* ───────────── interaction ───────────── */
  const nodeAt = (sx: number, sy: number): VNode | null => {
    const { view } = propsRef.current;
    const { k, x: tx, y: ty } = tRef.current;
    const wx = (sx - tx) / k;
    const wy = (sy - ty) / k;
    let best: VNode | null = null;
    let bestD = Infinity;
    for (const n of view.nodes) {
      if (n.x === undefined || n.y === undefined) continue;
      const hit = Math.max(n.r, 6 / k) + 2 / k;
      const dx = n.x - wx;
      const dy = n.y - wy;
      const d = dx * dx + dy * dy;
      if (d <= hit * hit && d < bestD) {
        best = n;
        bestD = d;
      }
    }
    return best;
  };

  const local = (e: React.PointerEvent | React.WheelEvent) => {
    const r = canvasRef.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (e.button !== 0) return;
    const p = local(e);
    canvasRef.current?.setPointerCapture(e.pointerId);
    autoFitRef.current = false;
    followRef.current = null;
    targetTRef.current = null;
    const n = nodeAt(p.x, p.y);
    if (n) {
      dragRef.current = { kind: "node", node: n, moved: false, sx: p.x, sy: p.y };
      n.fx = n.x;
      n.fy = n.y;
    } else {
      dragRef.current = { kind: "pan", moved: false, sx: p.x, sy: p.y, ox: tRef.current.x, oy: tRef.current.y };
    }
  };

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const p = local(e);
    pointerRef.current = p;
    const d = dragRef.current;
    if (d) {
      const dx = p.x - d.sx;
      const dy = p.y - d.sy;
      if (!d.moved && Math.hypot(dx, dy) > 3) d.moved = true;
      if (!d.moved) return;
      if (d.kind === "pan") {
        tRef.current = { ...tRef.current, x: d.ox + dx, y: d.oy + dy };
      } else {
        const { k, x: tx, y: ty } = tRef.current;
        d.node.fx = (p.x - tx) / k;
        d.node.fy = (p.y - ty) / k;
        const sim = simRef.current;
        if (sim && sim.alpha() < 0.12) sim.alpha(0.12).restart();
      }
      requestDraw();
      return;
    }
    const n = nodeAt(p.x, p.y);
    if (n !== hoverRef.current) {
      hoverRef.current = n;
      if (canvasRef.current) canvasRef.current.style.cursor = n ? "pointer" : "grab";
    }
    requestDraw();
  };

  const onPointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const d = dragRef.current;
    dragRef.current = null;
    canvasRef.current?.releasePointerCapture(e.pointerId);
    if (!d) return;
    if (d.kind === "node") {
      d.node.fx = null;
      d.node.fy = null;
      if (!d.moved) propsRef.current.onSelect(d.node.id);
    } else if (!d.moved) {
      propsRef.current.onSelect(null);
    }
    requestDraw();
  };

  const onPointerLeave = () => {
    hoverRef.current = null;
    pointerRef.current = null;
    requestDraw();
  };

  const onDoubleClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const r = canvasRef.current!.getBoundingClientRect();
    const n = nodeAt(e.clientX - r.left, e.clientY - r.top);
    if (n) propsRef.current.onDrill(n.id);
  };

  const onWheel = (e: React.WheelEvent<HTMLCanvasElement>) => {
    const p = local(e);
    const t = tRef.current;
    const factor = Math.exp(-e.deltaY * 0.0022);
    const k = Math.min(9, Math.max(0.12, t.k * factor));
    const wx = (p.x - t.x) / t.k;
    const wy = (p.y - t.y) / t.k;
    tRef.current = { k, x: p.x - wx * k, y: p.y - wy * k };
    autoFitRef.current = false;
    followRef.current = null;
    targetTRef.current = null;
    requestDraw();
  };

  // Non-passive wheel listener so the page doesn't scroll under the graph.
  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    const stop = (e: WheelEvent) => e.preventDefault();
    c.addEventListener("wheel", stop, { passive: false });
    return () => c.removeEventListener("wheel", stop);
  }, []);

  return (
    <div ref={wrapRef} className="relative h-full w-full overflow-hidden">
      <canvas
        ref={canvasRef}
        className="block h-full w-full touch-none select-none"
        style={{ cursor: "grab" }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onPointerLeave={onPointerLeave}
        onDoubleClick={onDoubleClick}
        onWheel={onWheel}
      />
    </div>
  );
}

function withAlpha(color: string, a: number): string {
  if (color.startsWith("hsl(")) return color.replace(")", ` / ${a})`);
  if (color.startsWith("rgb(")) return color.replace("rgb(", "rgba(").replace(")", `,${a})`);
  if (color.startsWith("#")) {
    const h = color.slice(1);
    const n = parseInt(h.length === 3 ? h.split("").map((c) => c + c).join("") : h, 16);
    return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
  }
  return color;
}

function strokeText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, dark: boolean) {
  ctx.lineJoin = "round";
  ctx.lineWidth = 3;
  ctx.strokeStyle = dark ? "rgba(36,39,44,0.85)" : "rgba(244,245,247,0.9)";
  ctx.strokeText(text, x, y);
  ctx.fillText(text, x, y);
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function drawArrow(ctx: CanvasRenderingContext2D, a: VNode, b: VNode, k: number) {
  if (a.x === undefined || a.y === undefined || b.x === undefined || b.y === undefined) return;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len;
  const uy = dy / len;
  const tipX = b.x - ux * (b.r + 2 / k);
  const tipY = b.y - uy * (b.r + 2 / k);
  const s = 6 / Math.sqrt(k);
  ctx.beginPath();
  ctx.moveTo(tipX, tipY);
  ctx.lineTo(tipX - ux * s - uy * s * 0.55, tipY - uy * s + ux * s * 0.55);
  ctx.lineTo(tipX - ux * s + uy * s * 0.55, tipY - uy * s - ux * s * 0.55);
  ctx.closePath();
  ctx.fillStyle = ACCENT;
  ctx.fill();
}
