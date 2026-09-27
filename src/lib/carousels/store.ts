import "server-only";
import fs from "fs";
import path from "path";

// Review surface for generated carousels. Reads the on-disk output of the
// carousel-gen skill (`.claude/brand-content/{persona}/carousels/{slug}/`),
// so you can eyeball slides + captions before anything is published.
// Slide images are served through /api/carousels/file (sandboxed to this dir).

const BRAND_BASE = path.join(process.cwd(), ".claude", "brand-content");

export type CarouselSlide = {
  index: number;
  overlayText?: string;
  src: string; // API url to the local image/video
  kind: "image" | "video"; // reaction reels put an mp4 in the deck
};

export type Carousel = {
  persona: string;
  id: string; // directory name
  carouselId?: string;
  topic: string;
  contentPillar?: string;
  visualPillar?: string;
  slideCount: number;
  slides: CarouselSlide[];
  caption: { tiktok?: string; instagram?: string };
  hashtags: string[];
  createdAt?: string;
  publishedAt?: string;
  zernioPostId?: string;
  zernioPlatform?: string;
};

function fileUrl(relFromBase: string, version: number): string {
  // Normalize to forward slashes so the URL is stable across platforms.
  const rel = relFromBase.split(path.sep).join("/");
  // `v` = file mtime, so a re-rendered slide gets a fresh URL and bypasses the
  // browser cache (the API route ignores `v` and always reads from disk).
  return `/api/carousels/file?p=${encodeURIComponent(rel)}&v=${version}`;
}

/** Generated carousels, newest first. Pass `personas` to scope to a channel. */
export function listCarousels(personas?: string[]): Carousel[] {
  if (!fs.existsSync(BRAND_BASE)) return [];
  const allow = Array.isArray(personas) ? new Set(personas) : null;
  const out: Carousel[] = [];

  for (const persona of fs.readdirSync(BRAND_BASE, { withFileTypes: true })) {
    if (!persona.isDirectory()) continue;
    if (allow && !allow.has(persona.name)) continue;
    const carouselsDir = path.join(BRAND_BASE, persona.name, "carousels");
    if (!fs.existsSync(carouselsDir)) continue;

    for (const dir of fs.readdirSync(carouselsDir, { withFileTypes: true })) {
      if (!dir.isDirectory()) continue;
      // Prefer the texted (as-it-will-post) version when the overlay pass has run.
      const textedSidecar = path.join(carouselsDir, dir.name, "texted", "carousel.json");
      const sidecar = fs.existsSync(textedSidecar)
        ? textedSidecar
        : path.join(carouselsDir, dir.name, "carousel.json");
      if (!fs.existsSync(sidecar)) continue;

      let meta: Record<string, unknown>;
      try {
        meta = JSON.parse(fs.readFileSync(sidecar, "utf8"));
      } catch {
        continue;
      }

      const rawSlides = Array.isArray(meta.slides) ? meta.slides : [];
      const slides: CarouselSlide[] = [];
      for (const s of rawSlides as Array<Record<string, unknown>>) {
        const lp = typeof s.localPath === "string" ? s.localPath : "";
        if (!lp || !fs.existsSync(lp)) {
          // Remote-hosted slide (e.g. clip-bank additions stored on Insforge):
          // no local file, the sidecar carries the https url directly.
          const remote = typeof s.url === "string" && /^https:\/\//.test(s.url) ? s.url : null;
          if (remote) {
            slides.push({
              index: Number(s.index ?? slides.length + 1),
              overlayText: typeof s.overlayText === "string" ? s.overlayText : undefined,
              src: remote,
              kind: /\.(mp4|mov)(\?|$)/i.test(remote) ? "video" : "image",
            });
          }
          continue;
        }
        const rel = path.relative(BRAND_BASE, lp);
        if (rel.startsWith("..")) continue; // outside the sandbox — skip
        const mtime = Math.round(fs.statSync(lp).mtimeMs);
        slides.push({
          index: Number(s.index ?? slides.length + 1),
          overlayText: typeof s.overlayText === "string" ? s.overlayText : undefined,
          src: fileUrl(rel, mtime),
          kind: /\.(mp4|mov)$/i.test(lp) ? "video" : "image",
        });
      }

      const caption = (meta.caption ?? {}) as Record<string, unknown>;
      out.push({
        persona: persona.name,
        id: dir.name,
        carouselId: typeof meta.carousel_id === "string" ? meta.carousel_id : undefined,
        topic: typeof meta.topic === "string" ? meta.topic : dir.name,
        contentPillar: typeof meta.content_pillar === "string" ? meta.content_pillar : undefined,
        visualPillar: typeof meta.visual_pillar === "string" ? meta.visual_pillar : undefined,
        slideCount: typeof meta.slide_count === "number" ? meta.slide_count : slides.length,
        slides,
        caption: {
          tiktok: typeof caption.tiktok === "string" ? caption.tiktok : undefined,
          instagram: typeof caption.instagram === "string" ? caption.instagram : undefined,
        },
        hashtags: Array.isArray(meta.hashtags) ? (meta.hashtags as string[]) : [],
        createdAt: typeof meta.created_at === "string" ? meta.created_at : undefined,
        publishedAt: typeof meta.published_at === "string" ? meta.published_at : undefined,
        zernioPostId: typeof meta.zernio_post_id === "string" ? meta.zernio_post_id : undefined,
        zernioPlatform: typeof meta.zernio_platform === "string" ? meta.zernio_platform : undefined,
      });
    }
  }

  return out.sort((a, b) =>
    (b.createdAt ?? b.id).localeCompare(a.createdAt ?? a.id),
  );
}
