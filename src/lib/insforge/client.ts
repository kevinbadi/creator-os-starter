import "server-only";

// Insforge backend client (scaffold). Fill in once you provide:
//   INSFORGE_API_BASE_URL  — e.g. https://<project>.insforge.app
//   INSFORGE_API_KEY       — service/secret key (server-only, never NEXT_PUBLIC_)

const BASE = process.env.INSFORGE_API_BASE_URL ?? "";
const KEY = process.env.INSFORGE_API_KEY ?? "";

export const insforgeConfigured = Boolean(BASE && KEY);

class InsforgeError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
    this.name = "InsforgeError";
  }
}

export async function insforgeFetch<T>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  if (!insforgeConfigured) {
    throw new InsforgeError(
      500,
      "Insforge is not configured. Set INSFORGE_API_BASE_URL and INSFORGE_API_KEY.",
    );
  }
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${KEY}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
    cache: "no-store",
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new InsforgeError(
      res.status,
      `Insforge ${res.status}: ${body.slice(0, 200) || res.statusText}`,
    );
  }
  return (await res.json()) as T;
}
