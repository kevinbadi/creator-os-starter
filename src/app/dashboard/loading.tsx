export default function DashboardLoading() {
  return (
    <main className="w-full px-6 py-8">
      <div className="h-8 w-48 animate-pulse rounded-md bg-black/[.06] dark:bg-white/[.11]" />
      <div className="mt-2 h-4 w-72 animate-pulse rounded bg-black/[.04] dark:bg-white/[.08]" />
      <div className="mt-8 grid grid-cols-2 gap-4 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div
            key={i}
            className="h-24 animate-pulse rounded-2xl bg-black/[.04] dark:bg-white/[.08]"
          />
        ))}
      </div>
      <div className="mt-8 h-72 animate-pulse rounded-2xl bg-black/[.04] dark:bg-white/[.08]" />
    </main>
  );
}
