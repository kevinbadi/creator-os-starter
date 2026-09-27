import Link from "next/link";
import { PageHeader } from "@/components/PageHeader";
import { listProfiles } from "@/lib/zernio/client";
import type { ZernioProfile } from "@/lib/zernio/types";
import { formatDate } from "@/lib/format";

export const metadata = { title: "Accounts · Marketing OS" };

export default async function ClientsPage() {
  let profiles: ZernioProfile[] = [];
  let error: string | null = null;
  try {
    profiles = await listProfiles();
  } catch (e) {
    error = e instanceof Error ? e.message : "Failed to load clients";
  }

  return (
    <main className="w-full px-6 py-8">
      <PageHeader
        title="Accounts"
        description="Each Zernio profile groups the social accounts it can post to. Channels combine one or more of these profiles."
      />

      {error ? (
        <p className="mt-6 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-300">
          {error}
        </p>
      ) : null}

      <div className="mt-6 overflow-hidden rounded-2xl border border-black/[.08] bg-white dark:border-white/[.14] dark:bg-[var(--surface-1)]">
        <table className="w-full text-sm">
          <thead className="bg-black/[.02] text-left text-xs uppercase tracking-wider text-neutral-500 dark:bg-white/[.06]">
            <tr>
              <th className="px-5 py-3 font-medium">Client</th>
              <th className="px-5 py-3 font-medium">Accounts</th>
              <th className="px-5 py-3 font-medium">Created</th>
              <th className="px-5 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y divide-black/[.06] dark:divide-white/[.08]">
            {profiles.length === 0 && !error ? (
              <tr>
                <td colSpan={4} className="px-5 py-12 text-center text-neutral-500">
                  No clients yet.
                </td>
              </tr>
            ) : null}
            {profiles.map((p) => (
              <tr key={p._id} className="hover:bg-black/[.02] dark:hover:bg-white/[.03]">
                <td className="px-5 py-3">
                  <Link
                    href={`/dashboard/clients/${p._id}`}
                    className="flex items-center gap-2 font-medium"
                  >
                    <span
                      className="size-2.5 shrink-0 rounded-full"
                      style={{ background: p.color || "#a3a3a3" }}
                    />
                    {p.name}
                    {p.isDefault ? (
                      <span className="ml-1 rounded-full bg-black/[.05] px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-neutral-600 dark:bg-white/[.11] dark:text-neutral-300">
                        Default
                      </span>
                    ) : null}
                  </Link>
                </td>
                <td className="px-5 py-3 text-neutral-600 dark:text-[#b6bac2]">
                  {p.accountUsernames?.length ?? 0}
                </td>
                <td className="px-5 py-3 text-neutral-600 dark:text-[#b6bac2]">
                  {formatDate(p.createdAt)}
                </td>
                <td className="px-5 py-3 text-right">
                  <Link
                    href={`/dashboard/clients/${p._id}`}
                    className="text-xs font-medium text-neutral-600 hover:text-neutral-900 dark:text-[#b6bac2] dark:hover:text-white"
                  >
                    Open →
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </main>
  );
}
