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
  /** Tiny tracked-caps label above the serif title (section / context). */
  eyebrow?: string;
}) {
  return (
    <div className="flex flex-col gap-3 pb-5 sm:flex-row sm:items-end sm:justify-between">
      <div>
        {eyebrow ? <p className="eyebrow mb-2">{eyebrow}</p> : null}
        <h1 className="font-serif text-[32px] italic leading-none tracking-tight">
          {title}
        </h1>
        {description ? (
          <p className="mt-2 max-w-2xl text-sm text-neutral-600 dark:text-[#b6bac2]">
            {description}
          </p>
        ) : null}
        <div className="rule mt-4 w-full" />
      </div>
      {actions ? <div className="flex items-center gap-2 sm:pb-5">{actions}</div> : null}
    </div>
  );
}
