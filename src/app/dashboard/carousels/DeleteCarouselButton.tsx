"use client";

import { useState, useTransition } from "react";
import { deleteCarousel } from "@/lib/carousels/actions";

export function DeleteCarouselButton({
  persona,
  id,
  topic,
}: {
  persona: string;
  id: string;
  topic: string;
}) {
  const [confirming, setConfirming] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function onDelete() {
    setError(null);
    startTransition(async () => {
      const res = await deleteCarousel(persona, id);
      if (res?.error) {
        setError(res.error);
        setConfirming(false);
      }
      // On success the page revalidates and this card disappears.
    });
  }

  if (confirming) {
    return (
      <div className="flex items-center gap-1.5">
        <span className="text-[11px] text-neutral-500">Delete?</span>
        <button
          type="button"
          onClick={onDelete}
          disabled={pending}
          className="rounded-md bg-red-600 px-2 py-0.5 text-[11px] font-medium text-white transition hover:bg-red-700 disabled:opacity-50"
        >
          {pending ? "Deleting…" : "Yes, delete"}
        </button>
        <button
          type="button"
          onClick={() => setConfirming(false)}
          disabled={pending}
          className="rounded-md border border-black/[.12] px-2 py-0.5 text-[11px] font-medium text-neutral-600 transition hover:bg-black/[.04] disabled:opacity-50 dark:border-white/[.19] dark:text-neutral-300 dark:hover:bg-white/[.09]"
        >
          Cancel
        </button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2">
      {error ? <span className="text-[11px] text-red-500">{error}</span> : null}
      <button
        type="button"
        onClick={() => setConfirming(true)}
        aria-label={`Delete carousel: ${topic}`}
        className="rounded-md border border-black/[.12] px-2 py-0.5 text-[11px] font-medium text-neutral-500 transition hover:border-red-300 hover:bg-red-50 hover:text-red-600 dark:border-white/[.19] dark:hover:border-red-900/60 dark:hover:bg-red-950/40 dark:hover:text-red-400"
      >
        Delete
      </button>
    </div>
  );
}
