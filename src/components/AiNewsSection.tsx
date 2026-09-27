import Link from "next/link";
import { relativeTime } from "@/lib/format";
import { AiNewsEmptyLanes, AiNewsList } from "@/components/AiNewsFeed";
import type { AiNewsCounts, AiNewsItem } from "@/lib/ai-news/store";

export function AiNewsSection({
  items,
  counts,
}: {
  items: AiNewsItem[];
  counts: AiNewsCounts;
}) {
  return (
    <section className="mt-4 rounded-2xl border border-black/[.08] bg-white p-4 dark:border-white/[.14] dark:bg-[var(--surface-1)]">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-xs font-semibold uppercase tracking-wider text-neutral-500">
            AI news, tools, and ideas
            {counts.total > 0 ? (
              <span className="ml-2 font-normal normal-case tracking-normal tabular-nums text-neutral-400">
                {counts.total}
              </span>
            ) : null}
          </h2>
          <p className="mt-0.5 text-[11px] text-neutral-400">
            {counts.lastIngestedAt
              ? `Last drop ${relativeTime(counts.lastIngestedAt)}`
              : "Ingest idle — automations will land drops here as they break."}
          </p>
        </div>
        <Link
          href="/dashboard/news"
          className="shrink-0 text-xs text-neutral-600 hover:underline dark:text-[#b6bac2]"
        >
          View all
        </Link>
      </div>

      {items.length === 0 ? (
        <AiNewsEmptyLanes />
      ) : (
        <AiNewsList items={items} compact />
      )}
    </section>
  );
}
