import "server-only";

// Zernio POST /media → presigned R2 PUT. Multi-GB is fine. Insforge's
// presigned policy hard-caps at 50MiB (EntityTooLarge) and is only for
// dashboard/feed previews — never for composer publish masters.

const BASE = process.env.ZERNIO_BASE_URL ?? "https://zernio.com/api/v1";
const PUT_TIMEOUT_MS = 30 * 60 * 1000;

export type UploadedMedia = { url: string; type: "image" | "video" };

export type ZernioMediaSlot = {
  uploadUrl: string;
  publicUrl: string;
  contentType: string;
  filename: string;
  type: "image" | "video";
};

export function mediaContentType(
  filename: string,
  declared?: string | null,
): string {
  const t = (declared || "").toLowerCase();
  if (t && t !== "application/octet-stream") return t;
  const n = filename.toLowerCase();
  if (n.endsWith(".mp4") || n.endsWith(".m4v")) return "video/mp4";
  if (n.endsWith(".mov")) return "video/quicktime";
  if (n.endsWith(".webm")) return "video/webm";
  if (n.endsWith(".png")) return "image/png";
  if (n.endsWith(".jpg") || n.endsWith(".jpeg")) return "image/jpeg";
  if (n.endsWith(".webp")) return "image/webp";
  if (n.endsWith(".gif")) return "image/gif";
  return t || "application/octet-stream";
}

export function uniqueMediaName(original: string, contentType: string): string {
  const fromName = original.match(/\.[a-z0-9]{1,8}$/i)?.[0] ?? "";
  const fromType =
    contentType === "video/mp4"
      ? ".mp4"
      : contentType === "video/quicktime"
        ? ".mov"
        : contentType === "image/png"
          ? ".png"
          : contentType === "image/jpeg"
            ? ".jpg"
            : contentType === "image/webp"
              ? ".webp"
              : contentType === "image/gif"
                ? ".gif"
                : "";
  const ext = fromName || fromType || "";
  const stem =
    original
      .replace(/\.[^.]+$/, "")
      .replace(/[^a-zA-Z0-9]+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 48) || "upload";
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}-${stem}${ext}`;
}

function mediaKind(contentType: string): "image" | "video" {
  return contentType.startsWith("video") ? "video" : "image";
}

export async function createZernioMediaSlot(
  originalName: string,
  declaredType?: string | null,
): Promise<ZernioMediaSlot> {
  const key = process.env.ZERNIO_API_KEY;
  if (!key) throw new Error("ZERNIO_API_KEY is not set");

  const contentType = mediaContentType(originalName, declaredType);
  const filename = uniqueMediaName(originalName, contentType);
  const res = await fetch(`${BASE}/media`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ filename, contentType }),
    signal: AbortSignal.timeout(20_000),
  });
  const slot = (await res.json().catch(() => ({}))) as {
    uploadUrl?: string;
    publicUrl?: string;
  };
  if (!res.ok || !slot.uploadUrl || !slot.publicUrl) {
    throw new Error(
      `Zernio media slot failed (${res.status}).`,
    );
  }
  return {
    uploadUrl: slot.uploadUrl,
    publicUrl: slot.publicUrl,
    contentType,
    filename,
    type: mediaKind(contentType),
  };
}

async function putToZernio(
  slot: ZernioMediaSlot,
  body: BodyInit,
  stream = false,
): Promise<void> {
  const init: RequestInit = {
    method: "PUT",
    headers: { "Content-Type": slot.contentType },
    body,
    signal: AbortSignal.timeout(PUT_TIMEOUT_MS),
  };
  if (stream) {
    (init as RequestInit & { duplex: "half" }).duplex = "half";
  }
  const up = await fetch(slot.uploadUrl, init);
  if (up.status >= 300) {
    const detail = (await up.text().catch(() => "")).slice(0, 200);
    throw new Error(
      `Storage upload failed (${up.status}${detail ? `: ${detail}` : ""}).`,
    );
  }
}

export async function uploadStreamToZernio(
  filename: string,
  contentType: string,
  body: ReadableStream<Uint8Array>,
): Promise<UploadedMedia> {
  const slot = await createZernioMediaSlot(filename, contentType);
  await putToZernio(slot, body, true);
  return { url: slot.publicUrl, type: slot.type };
}

export async function uploadToZernio(file: File): Promise<UploadedMedia> {
  const slot = await createZernioMediaSlot(file.name, file.type);
  await putToZernio(slot, file);
  return { url: slot.publicUrl, type: slot.type };
}

function publishedZernioUrl(url: string): string {
  return url.replace("://media.zernio.com/temp/", "://media.zernio.com/media/");
}

async function urlExists(url: string): Promise<boolean> {
  const headers = { "User-Agent": "Mozilla/5.0 CreatorOS/1.0" };
  try {
    const head = await fetch(url, {
      method: "HEAD",
      headers,
      redirect: "follow",
      signal: AbortSignal.timeout(8_000),
    });
    if (head.ok) return true;
  } catch {
    /* HEAD is often blocked on R2; probe a byte instead. */
  }
  try {
    const get = await fetch(url, {
      method: "GET",
      headers: { ...headers, Range: "bytes=0-0" },
      redirect: "follow",
      signal: AbortSignal.timeout(8_000),
    });
    return get.ok || get.status === 206;
  } catch {
    return false;
  }
}

/** Fresh uploads live at /temp/ until Zernio promotes them. Rewriting to
 *  /media/ too early 404s and createPost returns missingFiles. */
export async function liveZernioMediaUrl(url: string): Promise<string> {
  const src = String(url || "").trim();
  if (!src || !isZernioMediaUrl(src)) return src;
  const media = publishedZernioUrl(src);
  const temp = src.replace(
    "://media.zernio.com/media/",
    "://media.zernio.com/temp/",
  );
  if (src.includes("/temp/")) {
    if (await urlExists(src)) return src;
    if (await urlExists(media)) return media;
    return src;
  }
  if (await urlExists(src)) return src;
  if (await urlExists(temp)) return temp;
  return src;
}

export async function uploadBytesToZernio(
  bytes: Buffer | Uint8Array,
  filename: string,
  contentType: string,
): Promise<UploadedMedia> {
  const slot = await createZernioMediaSlot(filename, contentType);
  const blob = new Blob([new Uint8Array(bytes)], { type: slot.contentType });
  await putToZernio(slot, blob);
  return { url: slot.publicUrl, type: slot.type };
}

export function isZernioMediaUrl(url: string): boolean {
  try {
    return new URL(url).hostname.replace(/^www\./, "") === "media.zernio.com";
  } catch {
    return false;
  }
}

/** Instagram/YouTube fetch cover URLs themselves. Insforge 302s to a signed
 *  CDN, which those crawlers drop — publish thumbs must live on media.zernio.com. */
export async function rehostImageToZernio(
  url: string,
  filename: string,
): Promise<string> {
  const src = String(url || "").trim();
  if (!src) throw new Error("No cover URL to rehost.");
  if (isZernioMediaUrl(src)) return src;
  const res = await fetch(src, {
    redirect: "follow",
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) throw new Error(`Cover download failed (${res.status}).`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < 1000) throw new Error("Cover image is too small.");
  const type = (res.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
  const contentType = type.startsWith("image/") ? type : mediaContentType(filename, type);
  const uploaded = await uploadBytesToZernio(buf, filename, contentType);
  return uploaded.url;
}
