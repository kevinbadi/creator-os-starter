import { LoginForm } from "./LoginForm";

export const metadata = {
  title: "Sign in · Marketing OS",
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;
  const safeNext = next && next.startsWith("/") ? next : "/dashboard";

  return (
    <main
      className="flex min-h-screen w-full items-center justify-center px-6"
      style={{ background: "#F2EFE8", color: "#0F0E0C" }}
    >
      <div className="w-full max-w-sm">
        <div className="mb-8 flex items-center gap-2">
          <span
            className="size-2.5 rounded-full"
            style={{ background: "#2dd4bf" }}
          />
          <span className="text-[15px] font-semibold tracking-tight">
            Marketing&nbsp;OS
          </span>
        </div>
        <h1 className="text-2xl font-medium tracking-tight">Welcome back</h1>
        <p className="mt-1.5 text-sm text-neutral-500">
          Enter your password to open the dashboard.
        </p>
        <div className="mt-7 rounded-2xl border border-black/[.08] bg-white p-6 shadow-sm">
          <LoginForm next={safeNext} />
        </div>
        <p className="mt-6 text-center text-xs text-neutral-400">
          Private workspace · single user
        </p>
      </div>
    </main>
  );
}
