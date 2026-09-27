"use client";

import { useEffect, useState, useTransition } from "react";
import {
  GOAL_STATUSES,
  GOAL_STATUS_LABEL,
  GOAL_CATEGORIES,
  GOAL_CATEGORY_LABEL,
  goalDeadlineMs,
  type Goal,
  type GoalCategory,
  type GoalStatus,
} from "@/lib/goals/types";
import {
  createGoal,
  updateGoal,
  deleteGoal,
  setGoalProgress,
  setGoalStatus,
} from "@/lib/goals/actions";
import { CalendarBadge } from "@/components/CalendarBadge";
import { DeadlineCountdown } from "@/components/DeadlineCountdown";
import { formatElapsed } from "@/lib/goals/time";

type MetricValue = { current: number; target: number; unit: string; source: string };

type GoalInput = {
  title: string;
  detail: string;
  targetDate: string;
  targetTime: string;
  status: GoalStatus;
  progress: number;
  category: GoalCategory;
};

// Silver / black surfaces · turquoise accent. Tracks differ only by their chip.
const TRACK: Record<
  GoalCategory,
  { sub: string; chip: string; rail: string; fill: string; ring: string; soft: string }
> = {
  development: {
    sub: "Product roadmap",
    chip: "bg-neutral-200 text-neutral-700 dark:bg-[var(--surface-3)] dark:text-neutral-200",
    rail: "bg-neutral-200 dark:bg-[var(--surface-3)]",
    fill: "bg-teal-500",
    ring: "border-teal-500",
    soft: "bg-teal-500/15 text-teal-700 dark:text-teal-300",
  },
  marketing: {
    sub: "Go-to-market",
    chip: "bg-teal-100 text-teal-700 dark:bg-teal-950/50 dark:text-teal-300",
    rail: "bg-neutral-200 dark:bg-[var(--surface-3)]",
    fill: "bg-teal-500",
    ring: "border-teal-500",
    soft: "bg-teal-500/15 text-teal-700 dark:text-teal-300",
  },
};

const STATUS_BADGE: Record<GoalStatus, string> = {
  planned: "bg-neutral-200 text-neutral-700 dark:bg-[var(--surface-3)] dark:text-neutral-300",
  in_progress: "bg-teal-100 text-teal-700 dark:bg-teal-950/50 dark:text-teal-300",
  done: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300",
};

function prettyDate(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function GoalManager({
  goals,
  metrics,
}: {
  goals: Goal[];
  metrics: Record<string, MetricValue>;
}) {
  const [pending, start] = useTransition();
  const [adding, setAdding] = useState<GoalCategory | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);

  // Shared clock for the countdowns — set after mount to avoid hydration
  // mismatch, then tick every second.
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const editing = goals.find((g) => g.id === editingId) ?? null;

  return (
    <div className={pending ? "opacity-95" : ""}>
      <div className="mt-3 grid gap-3 lg:grid-cols-2">
        {GOAL_CATEGORIES.map((cat) => (
          <TrackColumn
            key={cat}
            category={cat}
            now={now}
            metrics={metrics}
            goals={goals.filter((g) => g.category === cat)}
            addingHere={adding === cat}
            editing={editing && editing.category === cat ? editing : null}
            onAddOpen={() => {
              setAdding(cat);
              setEditingId(null);
            }}
            onAddClose={() => setAdding(null)}
            onCreate={(v) => {
              start(() => void createGoal(v));
              setAdding(null);
            }}
            onEditOpen={(id) => {
              setEditingId(id);
              setAdding(null);
            }}
            onEditClose={() => setEditingId(null)}
            onUpdate={(id, v) => {
              start(() => void updateGoal(id, v));
              setEditingId(null);
            }}
            onDelete={(g) => {
              if (confirm(`Delete goal "${g.title}"?`)) {
                start(() => void deleteGoal(g.id));
              }
            }}
            onProgress={(id, p) => start(() => void setGoalProgress(id, p))}
            onStatus={(id, s) => start(() => void setGoalStatus(id, s))}
          />
        ))}
      </div>
    </div>
  );
}

