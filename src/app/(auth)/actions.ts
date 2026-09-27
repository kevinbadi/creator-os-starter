"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SESSION_COOKIE, sessionToken, passwordMatches } from "@/lib/auth";

export type AuthState = {
  error?: string;
};

export async function signIn(
  _prev: AuthState,
  formData: FormData,
): Promise<AuthState> {
  const password = String(formData.get("password") ?? "");
  const nextRaw = String(formData.get("next") ?? "/dashboard");
  const next = nextRaw.startsWith("/") ? nextRaw : "/dashboard";

  if (!process.env.APP_PASSWORD) {
    return {
      error: "No password is set. Add APP_PASSWORD to .env.local and restart.",
    };
  }
  if (!passwordMatches(password)) {
    return { error: "Incorrect password." };
  }

  const store = await cookies();
  store.set(SESSION_COOKIE, await sessionToken(), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });

  redirect(next);
}

export async function signOut(): Promise<void> {
  const store = await cookies();
  store.delete(SESSION_COOKIE);
  redirect("/login");
}
