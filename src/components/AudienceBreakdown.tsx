import { formatNumber, platformLabel } from "@/lib/format";
import type { ZernioAccount } from "@/lib/zernio/types";
import { normalizeAccount } from "./SocialAccounts";

const BAR: Record<string, string> = {
  instagram: "bg-pink-500",
  facebook: "bg-blue-500",
  twitter: "bg-neutral-800 dark:bg-neutral-200",
  x: "bg-neutral-800 dark:bg-neutral-200",
  linkedin: "bg-sky-500",
  tiktok: "bg-neutral-900 dark:bg-white",
  youtube: "bg-red-500",
  threads: "bg-neutral-700 dark:bg-neutral-300",
  pinterest: "bg-rose-500",
  bluesky: "bg-sky-400",
};

// Followers rolled up PER PLATFORM (2026-09-14): the old list showed one row
// per account, so YouTube and TikTok appeared twice with tiny second entries.
function rollup(accounts: ZernioAccount[]) {
  const by = new Map<string, number>();
  for (const a of accounts.map(normalizeAccount)) {
    if (a.followers <= 0) continue;
    const key = a.platform === "twitter" ? "x" : a.platform;
    by.set(key, (by.get(key) ?? 0) + a.followers);
  }
  const rows = [...by.entries()]
    .map(([platform, followers]) => ({ platform, followers }))
    .sort((a, b) => b.followers - a.followers);
  const total = rows.reduce((s, r) => s + r.followers, 0);
  return { rows, total };
}

/**
 * Audience by platform. `compact` renders a single stacked bar + legend meant
 * to sit at the foot of the Connected socials card; the default renders the
 * standalone card with one bar per platform.
 */
export function AudienceBreakdown({
  accounts,
  compact = false,
}: {
  accounts: ZernioAccount[];
  compact?: boolean;
}) {
  const { rows, total } = rollup(accounts);

  if (compact) {
    if (rows.length === 0) return null;
    return (
      <div>
        <div className="flex items-baseline justify-between">
          <p className="eyebrow">Audience by platform</p>
          <p className="text-xs text-neutral-500 dark:text-[#8b909a]">
            <span className="num font-semibold text-neutral-900 dark:text-neutral-100">
              {formatNumber(total)}
            </span>{" "}
            followers
          </p>
        </div>
        <div className="mt-2 flex h-2 w-full overflow-hidden rounded-full bg-black/[.06] dark:bg-white/[.08]">
          {rows.map((r) => (
            <span
              key={r.platform}
              title={`${platformLabel(r.platform)} ${formatNumber(r.followers)}`}
              className={`h-full ${BAR[r.platform] ?? "bg-neutral-500"} first:rounded-l-full last:rounded-r-full`}
              style={{ width: `${Math.max((r.followers / total) * 100, 1)}%` }}
            />
          ))}
        </div>
        <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1">
          {rows.map((r) => (
            <span
              key={r.platform}
              className="inline-flex items-center gap-1.5 text-[11px] text-neutral-600 dark:text-[#b6bac2]"
            >
              <span className={`size-2 rounded-[3px] ${BAR[r.platform] ?? "bg-neutral-500"}`} />
              {platformLabel(r.platform)}
              <span className="num font-semibold text-neutral-900 dark:text-neutral-100">
                {formatNumber(r.followers)}
              </span>
              <span className="num text-neutral-400">{Math.round((r.followers / total) * 100)}%</span>
            </span>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="card">
      <div className="flex items-baseline justify-between">
        <h2 className="card-title">Audience by platform</h2>
        <p className="text-sm">
          <span className="num font-semibold tracking-tight">{formatNumber(total)}</span>{" "}
          <span className="text-xs text-neutral-500">total</span>
        </p>
      </div>

      {rows.length === 0 ? (
        <p className="mt-3 text-sm text-neutral-500">No follower data available yet.</p>
      ) : (
        <ul className="mt-3 space-y-2">
          {rows.map((a) => {
            const pct = total > 0 ? (a.followers / total) * 100 : 0;
            return (
              <li key={a.platform}>
                <div className="flex items-center justify-between text-[11px]">
                  <span className="font-medium">{platformLabel(a.platform)}</span>
                  <span className="num text-neutral-500">
                    {formatNumber(a.followers)} · {pct.toFixed(0)}%
                  </span>
                </div>
                <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-black/[.06] dark:bg-white/[.11]">
                  <div
                    className={`h-full rounded-full ${BAR[a.platform] ?? "bg-neutral-500"}`}
                    style={{ width: `${Math.max(pct, 2)}%` }}
                  />
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
