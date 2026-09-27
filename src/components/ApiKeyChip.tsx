"use client";

import { useState } from "react";

// Masked per-profile Zernio key chip on the Overview (Kevin 2026-07-13).
// Click copies the FULL secret when it's stored in channel_profiles (cyan
// key glyph); preview-only rows copy nothing and say so. The dashboard is
// password-gated, so shipping the secret to the client is Kevin's call.
export function ApiKeyChip({
  preview,
  name,
  fullKey,
}: {
  preview: string | null;
  name: string | null;
  fullKey: string | null;
}) {
  const [copied, setCopied] = useState(false);

  if (!preview) {
    return (
      <p className="mt-0.5 font-mono text-[9px] text-neutral-500/60">⚿ no scoped key</p>
    );
  }

  const copyable = Boolean(fullKey);
  return (
    <button
      type="button"
      disabled={!copyable}
      onClick={async () => {
        if (!fullKey) return;
        await navigator.clipboard.writeText(fullKey);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
      title={copyable ? `${name ?? "API key"} — click to copy` : `${name ?? "API key"} — preview only, full secret not stored`}
      className={`mt-0.5 block max-w-full truncate text-left font-mono text-[9px] ${
        copyable
          ? "cursor-pointer text-neutral-400 hover:text-neutral-200"
          : "cursor-default text-neutral-400"
      }`}
    >
      <span className={copyable ? "text-[#22d3ee]" : ""}>⚿</span>{" "}
      {copied ? <span className="font-semibold text-[#22d3ee]">copied ✓</span> : preview}
    </button>
  );
}
