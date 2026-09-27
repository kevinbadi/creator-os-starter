// Large-media upload via Zernio's own store (Late R2) — the RIGHT path for
// publish masters (Kevin 2026-07-26: "zernio has large file upload pathways...
// fix this logic, so that hq content gets posted").
//
// Insforge presigned uploads hard-cap at 50MiB (content-length-range in the
// policy, verified 07-26) — that cap forced 780kbps masters. Zernio's
// POST /media returns a presigned R2 PUT (multi-GB fine) + a public
// media.zernio.com URL that posts/thumbnailUrl can reference directly.
//
// RULE: publish media (video masters, YT thumbnails) -> uploadZernioMedia.
//       Insforge storage stays for dashboard/feed previews and internal
//       assets only. Platform size caps are all far above any master we
//       ship (LinkedIn 5GB, YouTube 256GB, IG/TikTok/FB multi-GB).
const fs = require("fs");

const ZERNIO_BASE = process.env.ZERNIO_BASE_URL || "https://zernio.com/api/v1";

async function uploadZernioMedia(localPath, filename, contentType) {
  const key = process.env.ZERNIO_API_KEY;
  if (!key) throw new Error("ZERNIO_API_KEY not set");
  const slot = await (await fetch(`${ZERNIO_BASE}/media`, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ filename, contentType }),
  })).json();
  if (!slot.uploadUrl || !slot.publicUrl) {
    throw new Error(`zernio /media gave no upload slot: ${JSON.stringify(slot).slice(0, 200)}`);
  }
  const buf = fs.readFileSync(localPath);
  const up = await fetch(slot.uploadUrl, {
    method: "PUT",
    headers: { "Content-Type": contentType },
    body: buf,
  });
  if (up.status >= 300) throw new Error(`R2 PUT ${up.status}: ${(await up.text()).slice(0, 200)}`);
  return slot.publicUrl;
}

module.exports = { uploadZernioMedia };
