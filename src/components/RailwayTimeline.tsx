import { relativeTime } from "@/lib/format";
import { PlatformBadge } from "./PlatformBadge";
import type {
  AutomationStatus,
  HealthStatus,
  ManagerReport,
  ScheduledAutomation,
} from "@/lib/automations/railway";

// Dot color: prefer verified health; fall back to configured status.
const HEALTH_DOT: Record<HealthStatus, string> = {
  healthy: "bg-[#2dd4bf]",
  overdue: "bg-red-500",
  pending: "bg-amber-400",
  paused: "bg-neutral-400 dark:bg-neutral-600",
};
const STATUS_DOT: Record<AutomationStatus, string> = {
  active: "bg-[#2dd4bf]",
  paused: "bg-neutral-400 dark:bg-neutral-600",
  error: "bg-red-500",
};

const HEALTH_BADGE: Record<HealthStatus, { label: string; cls: string }> = {
  healthy: {
    label: "Healthy",
    cls: "bg-teal-500/15 text-teal-700 dark:text-teal-300",
  },
  overdue: {
    label: "Overdue",
    cls: "bg-red-500/15 text-red-700 dark:text-red-300",
  },
  pending: {
    label: "Pending",
    cls: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  },
  paused: {
    label: "Paused",
    cls: "bg-neutral-500/15 text-neutral-600 dark:text-neutral-300",
  },
};

export function RailwayTimeline({
  items,
  manager,
}: {
  items: ScheduledAutomation[];
  manager?: ManagerReport | null;
}) {
  if (items.length === 0) return null;

  const active = items.filter((a) => a.status === "active");
  const paused = items.filter((a) => a.status !== "active");
  // Header math: every active run × its platforms = uploads scheduled per day.
  const dailyUploads = active.reduce((s, a) => s + a.platforms.length, 0);

  const nextId = [...active]
    .filter((a) => a.nextRunAt)
    .sort((a, b) => String(a.nextRunAt).localeCompare(String(b.nextRunAt)))[0]?.id;
  const Row = (a: ScheduledAutomation, last: boolean) => {
    const dot = a.health ? HEALTH_DOT[a.health] : STATUS_DOT[a.status];
    const live = a.id === nextId && a.health !== "overdue";
    const badge = a.health ? HEALTH_BADGE[a.health] : null;
    return (
      <li key={a.id} className="relative flex gap-3 pb-3 last:pb-0">
        {!last ? (
          <span
            aria-hidden
            className="absolute left-[5px] top-4 h-full w-px bg-black/[.08] dark:bg-white/[.09]"
          />
        ) : null}
        <span
          aria-hidden
          className={`mt-1 size-[11px] shrink-0 rounded-full ring-2 ring-white dark:ring-[var(--surface-1)] ${dot} ${live ? "live-dot" : ""}`}
        />

        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-2">
            <div className="flex min-w-0 items-center gap-2">
              <p className="truncate text-[13px] font-semibold leading-tight" title={a.description}>
                {a.name}
              </p>
              {badge ? (
                <span
                  className={`shrink-0 rounded-full px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide ${badge.cls}`}
                >
                  {badge.label}
                </span>
              ) : null}
            </div>
            <span className="shrink-0 text-[10px] tabular-nums text-neutral-400">
              {a.nextRunAt ? `next ${relativeTime(a.nextRunAt)}` : "—"}
            </span>
          </div>

          {/* What one run does: which platforms it posts to + the skill it runs. */}
          <div className="mt-1 flex flex-wrap items-center gap-1">
            {a.platforms.length ? (
              a.platforms.map((p) => (
                <span key={p} className="[&>span]:px-1.5 [&>span]:py-0 [&>span]:text-[10px]">
                  <PlatformBadge platform={p} />
                </span>
              ))
            ) : (
              <span className="rounded-full bg-neutral-100 px-1.5 text-[10px] font-medium text-neutral-500 dark:bg-[var(--surface-2)] dark:text-[#b6bac2]">
                no posts
              </span>
            )}
            <span className="ml-0.5 rounded bg-black/[.04] px-1.5 py-0.5 font-mono text-[10px] text-neutral-500 dark:bg-white/[.09] dark:text-[#b6bac2]">
              ⚡ {a.skill}
            </span>
          </div>

          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px] text-neutral-400">
            <span>
              {a.lastRunAt ? (
                <>last run {relativeTime(a.lastRunAt)}</>
              ) : a.health === "pending" ? (
                "not run yet"
              ) : (
                "no runs recorded"
              )}
            </span>
            {typeof a.recentRuns === "number" ? (
              <>
                <span aria-hidden>·</span>
                <span>
                  {a.recentRuns} run{a.recentRuns === 1 ? "" : "s"} / 7d
                </span>
              </>
            ) : null}
          </div>
        </div>
      </li>
    );
  };

  return (
    <section className="card">
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <h2 className="card-title">Automations</h2>
          {manager ? (
            <span
              className={`inline-flex min-w-0 items-center gap-1.5 text-[11px] font-medium ${
                manager.healthy
                  ? "text-emerald-700 dark:text-emerald-300"
                  : "text-amber-800 dark:text-amber-200"
              }`}
            >
              <span
                className={`live-dot size-1.5 shrink-0 rounded-full ${
                  manager.healthy ? "bg-emerald-400" : "bg-amber-400"
                }`}
              />
              <span className="truncate">
                {manager.healthy ? "all firing" : "attention needed"}
              </span>
              <span className="num shrink-0 font-normal text-neutral-400">
                {relativeTime(manager.createdAt)}
              </span>
            </span>
          ) : null}
        </div>
        <span className="num shrink-0 text-[10px] text-neutral-400">
          {active.length} runs/day → {dailyUploads} uploads
        </span>
      </div>
      {manager && !manager.healthy && manager.blockers.length ? (
        <ul className="mt-2 space-y-0.5 text-[11px] text-amber-800 dark:text-amber-200/90">
          {manager.blockers.map((b) => (
            <li key={b}>• {b}</li>
          ))}
        </ul>
      ) : null}
      {manager && !manager.healthy
        ? (() => {
            const missed = manager.jobs.filter(
              (j) => !["fired ✓", "scheduled", "running window"].includes(j.status),
            );
            return missed.length ? (
              <p className="mt-1 text-[11px] text-neutral-500">
                {missed.length} slot{missed.length > 1 ? "s" : ""} affected today:{" "}
                {missed
                  .slice(0, 4)
                  .map((j) => `${j.job} ${j.slot}`)
                  .join(", ")}
                {missed.length > 4 ? ` +${missed.length - 4} more` : ""}
              </p>
            ) : null;
          })()
        : null}

      <ol className="mt-3">
        {active.map((a, i) => Row(a, i === active.length - 1 && paused.length === 0))}
        {paused.length ? (
          <li className="pb-2 pt-1 pl-6 text-[10px] font-medium uppercase tracking-wider text-neutral-400">
            Paused
          </li>
        ) : null}
        {paused.map((a, i) => Row(a, i === paused.length - 1))}
      </ol>
    </section>
  );
}
