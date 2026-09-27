import { PageHeader } from "@/components/PageHeader";
import { listChannels } from "@/lib/channels/store";
import { CHANNEL_TYPE_LABEL } from "@/lib/channels/types";
import { insforgeConfigured } from "@/lib/insforge/client";

export const metadata = { title: "Settings · Marketing OS" };

export default async function SettingsPage() {
  const channels = await listChannels();
  const zernioConfigured = Boolean(process.env.ZERNIO_API_KEY);
  const authConfigured = Boolean(process.env.APP_PASSWORD);

  return (
    <main className="w-full px-6 py-8">
      <PageHeader
        title="Settings"
        description="Channels, integrations, and workspace config."
      />

      <Section title="Channels">
        {channels.length === 0 ? (
          <p className="text-sm text-neutral-500">No channels yet.</p>
        ) : (
          channels.map((c) => (
            <div
              key={c.id}
              className="flex items-center justify-between rounded-xl border border-black/[.08] bg-white px-4 py-3 dark:border-white/[.14] dark:bg-[var(--surface-1)]"
            >
              <span className="flex items-center gap-2.5">
                <span
                  className="size-2.5 rounded-full"
                  style={{ background: c.color || "#a3a3a3" }}
                />
                <span className="text-sm font-medium">{c.name}</span>
              </span>
              <span className="flex items-center gap-3 text-xs text-neutral-500">
                <span>{CHANNEL_TYPE_LABEL[c.type]}</span>
                <span>
                  {c.zernioProfileIds.length} profile
                  {c.zernioProfileIds.length === 1 ? "" : "s"}
                </span>
              </span>
            </div>
          ))
        )}
      </Section>

      <Section title="Integrations">
        <Integration
          name="Zernio"
          description="Unified social publishing across 14+ platforms."
          connected={zernioConfigured}
        />
        <Integration
          name="Insforge"
          description="Backend database for channels, profiles, and snapshots."
          connected={insforgeConfigured}
        />
        <Integration
          name="Password gate"
          description="Single-user access control."
          connected={authConfigured}
        />
      </Section>
    </main>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mt-8">
      <h2 className="text-sm font-medium text-neutral-500">{title}</h2>
      <div className="mt-3 space-y-2">{children}</div>
    </section>
  );
}

function Integration({
  name,
  description,
  connected,
}: {
  name: string;
  description: string;
  connected: boolean;
}) {
  return (
    <div className="flex items-center justify-between rounded-xl border border-black/[.08] bg-white p-4 dark:border-white/[.14] dark:bg-[var(--surface-1)]">
      <div>
        <p className="text-sm font-medium">{name}</p>
        <p className="mt-0.5 text-xs text-neutral-500">{description}</p>
      </div>
      <span
        className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium ${
          connected
            ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300"
            : "bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300"
        }`}
      >
        {connected ? "Connected" : "Not configured"}
      </span>
    </div>
  );
}
