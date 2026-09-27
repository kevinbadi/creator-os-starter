import { PageHeader } from "@/components/PageHeader";

export const metadata = { title: "Philosophy Content · Marketing OS" };

export default function PhilosophyPage() {
  return (
    <main className="w-full px-6 pb-6 pt-4">
      <PageHeader
        title="Philosophy Content"
        description="Knowledge graph of the best philosophical + content ideas from favorite business and philosophy creators."
      />

      <div className="mt-6 rounded-xl border border-dashed border-black/[.12] bg-white p-6 text-sm text-neutral-600 dark:border-white/[.19] dark:bg-[var(--surface-1)] dark:text-[#b6bac2]">
        <p className="font-medium text-neutral-900 dark:text-neutral-100">
          Ingestion engine coming soon.
        </p>
        <p className="mt-1">
          This section will ingest source material (videos, podcasts, essays,
          threads) from selected creators, extract their strongest points, and
          link them into a browsable knowledge graph that feeds content
          generation.
        </p>
      </div>
    </main>
  );
}
