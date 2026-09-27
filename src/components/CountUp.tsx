"use client";

import { useEffect, useRef, useState } from "react";

// Animated numeral for KPI values. Takes the already-formatted string
// ("88,496", "1.2k", "910.8k", "CA$12.4k", "495") and counts the numeric part
// up from zero with an expo-out ease, preserving prefix, suffix, grouping and
// decimals. Server renders the final value; the client swaps in the count-up
// on mount so nothing flashes and reduced-motion users see the number at once.
export function CountUp({ value, duration = 1100 }: { value: string; duration?: number }) {
  const [shown, setShown] = useState(value);
  const raf = useRef<number | null>(null);

  useEffect(() => {
    const m = value.match(/^([^\d]*)([\d,]*\.?\d+)(.*)$/);
    if (!m) {
      setShown(value);
      return;
    }
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
      setShown(value);
      return;
    }
    const [, prefix, numRaw, suffix] = m;
    const target = Number(numRaw.replace(/,/g, ""));
    if (!Number.isFinite(target)) {
      setShown(value);
      return;
    }
    const decimals = (numRaw.split(".")[1] ?? "").length;
    const grouped = numRaw.includes(",");
    const fmt = (n: number) =>
      grouped
        ? n.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals })
        : n.toFixed(decimals);
    const t0 = performance.now();
    const tick = (now: number) => {
      const p = Math.min(1, (now - t0) / duration);
      const e = 1 - Math.pow(2, -10 * p);
      setShown(`${prefix}${fmt(target * e)}${suffix}`);
      if (p < 1) raf.current = requestAnimationFrame(tick);
      else setShown(value);
    };
    raf.current = requestAnimationFrame(tick);
    return () => {
      if (raf.current) cancelAnimationFrame(raf.current);
    };
  }, [value, duration]);

  return <>{shown}</>;
}
