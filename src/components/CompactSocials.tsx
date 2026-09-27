"use client";

import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { PlatformDot } from "./PlatformBadge";
import { formatNumber, platformLabel } from "@/lib/format";

// Icon-dense connected-socials row (Kevin 2026-07-14: "only show icons and
// follower counts unless i hover"). Avatars pick the column/row count that
// maximises size inside the stretched card so a short list still fills it.

export type CompactAccount = {
  id: string;
  username: string | null;
  platform: string;
  pic: string | null;
  followers: number;
  url: string | null;
  dayGain: number | null;
};

type Tip = { left: number; top: number; acct: CompactAccount };

const AVATAR_MIN = 32;
const AVATAR_MAX = 64;
const LABEL = 36;
const GAP = 10;

const NUM_OUTLINE: CSSProperties = {
  textShadow:
    "-1.5px -1.5px 0 #000, 1.5px -1.5px 0 #000, -1.5px 1.5px 0 #000, 1.5px 1.5px 0 #000, -2px 0 0 #000, 2px 0 0 #000, 0 -2px 0 #000, 0 2px 0 #000, 0 2px 3px rgba(0,0,0,.5)",
};

function fit(n: number, w: number, h: number) {
  let best = { cols: Math.max(1, n), px: AVATAR_MIN };
  if (n <= 0 || w <= 0 || h <= 0) return best;
  for (let cols = 1; cols <= n; cols++) {
    const rows = Math.ceil(n / cols);
    const px = Math.min(AVATAR_MAX, h / rows - LABEL, w / cols - GAP);
    if (px > best.px) best = { cols, px };
  }
  return { cols: best.cols, px: Math.max(AVATAR_MIN, Math.floor(best.px)) };
}

export function CompactSocials({ items }: { items: CompactAccount[] }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [tip, setTip] = useState<Tip | null>(null);
  const ranked = useMemo(
    () => [...items].sort((a, b) => b.followers - a.followers || a.platform.localeCompare(b.platform)),
    [items],
  );
  const [layout, setLayout] = useState({ cols: Math.max(1, ranked.length), px: AVATAR_MIN });

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const measure = () => setLayout(fit(ranked.length, el.clientWidth, el.clientHeight));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ranked.length]);

  function show(e: React.MouseEvent<HTMLElement>, acct: CompactAccount) {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const w = wrap.getBoundingClientRect();
    const r = e.currentTarget.getBoundingClientRect();
    setTip({ left: r.left - w.left + r.width / 2, top: r.top - w.top - 8, acct });
  }

  const { cols, px } = layout;
  const numPx = Math.round(Math.min(20, Math.max(13, px * 0.4)));

  return (
    <div
      ref={wrapRef}
      className="relative grid h-full min-h-9 w-full content-center items-center justify-items-center gap-x-2 gap-y-1"
      style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}
    >
      {ranked.map((a) => {
        const inner = (
          <>
            <span className="relative inline-block shrink-0" style={{ width: px, height: px }}>
              {a.pic ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={a.pic}
                  alt=""
                  referrerPolicy="no-referrer"
                  className="size-full rounded-full object-cover ring-1 ring-black/[.06] dark:ring-white/[.08]"
                />
              ) : (
                <span className="block size-full rounded-full bg-neutral-200 dark:bg-[var(--surface-3)]" />
              )}
              <span className="absolute -bottom-0.5 -right-0.5">
                <PlatformDot platform={a.platform} />
              </span>
            </span>
            <span className="mt-1 flex max-w-full flex-col items-center justify-center gap-0.5 leading-none">
              <span
                className="num font-extrabold tracking-tight text-white"
                style={{ fontSize: numPx, ...NUM_OUTLINE }}
              >
                {formatNumber(a.followers)}
              </span>
              {a.dayGain ? (
                <span
                  className={`font-semibold tabular-nums ${
                    a.dayGain > 0 ? "text-emerald-400" : "text-red-400"
                  }`}
                  style={{ fontSize: Math.max(10, Math.round(numPx * 0.7)), ...NUM_OUTLINE }}
                >
                  {a.dayGain > 0 ? "▲" : "▼"}
                  {formatNumber(Math.abs(a.dayGain))}
                </span>
              ) : null}
            </span>
          </>
        );
        const cls = "flex min-h-0 w-full min-w-0 flex-col items-center justify-center gap-0.5 transition-transform hover:scale-105";
        return a.url ? (
          <a
            key={a.id}
            href={a.url}
            target="_blank"
            rel="noreferrer"
            className={cls}
            onMouseEnter={(e) => show(e, a)}
            onMouseLeave={() => setTip(null)}
          >
            {inner}
          </a>
        ) : (
          <span
            key={a.id}
            className={cls}
            onMouseEnter={(e) => show(e, a)}
            onMouseLeave={() => setTip(null)}
          >
            {inner}
          </span>
        );
      })}

      {tip ? (
        <div
          className="pointer-events-none absolute z-20 -translate-x-1/2 -translate-y-full whitespace-nowrap rounded-md bg-neutral-900 px-2 py-1 text-[11px] text-white shadow-lg dark:bg-[var(--surface-3)]"
          style={{ left: tip.left, top: tip.top }}
        >
          <span className="font-semibold">
            {tip.acct.username ? `@${tip.acct.username}` : "Account"}
          </span>
          <span className="mx-1 text-neutral-500">·</span>
          {platformLabel(tip.acct.platform)}
          <span className="mx-1 text-neutral-500">·</span>
          <span className="tabular-nums">{tip.acct.followers.toLocaleString()} followers</span>
          {tip.acct.dayGain != null && tip.acct.dayGain !== 0 ? (
            <span
              className={`ml-1.5 font-semibold tabular-nums ${
                tip.acct.dayGain > 0 ? "text-emerald-400" : "text-rose-400"
              }`}
            >
              {tip.acct.dayGain > 0 ? "▲" : "▼"}
              {formatNumber(Math.abs(tip.acct.dayGain))} today
            </span>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
