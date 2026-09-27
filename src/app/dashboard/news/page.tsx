import { PageHeader } from "@/components/PageHeader";
import {
  AiNewsBriefCard,
  AiNewsEmptyLanes,
  AiNewsList,
  AiNewsViewBar,
} from "@/components/AiNewsFeed";
import { isAiNewsView, latestAiNewsBrief, listAiNewsView } from "@/lib/ai-news/store";
import type { AiNewsView } from "@/lib/ai-news/store";

export const metadata = { title: "AI news, tools, and ideas · Marketing OS" };
export const dynamic = "force-dynamic";

const VIEW_BLURB: Record<AiNewsView, string> = {
  top: "The agent's daily top-100: every source ranked by how strong it is as a KevBuildsApps video.",
  repos: "GitHub trending today plus the most-starred AI / LLM / agent / MCP repos created this week.",
  products: "Product Hunt launches from the last day, ranked by votes.",
  models: "Hugging Face trending models and the day's curated papers.",
  stories: "Hacker News front page, OpenAI, DeepMind, TechCrunch and The Verge, plus releases from watched repos.",
  ideas: "Video ideas the agent wrote from today's list.",
  saved: "Everything you starred, across days.",
};

export default async function AiNewsPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string; day?: string }>;
}) {
  const { view: rawView, day: rawDay } = await searchParams;
  const view: AiNewsView = isAiNewsView(rawView) ? rawView : "top";
  const day = rawDay && /^\d{4}-\d{2}-\d{2}$/.test(rawDay) ? rawDay : null;
  const [brief, list] = await Promise.all([
    latestAiNewsBrief(),
    listAiNewsView(view, { day, limit: view === "top" ? 100 : 120 }),
  ]);

  return (
    <main className="w-full px-6 pb-6 pt-4">
      <PageHeader
        title="AI news, tools, and ideas"
        description="The daily AI news agent runs at 7 ET: Product Hunt, GitHub, Hacker News, Hugging Face and the big-lab feeds, ranked for video-worthiness."
      />

      {brief ? <AiNewsBriefCard brief={brief} /> : null}

      <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
        <AiNewsViewBar active={view} />
        <p className="text-[11px] text-neutral-400">
          {list.day ? `${list.day} · ` : ""}
          {list.items.length} items
        </p>
      </div>
      <p className="mt-1.5 text-[11px] text-neutral-500 dark:text-[#b6bac2]">{VIEW_BLURB[view]}</p>

      <div className="mt-3 rounded-2xl border border-black/[.08] bg-white px-4 dark:border-white/[.14] dark:bg-[var(--surface-1)]">
        {list.items.length === 0 ? (
          <div className="py-4">
            <AiNewsEmptyLanes />
          </div>
        ) : (
          <AiNewsList items={list.items} ranked={view === "top"} />
        )}
      </div>
    </main>
  );
}
