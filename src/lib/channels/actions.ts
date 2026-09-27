"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { randomUUID } from "crypto";
import { query } from "@/lib/insforge/db";
import { ACTIVE_CHANNEL_COOKIE, invalidateChannelsCache } from "./store";
import type { ChannelType } from "./types";

const VALID_TYPES: ChannelType[] = ["personal", "app", "ugc"];

function clean(s: unknown, max = 120): string {
  return String(s ?? "").trim().slice(0, max);
}

function refresh() {
  invalidateChannelsCache();
  revalidatePath("/dashboard", "layout");
}

export async function setActiveChannel(id: string): Promise<void> {
  const store = await cookies();
  store.set(ACTIVE_CHANNEL_COOKIE, id, {
    path: "/",
    sameSite: "lax",
    maxAge: 60 * 60 * 24 * 365,
  });
  refresh();
}

export async function createChannel(input: {
  name: string;
  type: string;
  color?: string;
  subtitle?: string;
}): Promise<{ error?: string }> {
  const name = clean(input.name);
  const type = (VALID_TYPES as string[]).includes(input.type)
    ? (input.type as ChannelType)
    : "app";
  if (!name) return { error: "Name is required." };

  const id = randomUUID();
  const [{ next } = { next: 0 }] = await query<{ next: number }>(
    `select coalesce(max(position), -1) + 1 as next from channels`,
  );

  await query(
    `insert into channels (id, name, type, color, subtitle, position)
     values ($1, $2, $3, $4, $5, $6)`,
    [id, name, type, clean(input.color, 16) || null, clean(input.subtitle) || null, next],
  );
  refresh();
  return {};
}

export async function updateChannel(
  id: string,
  patch: { name?: string; type?: string; color?: string; subtitle?: string },
): Promise<{ error?: string }> {
  const name = clean(patch.name);
  if (!name) return { error: "Name is required." };
  const type = (VALID_TYPES as string[]).includes(patch.type ?? "")
    ? (patch.type as ChannelType)
    : "app";

  await query(
    `update channels
        set name = $2, type = $3, color = $4, subtitle = $5
      where id = $1`,
    [id, name, type, clean(patch.color, 16) || null, clean(patch.subtitle) || null],
  );
  refresh();
  return {};
}

export async function deleteChannel(id: string): Promise<void> {
  await query(`delete from channels where id = $1`, [id]);
  refresh();
}

export async function setChannelProfiles(
  channelId: string,
  profileIds: string[],
): Promise<void> {
  const ids = Array.from(new Set(profileIds.map((p) => clean(p, 80)).filter(Boolean)));
  await query(`delete from channel_profiles where channel_id = $1`, [channelId]);
  if (ids.length > 0) {
    const values = ids.map((_, i) => `($1, $${i + 2})`).join(", ");
    await query(
      `insert into channel_profiles (channel_id, zernio_profile_id) values ${values}
       on conflict do nothing`,
      [channelId, ...ids],
    );
  }
  refresh();
}
