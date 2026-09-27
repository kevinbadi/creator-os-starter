import { PageHeader } from "@/components/PageHeader";
import { JevChat } from "../jev/JevChat";
import { JevCapacity } from "../jev/JevCapacity";
import { PLATFORMS, RANGES, SORTS, STATUSES, TOOLS } from "@/lib/jev/tools";
import { layaConfigured } from "@/lib/laya/client";

export const metadata = { title: "Laya · Marketing OS" };
export const dynamic = "force-dynamic";

export default async function LayaPage() {
  let ready = false;
  if (layaConfigured()) {
    try {
      const base = (process.env.LAYA_URL || "http://127.0.0.1:8000").replace(/\/$/, "");
      const r = await fetch(`${base}/health`, { signal: AbortSignal.timeout(1500), cache: "no-store" });
      ready = r.ok;
    } catch {
      ready = false;
    }
  }
  return (
    <main className="flex h-full w-full flex-col px-6 pb-6 pt-4">
      <PageHeader
        title="Laya"
        description="Open-source System One (Apache 2.0) on the same Marketing OS tools Jev uses. Ask in plain words; Laya picks the tool, range, sort and platform, the dashboard runs it and shows the rows. Local weights — no TypeSafe bill. Fine-tuned on the tool catalog."
        actions={
          <JevCapacity
            max={22}
            questions={[
              { label: "tools", used: Object.keys(TOOLS).length },
              { label: "ranges", used: Object.keys(RANGES).length },
              { label: "sorts", used: Object.keys(SORTS).length },
              { label: "platforms", used: Object.keys(PLATFORMS).length },
              { label: "statuses", used: Object.keys(STATUSES).length },
            ]}
          />
        }
      />
      <JevChat
        configured={ready}
        decidePath="/api/laya"
        speakPath="/api/jev/speak"
        name="Laya"
        tagline="Open source Jev · Convai Innovations"
        missingKeyHint="Laya sidecar is not running. From creator-os: npm run laya-server (needs pip install laya fastapi uvicorn)."
        storagePrefix="mos:laya"
        core="#38c8f8"
        coreLabel="LAYA"
      />
    </main>
  );
}
