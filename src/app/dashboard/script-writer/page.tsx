import { PageHeader } from "@/components/PageHeader";
import { ScriptWriterDesk } from "./ScriptWriterDesk";

export const metadata = { title: "Script Writer · Marketing OS" };
export const dynamic = "force-dynamic";

export default function ScriptWriterPage() {
  const llmReady = Boolean(process.env.OLLAMA_API_KEY || process.env.OLLAMA_KEY);

  return (
    <main className="w-full px-6 pb-6 pt-4">
      <PageHeader
        eyebrow="Intelligence"
        title="Script Writer"
        description="Drop a topic and any notes, links, or data. It researches what you gave it, then writes a spoken script in your voice for Reels or YouTube."
      />
      <ScriptWriterDesk llmReady={llmReady} />
    </main>
  );
}
