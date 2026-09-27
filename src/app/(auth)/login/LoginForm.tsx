"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { signIn, type AuthState } from "../actions";

const initialState: AuthState = {};

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="inline-flex h-11 w-full items-center justify-center rounded-full bg-neutral-900 text-sm font-medium text-white transition hover:-translate-y-px disabled:cursor-not-allowed disabled:opacity-60 dark:bg-white dark:text-neutral-900"
    >
      {pending ? "Unlocking…" : "Unlock"}
    </button>
  );
}

export function LoginForm({ next }: { next: string }) {
  const [state, formAction] = useActionState(signIn, initialState);

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <input type="hidden" name="next" value={next} />
      <label className="flex flex-col gap-1.5 text-sm">
        <span className="font-medium text-neutral-800 dark:text-neutral-200">
          Password
        </span>
        <input
          name="password"
          type="password"
          autoComplete="current-password"
          autoFocus
          required
          className="h-11 rounded-lg border border-black/[.12] bg-white px-3.5 text-sm text-neutral-900 placeholder:text-neutral-400 outline-none ring-neutral-900/10 transition focus:border-neutral-400 focus:ring-2 dark:border-white/[.19] dark:bg-[var(--surface-2)] dark:text-neutral-100 dark:placeholder:text-neutral-500 dark:focus:border-neutral-500"
        />
      </label>

      {state.error ? (
        <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-300">
          {state.error}
        </p>
      ) : null}

      <SubmitButton />
    </form>
  );
}
