import type { ReactNode } from "react";
import Link from "next/link";
import { relativeTime } from "@/lib/format";
import { markAiNewsStatus } from "@/lib/ai-news/actions";
import type { AiNewsBrief, AiNewsItem, AiNewsKind, AiNewsStatus, AiNewsView } from "@/lib/ai-news/store";

const KIND: Record<
  AiNewsKind,
  { label: string; cls: string }
> = {
  news: {
    label: "News",
    cls: "bg-teal-500/15 text-teal-800 dark:text-teal-300",
  },
  tool: {
    label: "Tool",
    cls: "bg-sky-500/15 text-sky-800 dark:text-sky-300",
  },
  idea: {
    label: "Idea",
    cls: "bg-amber-500/15 text-amber-800 dark:text-amber-300",
  },
};

export function AiNewsKindBadge({ kind }: { kind: AiNewsKind }) {
  const k = KIND[kind];
  return (
    <span
      className={`rounded-full px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide ${k.cls}`}
    >
      {k.label}
    </span>
  );
}

function ScorePill({ score }: { score: number | null }) {
  if (score == null) return null;
  const tone =
    score >= 8
      ? "bg-teal-500 text-white"
      : score >= 6
        ? "bg-teal-500/20 text-teal-800 dark:text-teal-200"
        : "bg-black/[.05] text-neutral-500 dark:bg-white/[.08] dark:text-neutral-400";
  return (
    <span
      title="Video-worthiness (agent, 0-10)"
      className={`rounded-md px-1.5 py-0.5 text-[10px] font-semibold tabular-nums ${tone}`}
    >
      {score}
    </span>
  );
}

export function AiNewsItemRow({
  item,
  compact,
  rank,
}: {
  item: AiNewsItem;
  compact?: boolean;
  rank?: number;
}) {
  const when = item.publishedAt ?? item.ingestedAt;
  const title = (
    <span className="font-medium leading-snug text-neutral-900 dark:text-neutral-100">
      {item.title}
    </span>
  );
  return (
    <li className="flex gap-3 py-2.5">
      {rank != null ? (
        <span className="mt-1 w-7 shrink-0 text-right font-serif text-[15px] italic tabular-nums text-neutral-400">
          {rank}
        </span>
      ) : null}
      {item.imageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={item.imageUrl}
          alt=""
          className="mt-0.5 size-11 shrink-0 rounded-lg object-cover bg-black/[.04] dark:bg-white/[.08]"
        />
      ) : (
        <span
          aria-hidden
          className="mt-0.5 flex size-11 shrink-0 items-center justify-center rounded-lg border border-black/[.06] text-[10px] font-semibold uppercase tracking-wider text-neutral-400 dark:border-white/[.10]"
        >
          {item.kind[0]}
        </span>
      )}
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <ScorePill score={item.videoScore} />
          <AiNewsKindBadge kind={item.kind} />
          {item.signal ? (
            <span className="text-[10px] font-medium tabular-nums text-neutral-500 dark:text-neutral-400">
              {item.signal}
            </span>
          ) : null}
          {item.status === "saved" ? (
            <span className="text-[9px] font-semibold uppercase tracking-wide text-neutral-400">
              saved
            </span>
          ) : null}
          <span className="text-[10px] tabular-nums text-neutral-400">
            {relativeTime(when)}
            {item.source && item.source !== "manual" ? ` · ${item.source}` : ""}
          </span>
        </div>
        {item.url ? (
          <a
            href={item.url}
            target="_blank"
            rel="noreferrer"
            className="mt-0.5 block hover:underline"
          >
            {title}
          </a>
        ) : (
          <p className="mt-0.5">{title}</p>
        )}
        {item.summary && !compact ? (
          <p className="mt-0.5 line-clamp-2 whitespace-pre-line text-xs text-neutral-500 dark:text-[#b6bac2]">
            {item.summary}
          </p>
        ) : null}
        {item.angle && !compact ? (
          <p className="mt-1 text-xs italic text-teal-700 dark:text-teal-300">
            Hook: {item.angle}
          </p>
        ) : null}
        {item.tags.length ? (
          <p className="mt-1 flex flex-wrap gap-1">
            {item.tags.slice(0, 4).map((t) => (
              <span
                key={t}
                className="rounded-full bg-black/[.04] px-1.5 py-0.5 text-[9px] text-neutral-500 dark:bg-white/[.08] dark:text-neutral-400"
              >
                {t}
              </span>
            ))}
          </p>
        ) : null}
      </div>
      <div className="flex shrink-0 flex-col items-end gap-1">
        <StatusForm id={item.id} status="saved" hide={item.status === "saved"}>
          Save
        </StatusForm>
        <StatusForm id={item.id} status="dismissed">
          Hide
        </StatusForm>
      </div>
    </li>
  );
}

function StatusForm({
  id,
  status,
  hide,
  children,
}: {
  id: string;
  status: AiNewsStatus;
  hide?: boolean;
  children: ReactNode;
}) {
  if (hide) return null;
  return (
    <form action={markAiNewsStatus.bind(null, id, status)}>
      <button
        type="submit"
        className="text-[10px] font-medium text-neutral-400 hover:text-neutral-800 dark:hover:text-neutral-200"
      >
        {children}
      </button>
    </form>
  );
}

