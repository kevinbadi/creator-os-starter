---
name: vip-sound
description: Ingest a TikTok/Reels/any link Kevin drops into the sounds table as a VIP trending sound — downloads the audio (yt-dlp → mp3), uploads to Insforge, inserts favorite=true with an active vip_until window so it rides the TOP of every publisher's sound queue. Trigger whenever Kevin shares a video link and wants its sound used/prioritized ("use this sound", "VIP this", or just a bare TikTok/Reel link in a sounds context).
---

# vip-sound

Kevin discovers trending sounds on TikTok/Reels throughout the day. Their
algorithmic boost lasts only a few days, so they must jump the queue NOW.

## Run

```bash
node --env-file=.env.local scripts/add-vip-sound.mjs <url> \
     [--days 4] [--title "..."] [--gender any|female|male] [--notes "..."]
```

- Downloads audio via yt-dlp (mp3), uploads to Insforge `media` bucket,
  inserts a `sounds` row: `favorite=true`, `batch='vip-manual'`,
  `vip_until = now() + days` (default 4).
- **Queue semantics** (shared by reaction-ugc, carousel-publish-instagram,
  listFavoriteSounds): active VIPs first (LRU among them — VIPs MAY repeat
  across posts while the window lasts), then unused favorites newest-first,
  then LRU fallback. Expiry is automatic; no cleanup needed.
- Run from the repo root on the Mac (needs yt-dlp + ffmpeg). The Railway
  publishers only read the DB/storage — nothing to deploy for a new sound.

## Gotchas

- IG Reels sometimes require login for yt-dlp — ask Kevin for the TikTok
  version of the sound if a Reel 403s.
- TikTok `/music/…` pages are NOT videos — ask for a video link that uses
  the sound.
- Verify after insert: the script prints the ET expiry; the next scheduled
  reaction/carousel run picks it automatically (`★ VIP sound` in its log).
