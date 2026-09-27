export function MissingCreatorOsKey() {
  return (
    <aside className="mb-6 rounded-2xl border border-amber-500/40 bg-amber-500/[.08] px-5 py-4">
      <p className="text-sm font-medium text-amber-950 dark:text-amber-100">
        Agent Posts needs a Creator OS API key before it can schedule anything.
      </p>
      <p className="mt-2 text-sm text-amber-900/80 dark:text-amber-100/80">
        Get yours at{" "}
        <a
          href="https://www.creatoros.ca/"
          target="_blank"
          rel="noreferrer"
          className="underline underline-offset-2"
        >
          creatoros.ca
        </a>
        , then add it to <code className="rounded bg-black/10 px-1">.env.local</code>:
      </p>
      <pre className="mt-3 overflow-x-auto rounded-lg bg-black/80 px-3 py-2 text-xs text-white">
        CREATOR_OS_API_KEY=paste_the_key_here
      </pre>
      <p className="mt-2 text-xs text-amber-900/70 dark:text-amber-100/60">
        Use your own key. Do not copy someone else&apos;s. Restart the app after saving.
      </p>
    </aside>
  );
}
