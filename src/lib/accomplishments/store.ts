import "server-only";
import { query } from "@/lib/insforge/db";

export type Accomplishment = {
  id: string;
  date: string; // YYYY-MM-DD
  text: string;
};

export async function listAccomplishments(): Promise<Accomplishment[]> {
  const rows = await query<{ id: string; date: string; text: string }>(
    `select id, to_char(date, 'YYYY-MM-DD') as date, text
       from accomplishments
      order by date desc, created_at desc`,
  );
  return rows;
}
