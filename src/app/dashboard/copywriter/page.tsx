import { PageHeader } from "@/components/PageHeader";
import { listSources, listStyleSources } from "@/lib/copywriter/store";
import { CopywriterDesk } from "./CopywriterDesk";

export const metadata = { title: "Copywriter · Marketing OS" };
export const dynamic = "force-dynamic";

export default async function CopywriterPage() {
  const [sources, corpora] = await Promise.all([listSources(), listStyleSources()]);
  const apifyReady = Boolean(process.env.APIFY_TOKEN);
  const llmReady = Boolean(process.env.OLLAMA_API_KEY || process.env.OLLAMA_KEY);

  return (
    <main className="w-full px-6 pb-6 pt-4">
      <PageHeader
        eyebrow="Intelligence"
        title="Copywriter"
        description="Paste Instagram reel links. Each one is transcribed, then shown as thesis, performance, and the full transcript. Convert to your own tone runs the short-form or long-form skill from the original cut."
      />
      <CopywriterDesk initial={sources} corpora={corpora} apifyReady={apifyReady} llmReady={llmReady} />
    </main>
  );
}
