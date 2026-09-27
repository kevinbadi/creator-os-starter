"use server";

import { randomUUID } from "crypto";
import { revalidatePath } from "next/cache";
import { query } from "@/lib/insforge/db";

function clean(s: unknown, max = 500): string {
  return String(s ?? "").trim().slice(0, max);
}

export async function addAccomplishment(input: {
  date: string;
  text: string;
}): Promise<{ error?: string }> {
  const text = clean(input.text);
  const date = clean(input.date, 10);
  if (!text) return { error: "Note is required." };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return { error: "Invalid date." };

  await query(
    `insert into accomplishments (id, date, text) values ($1, $2, $3)`,
    [randomUUID(), date, text],
  );
  revalidatePath("/dashboard/progress");
  return {};
}

export async function deleteAccomplishment(id: string): Promise<void> {
  await query(`delete from accomplishments where id = $1`, [id]);
  revalidatePath("/dashboard/progress");
}
