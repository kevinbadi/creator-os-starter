"use server";

import { revalidatePath } from "next/cache";
import { AI_NEWS_STATUSES, setAiNewsStatus, type AiNewsStatus } from "./store";

function refresh() {
  revalidatePath("/dashboard");
  revalidatePath("/dashboard/news");
}

export async function markAiNewsStatus(id: string, status: AiNewsStatus) {
  if (!AI_NEWS_STATUSES.includes(status)) return;
  await setAiNewsStatus(id, status);
  refresh();
}
