import { PageHeader } from "@/components/PageHeader";
import { listCarousels } from "@/lib/carousels/store";
import { getActiveChannel } from "@/lib/channels/store";
import { personaSlugsForChannel } from "@/lib/channels/personas";
import { formatDateTime } from "@/lib/format";
import { DeleteCarouselButton } from "./DeleteCarouselButton";
import { SlideViewer } from "./SlideViewer";

export const metadata = { title: "Content · Marketing OS" };

function Chip({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded-full border border-black/[.08] bg-black/[.03] px-2 py-0.5 text-[11px] font-medium text-neutral-600 dark:border-white/[.14] dark:bg-white/[.07] dark:text-neutral-300">
      {children}
    </span>
  );
}

export default async function CarouselsPage() {
  const channel = await getActiveChannel();
  const slugs = await personaSlugsForChannel(channel);
  const carousels = listCarousels(slugs);

  return (
    <main className="w-full px-6 py-8">
      <PageHeader
        title="Content"
        description="Generated content for this channel — carousels, Reels and threads, exactly as they'll post."
      />

      {carousels.length === 0 ? (
        <p className="mt-6 rounded-2xl border border-dashed border-black/[.12] p-8 text-center text-sm text-neutral-500 dark:border-white/[.19]">
          No generated content yet. Run <code className="rounded bg-black/[.06] px-1 dark:bg-white/[.11]">carousel-gen</code> to create one.
        </p>
      ) : null}

      <div className="mt-6 flex flex-col gap-5">
        {carousels.map((c) => {
          const published = Boolean(c.publishedAt);
          return (
            <section
              key={`${c.persona}/${c.id}`}
              className="overflow-hidden rounded-2xl border border-black/[.08] bg-white dark:border-white/[.14] dark:bg-[var(--surface-1)]"
            >
              {/* Header */}
              <div className="flex flex-wrap items-start justify-between gap-3 border-b border-black/[.06] px-5 py-4 dark:border-white/[.12]">
                <div className="min-w-0">
                  <h2 className="truncate text-base font-semibold tracking-tight">{c.topic}</h2>
                  <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                    <Chip>@{c.persona}</Chip>
                    {c.visualPillar ? <Chip>{c.visualPillar}</Chip> : null}
                    {c.contentPillar ? <Chip>{c.contentPillar}</Chip> : null}
                    <Chip>{c.slideCount} slides</Chip>
                  </div>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1.5">
                  <span
                    className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${
                      published
                        ? "bg-[#2dd4bf] text-neutral-900"
                        : "bg-amber-400/20 text-amber-700 dark:text-amber-300"
                    }`}
                  >
                    {published ? `Published · ${c.zernioPlatform ?? ""}`.trim() : "Draft"}
                  </span>
                  {c.createdAt ? (
                    <span className="text-[11px] text-neutral-400">
                      {formatDateTime(c.createdAt)}
                    </span>
                  ) : null}
                  <DeleteCarouselButton persona={c.persona} id={c.id} topic={c.topic} />
                </div>
              </div>

              {/* Slides — click any slide to review the deck fullscreen */}
              <SlideViewer
                slides={c.slides.map((s) => ({
                  index: s.index,
                  src: s.src,
                  overlayText: s.overlayText,
                  kind: s.kind,
                }))}
                topic={c.topic}
              />

              {/* Captions + sound plan */}
              <div className="grid gap-4 border-t border-black/[.06] px-5 py-4 sm:grid-cols-2 dark:border-white/[.12]">
                <CaptionBlock
                  platform="TikTok"
                  caption={c.caption.tiktok}
                  soundNote="🎵 Trending sound auto-added by TikTok (autoAddMusic)"
                />
                <CaptionBlock
                  platform="Instagram"
                  caption={c.caption.instagram}
                  soundNote="🎵 Trending sound baked into slide 1 video, ≥15s (planned)"
                />
              </div>

              {/* Hashtags */}
              {c.hashtags.length ? (
                <div className="flex flex-wrap gap-1.5 border-t border-black/[.06] px-5 py-3 dark:border-white/[.12]">
                  {c.hashtags.map((h) => (
                    <span key={h} className="text-[11px] text-sky-600 dark:text-sky-400">
                      {h}
                    </span>
                  ))}
                </div>
              ) : null}
            </section>
          );
        })}
      </div>
    </main>
  );
}

function CaptionBlock({
  platform,
  caption,
  soundNote,
}: {
  platform: string;
  caption?: string;
  soundNote: string;
}) {
  return (
    <div>
      <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-neutral-500">
        {platform}
      </p>
      <p className="mt-1 whitespace-pre-wrap text-sm text-neutral-700 dark:text-neutral-300">
        {caption || <span className="text-neutral-400">No caption</span>}
      </p>
      <p className="mt-2 text-[11px] text-neutral-400">{soundNote}</p>
    </div>
  );
}
