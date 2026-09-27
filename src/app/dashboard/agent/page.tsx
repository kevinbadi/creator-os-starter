import { PageHeader } from "@/components/PageHeader";
import { VoiceAgent } from "./VoiceAgent";

export const metadata = { title: "Voice agent · Marketing OS" };
export const dynamic = "force-dynamic";

export default function AgentPage() {
  return (
    <main className="flex h-full w-full flex-col px-6 pb-6 pt-4">
      <PageHeader
        title="Voice agent"
        description="Talk to Kai. It runs Claude Code headless in this repo on your plan: it knows every business, persona and automation, and can read, run and edit like a coding agent."
      />
      <VoiceAgent />
    </main>
  );
}