function TrackColumn({
  category,
  now,
  metrics,
  goals,
  addingHere,
  editing,
  onAddOpen,
  onAddClose,
  onCreate,
  onEditOpen,
  onEditClose,
  onUpdate,
  onDelete,
  onProgress,
  onStatus,
}: {
  category: GoalCategory;
  now: number | null;
  metrics: Record<string, MetricValue>;
  goals: Goal[];
  addingHere: boolean;
  editing: Goal | null;
  onAddOpen: () => void;
  onAddClose: () => void;
  onCreate: (v: GoalInput) => void;
  onEditOpen: (id: string) => void;
  onEditClose: () => void;
  onUpdate: (id: string, v: GoalInput) => void;
  onDelete: (g: Goal) => void;
  onProgress: (id: string, p: number) => void;
  onStatus: (id: string, s: GoalStatus) => void;
}) {
  const t = TRACK[category];

  return (
    <div className="rounded-2xl border border-black/[.08] bg-white p-3 dark:border-white/[.14] dark:bg-[var(--surface-1)]">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${t.chip}`}>
            {GOAL_CATEGORY_LABEL[category]}
          </span>
          <span className="text-xs text-neutral-400">{t.sub}</span>
        </div>
        <button
          type="button"
          onClick={addingHere ? onAddClose : onAddOpen}
          className={`inline-flex h-7 items-center rounded-full px-2.5 text-xs font-medium ${t.soft} transition hover:brightness-95`}
        >
          {addingHere ? "Close" : "+ Add"}
        </button>
      </div>

      {addingHere ? (
        <div className="mt-3">
          <GoalForm category={category} onSubmit={onCreate} onCancel={onAddClose} />
        </div>
      ) : null}

      <div className="mt-3">
        {goals.length === 0 && !addingHere ? (
          <p className="py-4 text-center text-sm text-neutral-400">
            No {GOAL_CATEGORY_LABEL[category].toLowerCase()} goals yet.
          </p>
        ) : null}

        {goals.map((g, i) =>
          editing?.id === g.id ? (
            <div key={g.id} className="pb-4">
              <GoalForm
                goal={g}
                category={category}
                onSubmit={(v) => onUpdate(g.id, v)}
                onCancel={onEditClose}
              />
            </div>
          ) : (
            <MilestoneNode
              key={g.id}
              goal={g}
              track={t}
              now={now}
              metric={metrics[g.id]}
              isLast={i === goals.length - 1}
              onEdit={() => onEditOpen(g.id)}
              onDelete={() => onDelete(g)}
              onProgress={(p) => onProgress(g.id, p)}
              onStatus={(s) => onStatus(g.id, s)}
            />
          ),
        )}
      </div>
    </div>
  );
}

function MilestoneNode({
  goal,
  track,
  now,
  metric,
  isLast,
  onEdit,
  onDelete,
  onProgress,
  onStatus,
}: {
  goal: Goal;
  track: (typeof TRACK)[GoalCategory];
  now: number | null;
  metric?: MetricValue;
  isLast: boolean;
  onEdit: () => void;
  onDelete: () => void;
  onProgress: (p: number) => void;
  onStatus: (s: GoalStatus) => void;
}) {
  const [local, setLocal] = useState(goal.progress);
  useEffect(() => setLocal(goal.progress), [goal.progress]);

  const deadline = goalDeadlineMs(goal.targetDate, goal.targetTime);
  const parsedStart = goal.startedAt ? Date.parse(goal.startedAt) : NaN;
  const startedMs = Number.isFinite(parsedStart) ? parsedStart : null;
  const slipped =
    deadline != null && now != null && deadline - now <= 0 && goal.status !== "done";
  const elapsed =
    goal.status === "in_progress" && startedMs != null && now != null
      ? formatElapsed(now - startedMs)
      : "";

  const metricPct = metric
    ? Math.max(0, Math.min(100, Math.round((metric.current / Math.max(metric.target, 1)) * 100)))
    : null;

  return (
    <div className="relative pb-3 pl-7 last:pb-0">
      {!isLast ? (
        <span className={`absolute left-[9px] top-6 bottom-0 w-0.5 ${track.rail}`} />
      ) : null}
      <span
        className={`absolute left-0 top-0.5 grid size-5 place-items-center rounded-full ${
          goal.status === "planned"
            ? `border-2 bg-white dark:bg-[var(--surface-1)] ${track.ring}`
            : `${track.fill} text-white`
        }`}
      >
        {goal.status === "done" ? (
          <svg width="11" height="11" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="m3 7.5 2.5 2.5 5.5-6" />
          </svg>
        ) : goal.status === "in_progress" ? (
          <span className="size-1.5 rounded-full bg-white" />
        ) : null}
      </span>

      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-start gap-2">
          {goal.targetDate ? (
            <CalendarBadge date={goal.targetDate} slipped={slipped} done={goal.status === "done"} />
          ) : null}
          <div className="min-w-0">
            <h4 className="truncate text-sm font-semibold">{goal.title}</h4>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              {goal.status === "done" ? (
                <span className="text-xs font-medium text-emerald-600 dark:text-emerald-400">
                  Completed{goal.targetDate ? ` · ${prettyDate(goal.targetDate)}` : ""}
                </span>
              ) : deadline != null && now != null ? (
                <DeadlineCountdown deadline={deadline} now={now} size="sm" />
              ) : !goal.targetDate ? (
                <span className="text-xs text-neutral-400">No target date</span>
              ) : null}
              {elapsed ? (
                <span className="text-[11px] text-neutral-400">{elapsed} elapsed</span>
              ) : null}
            </div>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <button type="button" onClick={onEdit} className="rounded px-1.5 py-0.5 text-[11px] font-medium text-neutral-500 transition hover:bg-black/[.05] dark:hover:bg-white/[.07]">
            Edit
          </button>
          <button type="button" onClick={onDelete} className="rounded px-1.5 py-0.5 text-[11px] font-medium text-red-600 transition hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/30">
            Del
          </button>
        </div>
      </div>

      {goal.detail ? (
        <p className="mt-1 text-xs text-neutral-500">{goal.detail}</p>
      ) : null}

      <div className="mt-1.5 flex flex-wrap gap-1">
        {GOAL_STATUSES.map((st) => (
          <button
            key={st}
            type="button"
            onClick={() => onStatus(st)}
            className={`rounded-full px-2 py-0.5 text-[10px] font-medium transition ${
              goal.status === st
                ? STATUS_BADGE[st]
                : "text-neutral-400 hover:bg-black/[.05] dark:hover:bg-white/[.07]"
            }`}
          >
            {GOAL_STATUS_LABEL[st]}
          </button>
        ))}
      </div>

      {metric ? (
        <div className="mt-1.5">
          <div className="flex items-center justify-between text-[11px]">
            <span className="text-neutral-500">
              <span className="text-sm font-bold tabular-nums text-neutral-900 dark:text-neutral-100">
                {metric.current.toLocaleString()}
              </span>{" "}
              / {metric.target.toLocaleString()} {metric.unit}
            </span>
            <span className="inline-flex items-center gap-1 rounded-full bg-teal-500/15 px-1.5 py-0.5 text-[10px] font-medium text-teal-700 dark:text-teal-300">
              <span className="size-1.5 rounded-full bg-teal-500" /> Live · {metric.source}
            </span>
          </div>
          <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-black/[.06] dark:bg-white/[.11]">
            <div className={`h-full rounded-full ${track.fill}`} style={{ width: `${metricPct}%` }} />
          </div>
        </div>
      ) : (
        <>
          <div className="mt-1.5 flex items-center gap-2">
            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-black/[.06] dark:bg-white/[.11]">
              <div className={`h-full rounded-full ${track.fill}`} style={{ width: `${local}%` }} />
            </div>
            <span className="w-8 shrink-0 text-right text-[11px] font-semibold tabular-nums">{local}%</span>
          </div>
          <input
            type="range"
            min={0}
            max={100}
            step={5}
            value={local}
            onChange={(e) => setLocal(Number(e.target.value))}
            onPointerUp={() => onProgress(local)}
            onKeyUp={() => onProgress(local)}
            className="mt-1 w-full accent-teal-500"
          />
        </>
      )}
    </div>
  );
}

function GoalForm({
  goal,
  category,
  onSubmit,
  onCancel,
}: {
  goal?: Goal;
  category: GoalCategory;
  onSubmit: (v: GoalInput) => void;
  onCancel: () => void;
}) {
  const [title, setTitle] = useState(goal?.title ?? "");
  const [detail, setDetail] = useState(goal?.detail ?? "");
  const [targetDate, setTargetDate] = useState(goal?.targetDate ?? "");
  const [targetTime, setTargetTime] = useState(goal?.targetTime ?? "");
  const [status, setStatus] = useState<GoalStatus>(goal?.status ?? "planned");
  const [progress, setProgress] = useState(goal?.progress ?? 0);
  const [cat, setCat] = useState<GoalCategory>(goal?.category ?? category);

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (!title.trim()) return;
        onSubmit({ title, detail, targetDate, targetTime, status, progress, category: cat });
      }}
      className="rounded-xl border border-black/[.10] bg-black/[.02] p-3 dark:border-white/[.12] dark:bg-white/[.06]"
    >
      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Milestone — e.g. Beta release"
        autoFocus
        className="h-9 w-full rounded-lg border border-black/[.12] bg-white px-3 text-sm font-medium text-neutral-900 outline-none transition focus:border-teal-400 dark:border-white/[.19] dark:bg-[var(--surface-2)] dark:text-neutral-100"
      />
      <textarea
        value={detail}
        onChange={(e) => setDetail(e.target.value)}
        placeholder="Notes (optional)"
        rows={2}
        className="mt-2 w-full resize-y rounded-lg border border-black/[.12] bg-white px-3 py-2 text-sm text-neutral-900 outline-none transition focus:border-teal-400 dark:border-white/[.19] dark:bg-[var(--surface-2)] dark:text-neutral-100"
      />
      <div className="mt-2 grid grid-cols-2 gap-2">
        <div className="flex gap-2">
          <input
            type="date"
            value={targetDate}
            onChange={(e) => setTargetDate(e.target.value)}
            className="h-9 min-w-0 flex-1 rounded-lg border border-black/[.12] bg-white px-2 text-sm text-neutral-900 dark:border-white/[.19] dark:bg-[var(--surface-2)] dark:text-neutral-100"
          />
          <input
            type="time"
            value={targetTime}
            onChange={(e) => setTargetTime(e.target.value)}
            title="Deadline time (optional)"
            className="h-9 w-[92px] shrink-0 rounded-lg border border-black/[.12] bg-white px-2 text-sm text-neutral-900 dark:border-white/[.19] dark:bg-[var(--surface-2)] dark:text-neutral-100"
          />
        </div>
        <select
          value={cat}
          onChange={(e) => setCat(e.target.value as GoalCategory)}
          className="h-9 rounded-lg border border-black/[.12] bg-white px-2 text-sm text-neutral-900 dark:border-white/[.19] dark:bg-[var(--surface-2)] dark:text-neutral-100"
        >
          {GOAL_CATEGORIES.map((c) => (
            <option key={c} value={c}>{GOAL_CATEGORY_LABEL[c]}</option>
          ))}
        </select>
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value as GoalStatus)}
          className="h-9 rounded-lg border border-black/[.12] bg-white px-2 text-sm text-neutral-900 dark:border-white/[.19] dark:bg-[var(--surface-2)] dark:text-neutral-100"
        >
          {GOAL_STATUSES.map((st) => (
            <option key={st} value={st}>{GOAL_STATUS_LABEL[st]}</option>
          ))}
        </select>
        <label className="flex items-center gap-2 text-[11px] text-neutral-500">
          {progress}%
          <input
            type="range"
            min={0}
            max={100}
            step={5}
            value={progress}
            onChange={(e) => setProgress(Number(e.target.value))}
            className="flex-1 accent-teal-500"
          />
        </label>
      </div>
      <div className="mt-3 flex items-center justify-end gap-2">
        <button type="button" onClick={onCancel} className="inline-flex h-8 items-center rounded-full border border-black/[.12] px-3 text-xs font-medium transition hover:bg-black/[.04] dark:border-white/[.19] dark:hover:bg-white/[.09]">
          Cancel
        </button>
        <button type="submit" className="inline-flex h-8 items-center rounded-full bg-neutral-900 px-3.5 text-xs font-medium text-white transition hover:-translate-y-px dark:bg-white dark:text-neutral-900">
          {goal ? "Save" : "Add"}
        </button>
      </div>
    </form>
  );
}
