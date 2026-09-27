import { PageHeader } from "@/components/PageHeader";
import { PlatformBadge } from "@/components/PlatformBadge";
import { projectedDailyUploads } from "@/lib/content/registry";
import { getActiveChannel } from "@/lib/channels/store";
import { personaSlugsForChannel } from "@/lib/channels/personas";
import { listChannelPosts } from "@/lib/channels/posts";
import { postWhen } from "@/lib/posts/status";

export const metadata = { title: "Calendar · Marketing OS" };

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export default async function CalendarPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string }>;
}) {
  const { month } = await searchParams;
  const today = new Date();
  const cursor = month ? new Date(month + "-01T00:00:00") : today;
  const year = cursor.getFullYear();
  const m = cursor.getMonth();

  const first = new Date(year, m, 1);
  const last = new Date(year, m + 1, 0);
  const startOffset = first.getDay();
  const totalCells = Math.ceil((startOffset + last.getDate()) / 7) * 7;

  const channel = await getActiveChannel();
  const slugs = await personaSlugsForChannel(channel);
  const projected = projectedDailyUploads(slugs);
  const posts = await listChannelPosts(channel, { limit: 200 }).catch(() => []);
  const byDay = new Map<string, typeof posts>();
  const etDay = (iso: string) =>
    new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(
      new Date(iso),
    );
  for (const p of posts) {
    const when = postWhen(p);
    if (!when) continue;
    const d = new Date(when);
    if (Number.isNaN(d.getTime())) continue;
    const key = etDay(when);
    const cursorKey = `${year}-${String(m + 1).padStart(2, "0")}`;
    if (!key.startsWith(cursorKey)) continue;
    const arr = byDay.get(key) ?? [];
    arr.push(p);
    byDay.set(key, arr);
  }

  const monthLabel = first.toLocaleString(undefined, {
    month: "long",
    year: "numeric",
  });
  const prev = new Date(year, m - 1, 1).toISOString().slice(0, 7);
  const next = new Date(year, m + 1, 1).toISOString().slice(0, 7);

  return (
    <main className="w-full px-6 py-8">
      <PageHeader
        title="Calendar"
        description="Scheduled and published posts for this channel."
        actions={
          <div className="flex items-center gap-1">
            <a
              href={`/dashboard/calendar?month=${prev}`}
              className="inline-flex h-9 items-center justify-center rounded-md border border-black/[.12] px-3 text-sm font-medium transition hover:bg-black/[.04] dark:border-white/[.19] dark:hover:bg-white/[.09]"
            >
              ←
            </a>
            <span className="px-2 text-sm font-medium">{monthLabel}</span>
            <a
              href={`/dashboard/calendar?month=${next}`}
              className="inline-flex h-9 items-center justify-center rounded-md border border-black/[.12] px-3 text-sm font-medium transition hover:bg-black/[.04] dark:border-white/[.19] dark:hover:bg-white/[.09]"
            >
              →
            </a>
          </div>
        }
      />

      <div className="mt-6 overflow-hidden rounded-2xl border border-black/[.08] bg-white dark:border-white/[.14] dark:bg-[var(--surface-1)]">
        <div className="grid grid-cols-7 border-b border-black/[.06] bg-black/[.02] dark:border-white/[.12] dark:bg-white/[.06]">
          {DAYS.map((d) => (
            <div
              key={d}
              className="px-3 py-2 text-xs font-medium uppercase tracking-wider text-neutral-500"
            >
              {d}
            </div>
          ))}
        </div>
        <div className="grid grid-cols-7">
          {Array.from({ length: totalCells }, (_, i) => {
            const dayNum = i - startOffset + 1;
            const inMonth = dayNum >= 1 && dayNum <= last.getDate();
            const date = inMonth ? new Date(year, m, dayNum) : null;
            const key = inMonth
              ? `${year}-${String(m + 1).padStart(2, "0")}-${String(dayNum).padStart(2, "0")}`
              : "";
            const dayPosts = key ? byDay.get(key) ?? [] : [];
            const isToday =
              date &&
              date.getFullYear() === today.getFullYear() &&
              date.getMonth() === today.getMonth() &&
              date.getDate() === today.getDate();
            // Upcoming days get the automation projection — how many platform
            // uploads the armed cron jobs will make if every run fires.
            const isFuture =
              date && !isToday && date.getTime() > today.getTime();
            return (
              <div
                key={i}
                className={`min-h-28 border-b border-r border-black/[.06] p-2 dark:border-white/[.12] ${
                  inMonth ? "" : "bg-black/[.02] dark:bg-white/[.02]"
                } ${isToday ? "bg-amber-50/60 dark:bg-amber-950/20" : ""}`}
              >
                {inMonth ? (
                  <>
                    <div className="mb-1 text-xs text-neutral-500">{dayNum}</div>
                    {isFuture && projected > 0 ? (
                      <div
                        className="mb-1 inline-flex items-center gap-1 rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300"
                        title="Platform uploads the armed automations will make this day"
                      >
                        ⚡ {projected} auto uploads
                      </div>
                    ) : null}
                    <ul className="space-y-1">
                      {dayPosts.slice(0, 3).map((p) => (
                        <li
                          key={p._id}
                          className="truncate rounded bg-neutral-100 px-1.5 py-0.5 text-[11px] dark:bg-[var(--surface-3)]"
                        >
                          {p.platforms[0] ? (
                            <PlatformBadge platform={p.platforms[0].platform} />
                          ) : null}{" "}
                          <span className="ml-1">
                            {p.content?.slice(0, 30) || "(no content)"}
                          </span>
                        </li>
                      ))}
                      {dayPosts.length > 3 ? (
                        <li className="text-[11px] text-neutral-500">
                          +{dayPosts.length - 3} more
                        </li>
                      ) : null}
                    </ul>
                  </>
                ) : null}
              </div>
            );
          })}
        </div>
      </div>
    </main>
  );
}
