import type { ReactNode } from "react";

export function PageHeader({
  title,
  description,
  actions,
  eyebrow,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
  eyebrow?: string;
}) {
  return (
    <div className="flex flex-col gap-3 pb-5 sm:flex-row sm:items-end sm:justify-between">
      <div>
        {eyebrow ? <p className="mb-2 text-[11px] uppercase tracking-[0.18em] text-neutral-500">{eyebrow}</p> : null}
        <h1 className="font-serif text-[32px] italic leading-none tracking-tight">{title}</h1>
        {description ? (
          <p className="mt-2 max-w-2xl text-sm text-neutral-600 dark:text-neutral-400">{description}</p>
        ) : null}
      </div>
      {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
    </div>
  );
}
