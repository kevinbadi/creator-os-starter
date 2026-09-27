import { NextResponse } from "next/server";
import { requireSession, unauthorized } from "@/lib/agent-edits/http";
import { createClone, listClones } from "@/lib/agent-clones/store";
import {
  ensureWorkdir,
  humanizeSlug,
  slugifyName,
  uniqueSlug,
} from "@/lib/agent-clones/paths";
import { isCloneFormat, isClonePersona } from "@/lib/agent-clones/personas";
import type { ClonePersonaId } from "@/lib/agent-clones/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function parsePersonas(body: { persona?: string; personas?: unknown }): ClonePersonaId[] {
  const raw = Array.isArray(body.personas)
    ? body.personas
    : body.persona
      ? [body.persona]
      : [];
  const out: ClonePersonaId[] = [];
  for (const v of raw) {
    if (typeof v === "string" && isClonePersona(v) && !out.includes(v)) out.push(v);
  }
  return out;
}

export async function GET() {
  if (!(await requireSession())) return unauthorized();
  const clones = await listClones();
  return NextResponse.json({ clones });
}

export async function POST(req: Request) {
  if (!(await requireSession())) return unauthorized();
  let body: {
    title?: string;
    notes?: string;
    filename?: string;
    persona?: string;
    personas?: unknown;
    format?: string;
  } = {};
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Body must be JSON" }, { status: 400 });
  }
  const personas = parsePersonas(body);
  if (!personas.length) {
    return NextResponse.json({ error: "Pick at least one influencer." }, { status: 400 });
  }
  const filename = (body.filename || "").trim();
  if (!filename) {
    return NextResponse.json({ error: "Upload the finished video to recreate." }, { status: 400 });
  }
  const rawFormat = body.format ?? "";
  const format = isCloneFormat(rawFormat) ? rawFormat : "shortform";
  const stem = slugifyName((body.title || filename).trim());
  const title =
    (body.title || "").trim() || humanizeSlug(slugifyName(filename || stem));
  try {
    const clones = [];
    for (const persona of personas) {
      const slug = uniqueSlug(stem, persona);
      ensureWorkdir(slug, format);
      clones.push(
        await createClone({
          persona,
          format,
          slug,
          title,
          notes: (body.notes || "").trim(),
          sourceUrl: "",
          clipName: filename,
        }),
      );
    }
    return NextResponse.json({ clone: clones[0], clones });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Could not create clone";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