export function AiNewsEmptyLanes() {
  const lanes: { kind: AiNewsKind; blurb: string }[] = [
    { kind: "news", blurb: "Model drops, funding, launches — as they hit." },
    { kind: "tool", blurb: "New products and APIs worth stealing a look at." },
    { kind: "idea", blurb: "Angles and formats we might turn into content." },
  ];
  return (
    <div className="mt-3 grid gap-3 sm:grid-cols-3">
      {lanes.map((lane) => (
        <div
          key={lane.kind}
          className="rounded-xl border border-dashed border-black/[.10] px-3 py-4 dark:border-white/[.12]"
        >
          <AiNewsKindBadge kind={lane.kind} />
          <p className="mt-2 font-serif text-[17px] italic leading-tight tracking-tight">
            Waiting on first drop
          </p>
          <p className="mt-1 text-[11px] leading-snug text-neutral-500 dark:text-[#b6bac2]">
            {lane.blurb}
          </p>
        </div>
      ))}
    </div>
  );
}

export function AiNewsList({
  items,
  compact,
  ranked,
}: {
  items: AiNewsItem[];
  compact?: boolean;
  ranked?: boolean;
}) {
  return (
    <ul className="mt-1 divide-y divide-black/[.06] dark:divide-white/[.08]">
      {items.map((item, i) => (
        <AiNewsItemRow key={item.id} item={item} compact={compact} rank={ranked ? i + 1 : undefined} />
      ))}
    </ul>
  );
}

const VIEWS: { id: AiNewsView; label: string }[] = [
  { id: "top", label: "Top 100" },
  { id: "repos", label: "Repos" },
  { id: "products", label: "Products" },
  { id: "models", label: "Models" },
  { id: "stories", label: "Stories" },
  { id: "ideas", label: "Video ideas" },
  { id: "saved", label: "Saved" },
];

export function AiNewsViewBar({ active }: { active: AiNewsView }) {
  return (
    <div className="flex flex-wrap gap-1">
      {VIEWS.map((v) => {
        const on = active === v.id;
        return (
          <Link
            key={v.id}
            href={v.id === "top" ? "/dashboard/news" : `/dashboard/news?view=${v.id}`}
            className={`rounded-full px-2.5 py-1 text-[11px] font-medium ${
              on
                ? "bg-neutral-900 text-white dark:bg-white dark:text-neutral-900"
                : "text-neutral-500 hover:bg-black/[.04] dark:hover:bg-white/[.08]"
            }`}
          >
            {v.label}
          </Link>
        );
      })}
    </div>
  );
}

export function AiNewsBriefCard({ brief }: { brief: AiNewsBrief }) {
  const srcs = Object.entries(brief.sources)
    .filter(([, n]) => n > 0)
    .map(([k, n]) => `${k} ${n}`)
    .join(" · ");
  return (
    <section className="mt-4 grid gap-4 rounded-2xl border border-black/[.08] bg-white p-5 lg:grid-cols-[3fr_2fr] dark:border-white/[.14] dark:bg-[var(--surface-1)]">
      <div>
        <p className="text-[10px] font-semibold uppercase tracking-wider text-neutral-400">
          Daily brief · {brief.date}
          {brief.model ? ` · ${brief.model}` : ""}
        </p>
        <h2 className="mt-1 font-serif text-[24px] italic leading-tight tracking-tight">
          {brief.headline}
        </h2>
        {brief.bullets.length ? (
          <ul className="mt-3 space-y-1.5 text-[13px] leading-snug text-neutral-700 dark:text-[#d5d8de]">
            {brief.bullets.map((b, i) => (
              <li key={i} className="flex gap-2">
                <span className="mt-[7px] size-1.5 shrink-0 rounded-full bg-teal-500" />
                <span>{b}</span>
              </li>
            ))}
          </ul>
        ) : null}
        {srcs ? (
          <p className="mt-3 text-[10px] tabular-nums text-neutral-400">
            {brief.itemCount} items · {srcs}
          </p>
        ) : null}
      </div>
      <div className="rounded-xl border border-teal-500/25 bg-teal-500/[.06] p-4">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-teal-700 dark:text-teal-300">
          Film today
        </p>
        <ol className="mt-2 space-y-2.5">
          {brief.videoIdeas.map((v, i) => (
            <li key={i} className="text-[12.5px] leading-snug">
              <p className="font-medium text-neutral-900 dark:text-neutral-100">{v.title}</p>
              <p className="mt-0.5 italic text-neutral-600 dark:text-[#b6bac2]">“{v.hook}”</p>
              <p className="mt-0.5 text-[11px] text-neutral-500 dark:text-neutral-400">{v.why}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

export function AiNewsFilterBar({
  active,
  counts,
}: {
  active: AiNewsKind | "all";
  counts: { news: number; tool: number; idea: number; total: number };
}) {
  const tabs: { id: AiNewsKind | "all"; label: string; n: number }[] = [
    { id: "all", label: "All", n: counts.total },
    { id: "news", label: "News", n: counts.news },
    { id: "tool", label: "Tools", n: counts.tool },
    { id: "idea", label: "Ideas", n: counts.idea },
  ];
  return (
    <div className="flex flex-wrap gap-1">
      {tabs.map((t) => {
        const href =
          t.id === "all" ? "/dashboard/news" : `/dashboard/news?kind=${t.id}`;
        const on = active === t.id;
        return (
          <Link
            key={t.id}
            href={href}
            className={`rounded-full px-2.5 py-1 text-[11px] font-medium ${
              on
                ? "bg-neutral-900 text-white dark:bg-white dark:text-neutral-900"
                : "text-neutral-500 hover:bg-black/[.04] dark:hover:bg-white/[.08]"
            }`}
          >
            {t.label}
            <span className="ml-1 tabular-nums opacity-60">{t.n}</span>
          </Link>
        );
      })}
    </div>
  );
}
