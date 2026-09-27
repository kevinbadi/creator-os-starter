"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type Slide = { index: number; src: string; overlayText?: string; kind?: "image" | "video" };

/**
 * Slide strip + fullscreen review mode. Clicking a slide opens it in true
 * fullscreen (whole monitor via the Fullscreen API, falling back to a fixed
 * overlay). Click the right/left half of the screen — or use ←/→ — to move
 * through the deck; Esc (or ✕) closes.
 */
export function SlideViewer({ slides, topic }: { slides: Slide[]; topic: string }) {
  const [open, setOpen] = useState<number | null>(null); // index into slides[]
  const overlayRef = useRef<HTMLDivElement>(null);

  const close = useCallback(() => {
    setOpen(null);
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  }, []);

  const step = useCallback(
    (dir: 1 | -1) => {
      setOpen((cur) =>
        cur === null ? cur : (cur + dir + slides.length) % slides.length,
      );
    },
    [slides.length],
  );

  // Enter fullscreen when the overlay mounts; leave state in sync if the user
  // exits fullscreen via the browser (Esc handled by fullscreenchange).
  useEffect(() => {
    if (open === null) return;
    const el = overlayRef.current;
    el?.requestFullscreen?.().catch(() => {}); // overlay still works without FS
    const onFsChange = () => {
      if (!document.fullscreenElement) setOpen(null);
    };
    document.addEventListener("fullscreenchange", onFsChange);
    return () => document.removeEventListener("fullscreenchange", onFsChange);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open === null]);

  useEffect(() => {
    if (open === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight" || e.key === " ") step(1);
      else if (e.key === "ArrowLeft") step(-1);
      else if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, step, close]);

  const cur = open !== null ? slides[open] : null;
  const next = open !== null ? slides[(open + 1) % slides.length] : null;

  return (
    <>
      {/* Thumbnail strip */}
      <div className="flex gap-3 overflow-x-auto px-5 py-4">
        {slides.map((s, i) => (
          <figure key={s.index} className="shrink-0">
            <button
              type="button"
              onClick={() => setOpen(i)}
              title="Review fullscreen"
              className="group relative block h-72 w-auto cursor-zoom-in overflow-hidden rounded-xl border border-black/[.08] bg-neutral-100 transition hover:border-black/30 dark:border-white/[.14] dark:bg-[var(--surface-2)] dark:hover:border-white/40"
            >
              {s.kind === "video" ? (
                <video
                  src={s.src}
                  muted
                  loop
                  autoPlay
                  playsInline
                  className="h-72 w-auto object-contain"
                />
              ) : (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={s.src} alt={`Slide ${s.index}`} className="h-72 w-auto object-contain" />
              )}
              <span className="absolute left-2 top-2 rounded-md bg-black/60 px-1.5 py-0.5 text-[10px] font-semibold text-white">
                {s.kind === "video" ? "▶" : s.index}
              </span>
              <span className="absolute right-2 top-2 rounded-md bg-black/60 px-1.5 py-0.5 text-[10px] font-semibold text-white opacity-0 transition group-hover:opacity-100">
                ⛶
              </span>
            </button>
            {s.overlayText ? (
              <figcaption className="mt-1.5 max-w-[12rem] truncate text-[11px] text-neutral-500">
                {s.overlayText}
              </figcaption>
            ) : null}
          </figure>
        ))}
      </div>

      {/* Fullscreen review overlay */}
      {cur ? (
        <div
          ref={overlayRef}
          className="fixed inset-0 z-50 flex select-none flex-col bg-black"
        >
          {/* Top bar */}
          <div className="flex items-center justify-between px-5 py-3 text-sm text-neutral-300">
            <span className="truncate pr-4 font-medium">{topic}</span>
            <div className="flex items-center gap-4">
              <span className="tabular-nums text-neutral-400">
                {open! + 1} / {slides.length}
              </span>
              <button
                type="button"
                onClick={close}
                className="rounded-md px-2 py-1 text-lg leading-none text-neutral-300 transition hover:bg-white/10 hover:text-white"
                aria-label="Close"
              >
                ✕
              </button>
            </div>
          </div>

          {/* Slide — click left/right half to navigate */}
          <div className="relative min-h-0 flex-1">
            {cur.kind === "video" ? (
              <video
                src={cur.src}
                controls
                autoPlay
                playsInline
                className="mx-auto h-full w-auto object-contain"
              />
            ) : (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={cur.src}
                alt={`Slide ${cur.index}`}
                className="mx-auto h-full w-auto object-contain"
              />
            )}
            {/* preload the next slide so stepping is instant */}
            {next && next.src !== cur.src && next.kind !== "video" ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={next.src} alt="" className="hidden" />
            ) : null}
            <button
              type="button"
              onClick={() => step(-1)}
              aria-label="Previous slide"
              className="group absolute inset-y-0 left-0 w-1/3 cursor-w-resize"
            >
              <span className="absolute left-4 top-1/2 -translate-y-1/2 rounded-full bg-white/10 px-3.5 py-2.5 text-xl text-white opacity-0 transition group-hover:opacity-100">
                ←
              </span>
            </button>
            <button
              type="button"
              onClick={() => step(1)}
              aria-label="Next slide"
              className="group absolute inset-y-0 right-0 w-2/3 cursor-e-resize"
            >
              <span className="absolute right-4 top-1/2 -translate-y-1/2 rounded-full bg-white/10 px-3.5 py-2.5 text-xl text-white opacity-0 transition group-hover:opacity-100">
                →
              </span>
            </button>
          </div>

          {/* Bottom: overlay text + dot progress */}
          <div className="flex flex-col items-center gap-2 px-6 pb-4 pt-2">
            {cur.overlayText ? (
              <p className="max-w-3xl truncate text-center text-sm text-neutral-400">
                {cur.overlayText}
              </p>
            ) : null}
            <div className="flex items-center gap-1.5">
              {slides.map((s, i) => (
                <button
                  key={s.index}
                  type="button"
                  onClick={() => setOpen(i)}
                  aria-label={`Go to slide ${s.index}`}
                  className={`size-2 rounded-full transition ${
                    i === open ? "bg-white" : "bg-white/25 hover:bg-white/50"
                  }`}
                />
              ))}
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
