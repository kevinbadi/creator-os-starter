import Link from "next/link";
import { PageHeader } from "@/components/PageHeader";
import { listAccounts, listProfiles } from "@/lib/zernio/client";
import { getActiveChannel } from "@/lib/channels/store";
import type { ZernioAccount } from "@/lib/zernio/types";
import { Composer } from "./Composer";
import { formatSlotEt, nextOpenSlots } from "@/lib/agent-posts/slots";

export const metadata = { title: "New post · Marketing OS" };

async function safe<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await fn();
  } catch {
    return fallback;
  }
}

export default async function NewPostPage({
  searchParams,
}: {
  searchParams: Promise<{ client?: string }>;
}) {
  const { client } = await searchParams;
  const active = await getActiveChannel();
  const profileIds = active?.zernioProfileIds ?? [];
  const idSet = new Set(profileIds);

  // Only the profiles in the active channel, and only their accounts.
  const [allProfiles, accountsArrays, nextByProfile] = await Promise.all([
    safe(() => listProfiles(), []),
    Promise.all(
      profileIds.map((pid) => safe(() => listAccounts(pid), [] as ZernioAccount[])),
    ),
    nextOpenSlots(profileIds),
  ]);

  const profiles = allProfiles.filter((p) => idSet.has(p._id));
  const accounts = accountsArrays.flat();
  const initialProfileId =
    client && idSet.has(client) ? client : profiles[0]?._id;
  const nextSlots = Object.fromEntries(
    profiles.map((p) => [
      p._id,
      nextByProfile[p._id] ? formatSlotEt(new Date(nextByProfile[p._id])) : "",
    ]),
  );

  return (
    <main className="w-full px-6 py-8">
      <PageHeader
        title="New post"
        description={`Compose for ${active?.name ?? "this channel"} — only its connected profiles and accounts.`}
      />
      {profiles.length === 0 ? (
        <p className="mt-6 rounded-xl border border-dashed border-black/[.12] bg-white p-4 text-sm text-neutral-600 dark:border-white/[.19] dark:bg-[var(--surface-1)] dark:text-[#b6bac2]">
          This channel has no profiles yet.{" "}
          <Link href="/dashboard/channels" className="font-medium underline">
            Attach profiles
          </Link>{" "}
          before composing a post.
        </p>
      ) : (
        <div className="mt-6">
          <Composer
            profiles={profiles}
            accounts={accounts}
            initialProfileId={initialProfileId}
            nextSlots={nextSlots}
          />
        </div>
      )}
    </main>
  );
}
