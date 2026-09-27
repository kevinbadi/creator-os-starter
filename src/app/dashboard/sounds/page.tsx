import { PageHeader } from "@/components/PageHeader";
import { listSoundSets } from "@/lib/sounds/store";
import { SoundsBrowser } from "./SoundsBrowser";

export const metadata = { title: "Sounds · Marketing OS" };

export default async function SoundsPage() {
  const sets = await listSoundSets();

  return (
    <main className="w-full px-6 pb-6 pt-4">
      <PageHeader
        title="Trending Sounds"
        description="English-market trending audio — browse, favorite (workflow allow-list), and delete."
      />

      {sets.length === 0 ? (
        <div className="mt-6 rounded-xl border border-dashed border-black/[.12] bg-white p-6 text-sm text-neutral-600 dark:border-white/[.19] dark:bg-[var(--surface-1)] dark:text-[#b6bac2]">
          <p className="font-medium text-neutral-900 dark:text-neutral-100">
            No sounds yet.
          </p>
          <p className="mt-1">Pull English-market trending audio, then refresh:</p>
          <pre className="mt-3 overflow-x-auto rounded-lg bg-black/[.04] p-3 text-xs text-neutral-700 dark:bg-white/[.09] dark:text-neutral-300">
{`npm run refresh-sounds -- EN 40   # English markets, up to 40
npm run refresh-sounds -- US 20   # single region`}
          </pre>
        </div>
      ) : (
        <SoundsBrowser sets={sets} />
      )}
    </main>
  );
}
