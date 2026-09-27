import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/PageHeader";
import { PlatformBadge } from "@/components/PlatformBadge";
import {
  getProfile,
  listAccounts,
  listPosts,
} from "@/lib/zernio/client";
import { formatDate, formatNumber, relativeTime } from "@/lib/format";


export default async function ClientPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [profile, accounts, posts] = await Promise.all([
    getProfile(id),
    listAccounts(id).catch(() => []),
    listPosts({ profileId: id, limit: 10 }).catch(() => []),
  ]);

  if (!profile) notFound();

  const profileAccounts = accounts.filter((a) => {
    const pid =
      typeof a.profileId === "string" ? a.profileId : a.profileId?._id;
    return pid === id;
  });

  return (
    <main className="w-full px-6 py-8">
      <Link
        href="/dashboard/clients"
        className="mb-3 inline-block text-xs text-neutral-500 hover:underline"
      >
        ← Clients
      </Link>
      <PageHeader
        title={profile.name}
        description={profile.description || `Client created ${formatDate(profile.createdAt)}`}
        actions={
          <Link
            href={`/dashboard/posts/new?client=${profile._id}`}
            className="inline-flex h-9 items-center justify-center rounded-md bg-neutral-900 px-3 text-sm font-medium text-white transition hover:bg-neutral-800 dark:bg-white dark:text-neutral-900 dark:hover:bg-neutral-200"
          >
            New post for {profile.name}
          </Link>
        }
      />

      <section className="mt-6">
        <h2 className="text-sm font-medium text-neutral-500">
          Connected accounts
        </h2>
        {profileAccounts.length === 0 ? (
          <div className="mt-3 rounded-2xl border border-dashed border-black/[.12] p-6 text-sm text-neutral-600 dark:border-white/[.19] dark:text-[#b6bac2]">
            No accounts connected yet. Connect a social account in Zernio to
            start posting from this client.
          </div>
        ) : (
          <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {profileAccounts.map((a) => {
              const pic = a.metadata?.profileData?.profilePicture;
              const username = a.metadata?.profileData?.username;
              return (
                <div
                  key={a._id}
                  className="flex items-center gap-3 rounded-2xl border border-black/[.08] bg-white p-4 dark:border-white/[.14] dark:bg-[var(--surface-1)]"
                >
                  {pic ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={pic}
                      alt=""
                      className="size-10 rounded-full object-cover"
                    />
                  ) : (
                    <div className="size-10 rounded-full bg-neutral-200 dark:bg-[var(--surface-3)]" />
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">
                      {a.displayName || username || "Account"}
                    </p>
                    <div className="mt-0.5 flex items-center gap-2">
                      <PlatformBadge platform={a.platform} />
                      <span className="text-xs text-neutral-500">
                        {formatNumber(a.followersCount)} followers
                      </span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      <section className="mt-8">
        <h2 className="text-sm font-medium text-neutral-500">Recent posts</h2>
        <ul className="mt-3 divide-y divide-black/[.06] overflow-hidden rounded-2xl border border-black/[.08] bg-white dark:divide-white/[.08] dark:border-white/[.14] dark:bg-[var(--surface-1)]">
          {posts.length === 0 ? (
            <li className="px-5 py-8 text-center text-sm text-neutral-500">
              No posts yet for this client.
            </li>
          ) : (
            posts.map((p) => (
              <li key={p._id} className="px-5 py-4">
                <p className="line-clamp-2 text-sm">
                  {p.content || "(no content)"}
                </p>
                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                  {p.platforms.map((pl, i) => (
                    <PlatformBadge key={i} platform={pl.platform} />
                  ))}
                  <span className="text-xs text-neutral-500">
                    {relativeTime(
                      p.publishedAt ?? p.scheduledFor ?? p.createdAt,
                    )}
                  </span>
                </div>
              </li>
            ))
          )}
        </ul>
      </section>
    </main>
  );
}
