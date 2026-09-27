"use client";

import { useActionState, useMemo, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import { publishPost, type ComposerState } from "./actions";
import { buildDmMessage, resolveResourceUrls } from "@/lib/comments/dm-copy";
import { PlatformBadge } from "@/components/PlatformBadge";
import { platformLabel } from "@/lib/format";
import { fitTwitterCaption, twitterWeightedLength, fitThreadsCaption, threadsCaptionLength } from "@/lib/twitter-caption";
import type { ZernioAccount, ZernioProfile } from "@/lib/zernio/types";

const initial: ComposerState = {};

type MediaKind = "image" | "video" | "other";
type Upload = {
  id: string;
  file?: File; // absent for GIFs imported from Giphy
  previewUrl: string;
  kind: MediaKind;
  status: "uploading" | "done" | "error";
  url?: string;
  type?: "image" | "video";
  error?: string;
};

type GifResult = { id: string; title: string; preview: string; mp4: string };

function kindOf(file: File): MediaKind {
  if (file.type.startsWith("image/")) return "image";
  if (file.type.startsWith("video/")) return "video";
  return "other";
}

function isHeavyUpload(file: File): boolean {
  if (file.size > 40 * 1024 * 1024) return true;
  if (file.type.startsWith("video/")) return true;
  return /\.(mp4|m4v|mov|webm)$/i.test(file.name);
}

async function uploadMediaFile(
  file: File,
): Promise<{ url: string; type: "image" | "video" }> {
  if (isHeavyUpload(file)) {
    const slotRes = await fetch("/api/upload/slot", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ filename: file.name, contentType: file.type }),
    });
    const slot = await slotRes.json();
    if (slotRes.ok && slot.uploadUrl && slot.publicUrl) {
      try {
        const put = await fetch(slot.uploadUrl, {
          method: "PUT",
          headers: { "Content-Type": slot.contentType },
          body: file,
        });
        if (put.ok) {
          return {
            url: slot.publicUrl,
            type: slot.type === "image" ? "image" : "video",
          };
        }
      } catch {
        // R2 CORS or a dropped connection — stream through our API instead.
      }
    }

    const res = await fetch("/api/upload", {
      method: "PUT",
      headers: {
        "x-filename": encodeURIComponent(file.name),
        "content-type": file.type || "application/octet-stream",
      },
      body: file,
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Upload failed");
    return data;
  }

  const fd = new FormData();
  fd.append("file", file, file.name);
  const res = await fetch("/api/upload", { method: "POST", body: fd });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Upload failed");
  return data;
}

function SubmitButton({
  scheduled,
  disabled,
}: {
  scheduled: boolean;
  disabled: boolean;
}) {
  const { pending } = useFormStatus();
  const busy = pending || disabled;
  return (
    <button
      type="submit"
      disabled={busy}
      className="inline-flex h-10 items-center justify-center rounded-md bg-neutral-900 px-5 text-sm font-medium text-white transition hover:bg-neutral-800 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-white dark:text-neutral-900 dark:hover:bg-neutral-200"
    >
      {pending
        ? scheduled
          ? "Scheduling…"
          : "Publishing…"
        : disabled
          ? "Uploading media…"
          : scheduled
            ? "Schedule post"
            : "Publish now"}
    </button>
  );
}

export function Composer({
  profiles,
  accounts,
  initialProfileId,
  nextSlots = {},
}: {
  profiles: ZernioProfile[];
  accounts: ZernioAccount[];
  initialProfileId?: string;
  nextSlots?: Record<string, string>;
}) {
  const [state, formAction] = useActionState(publishPost, initial);
  const [profileId, setProfileId] = useState<string>(
    initialProfileId || profiles[0]?._id || "",
  );
  const [content, setContent] = useState("");
  const [scheduleAt, setScheduleAt] = useState("");
  const [selectedAccounts, setSelectedAccounts] = useState<Set<string>>(new Set());
  const [uploads, setUploads] = useState<Upload[]>([]);
  const idRef = useRef(0);

  const [showGif, setShowGif] = useState(false);
  const [gifQuery, setGifQuery] = useState("");
  const [gifResults, setGifResults] = useState<GifResult[]>([]);
  const [gifLoading, setGifLoading] = useState(false);

  const [commentDmEnabled, setCommentDmEnabled] = useState(false);
  const [commentDmKeyword, setCommentDmKeyword] = useState("");
  const [commentDmText, setCommentDmText] = useState("");
  const [commentDmResource, setCommentDmResource] = useState("");
  const [commentDmReply, setCommentDmReply] = useState("Awesome, check DMs!");
  const [youtubeTitle, setYoutubeTitle] = useState("");
  const [reelCover, setReelCover] = useState<Upload | null>(null);

  async function runGifSearch(q: string) {
    setGifLoading(true);
    try {
      const res = await fetch(`/api/giphy/search?q=${encodeURIComponent(q)}`);
      const data = await res.json();
      setGifResults(data.results ?? []);
    } catch {
      setGifResults([]);
    } finally {
      setGifLoading(false);
    }
  }

  function toggleGif() {
    setShowGif((v) => {
      const next = !v;
      if (next && gifResults.length === 0) runGifSearch("");
      return next;
    });
  }

  async function pickGif(g: GifResult) {
    const id = String(++idRef.current);
    setUploads((prev) => [
      ...prev,
      { id, previewUrl: g.preview, kind: "image", status: "uploading", type: "video" },
    ]);
    try {
      const res = await fetch("/api/giphy/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: g.mp4, title: g.title }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Import failed");
      setUploads((prev) =>
        prev.map((u) =>
          u.id === id ? { ...u, status: "done", url: data.url, type: data.type ?? "video" } : u,
        ),
      );
    } catch (e) {
      setUploads((prev) =>
        prev.map((u) =>
          u.id === id
            ? { ...u, status: "error", error: e instanceof Error ? e.message : "Failed" }
            : u,
        ),
      );
    }
  }

  const profileAccounts = useMemo(
    () =>
      accounts.filter((a) => {
        const pid = typeof a.profileId === "string" ? a.profileId : a.profileId?._id;
        return pid === profileId;
      }),
    [accounts, profileId],
  );

  const toggleAccount = (key: string) => {
    setSelectedAccounts((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  async function uploadOne(entry: Upload) {
    if (!entry.file) return; // GIFs imported from Giphy have no local file to upload
    try {
      const data = await uploadMediaFile(entry.file);
      setUploads((prev) =>
        prev.map((u) =>
          u.id === entry.id
            ? { ...u, status: "done", url: data.url, type: data.type }
            : u,
        ),
      );
    } catch (e) {
      setUploads((prev) =>
        prev.map((u) =>
          u.id === entry.id
            ? { ...u, status: "error", error: e instanceof Error ? e.message : "Failed" }
            : u,
        ),
      );
    }
  }

  function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const picked = Array.from(e.target.files ?? []);
    e.target.value = ""; // allow re-selecting the same file later
    const entries: Upload[] = picked.map((file) => ({
      id: String(++idRef.current),
      file,
      previewUrl: URL.createObjectURL(file),
      kind: kindOf(file),
      status: "uploading",
    }));
    setUploads((prev) => [...prev, ...entries]);
    entries.forEach(uploadOne);
  }

  function removeUpload(id: string) {
    setUploads((prev) => {
      const target = prev.find((u) => u.id === id);
      if (target?.previewUrl.startsWith("blob:")) URL.revokeObjectURL(target.previewUrl);
      return prev.filter((u) => u.id !== id);
    });
  }

  async function uploadReelCover(file: File) {
    const entry: Upload = {
      id: String(++idRef.current),
      file,
      previewUrl: URL.createObjectURL(file),
      kind: "image",
      status: "uploading",
    };
    setReelCover((prev) => {
      if (prev?.previewUrl.startsWith("blob:")) URL.revokeObjectURL(prev.previewUrl);
      return entry;
    });
    try {
      const data = await uploadMediaFile(file);
      setReelCover((prev) =>
        prev?.id === entry.id
          ? { ...prev, status: "done", url: data.url, type: "image" }
          : prev,
      );
    } catch (e) {
      setReelCover((prev) =>
        prev?.id === entry.id
          ? {
              ...prev,
              status: "error",
              error: e instanceof Error ? e.message : "Failed",
            }
          : prev,
      );
    }
  }

  function onPickReelCover(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (!file.type.startsWith("image/")) return;
    uploadReelCover(file);
  }

  function removeReelCover() {
    setReelCover((prev) => {
      if (prev?.previewUrl.startsWith("blob:")) URL.revokeObjectURL(prev.previewUrl);
      return null;
    });
  }

  const charCount = content.length;
  const scheduled = scheduleAt.length > 0;
  const isUploading =
    uploads.some((u) => u.status === "uploading") ||
    reelCover?.status === "uploading";
  const doneMedia = uploads.filter((u) => u.status === "done" && u.url);
  const dmCapable = Array.from(selectedAccounts).some((key) => {
    const platform = key.split("::")[0]?.toLowerCase();
    return platform === "instagram" || platform === "facebook";
  });
  const instagramSelected = Array.from(selectedAccounts).some(
    (key) => key.split("::")[0]?.toLowerCase() === "instagram",
  );
  const youtubeSelected = Array.from(selectedAccounts).some(
    (key) => key.split("::")[0]?.toLowerCase() === "youtube",
  );
  const hasVideo = uploads.some(
    (u) => u.type === "video" || u.kind === "video",
  );
  const twitterSelected = Array.from(selectedAccounts).some((key) => {
    const platform = key.split("::")[0]?.toLowerCase();
    return platform === "twitter" || platform === "x";
  });
  const twitterCaption = twitterSelected ? fitTwitterCaption(content) : "";
  const twitterOver = twitterSelected && twitterWeightedLength(content) > 280;
  const threadsSelected = Array.from(selectedAccounts).some(
    (key) => key.split("::")[0]?.toLowerCase() === "threads",
  );
  const threadsCaption = threadsSelected ? fitThreadsCaption(content) : "";
  const threadsOver = threadsSelected && threadsCaptionLength(content) > 500;
  const dmArmed = commentDmEnabled && dmCapable;

  return (
    <form action={formAction} className="grid gap-6 lg:grid-cols-3">
      <input type="hidden" name="profileId" value={profileId} />
      {Array.from(selectedAccounts).map((v) => (
        <input key={v} type="hidden" name="account" value={v} />
      ))}
      {doneMedia.map((u) => (
        <input key={u.id} type="hidden" name="media" value={`${u.type}::${u.url}`} />
      ))}
      {instagramSelected && reelCover?.status === "done" && reelCover.url ? (
        <input type="hidden" name="instagramThumbnail" value={reelCover.url} />
      ) : null}
      {dmArmed ? (
        <>
          <input type="hidden" name="commentDmEnabled" value="1" />
          <input type="hidden" name="commentDmKeyword" value={commentDmKeyword} />
          <input type="hidden" name="commentDmText" value={commentDmText} />
          <input type="hidden" name="commentDmResource" value={commentDmResource} />
          <input type="hidden" name="commentDmReply" value={commentDmReply} />
        </>
      ) : null}

      <div className="lg:col-span-2">
        <div className="rounded-2xl border border-black/[.08] bg-white p-5 dark:border-white/[.14] dark:bg-[var(--surface-1)]">
          <label className="block text-sm font-medium">Profile</label>
          <select
            value={profileId}
            onChange={(e) => {
              setProfileId(e.target.value);
              setSelectedAccounts(new Set());
            }}
            className="mt-1 h-10 w-full rounded-md border border-black/[.12] bg-white px-3 text-sm dark:border-white/[.19] dark:bg-[var(--surface-2)]"
          >
            <option value="" disabled>
              Pick a profile
            </option>
            {profiles.map((p) => (
              <option key={p._id} value={p._id}>
                {p.name}
              </option>
            ))}
          </select>

          <label className="mt-5 block text-sm font-medium">Content</label>
          <textarea
            name="content"
            value={content}
            onChange={(e) => setContent(e.target.value)}
            rows={8}
            placeholder="What's the message?"
            className="mt-1 w-full resize-y rounded-md border border-black/[.12] bg-white px-3 py-2 text-sm leading-relaxed outline-none ring-neutral-900/10 transition focus:border-neutral-400 focus:ring-2 dark:border-white/[.19] dark:bg-[var(--surface-2)]"
          />
          <div className="mt-1 flex justify-end text-xs text-neutral-500">
            {charCount} characters
          </div>

          {twitterSelected && content.trim() ? (
            <div className="mt-3 rounded-xl border border-black/[.08] bg-black/[.02] px-3 py-2.5 dark:border-white/[.12] dark:bg-white/[.03]">
              <p className="text-[11px] font-medium uppercase tracking-wide text-neutral-500">
                X post {twitterOver ? "(rewritten to 280)" : "(fits as-is)"}
              </p>
              <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-neutral-800 dark:text-neutral-200">
                {twitterCaption}
              </p>
              <p className="mt-1.5 text-xs text-neutral-500">
                {twitterWeightedLength(twitterCaption)}/280 · other platforms still get the full caption
              </p>
            </div>
          ) : null}

          {threadsSelected && content.trim() ? (
            <div className="mt-3 rounded-xl border border-black/[.08] bg-black/[.02] px-3 py-2.5 dark:border-white/[.12] dark:bg-white/[.03]">
              <p className="text-[11px] font-medium uppercase tracking-wide text-neutral-500">
                Threads post {threadsOver ? "(rewritten to 500)" : "(fits as-is)"}
              </p>
              <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-neutral-800 dark:text-neutral-200">
                {threadsCaption}
              </p>
              <p className="mt-1.5 text-xs text-neutral-500">
                {threadsCaptionLength(threadsCaption)}/500 · other platforms still get the full caption
              </p>
            </div>
          ) : null}

          {youtubeSelected ? (
            <div className="mt-5">
              <label className="block text-sm font-medium" htmlFor="youtube-title">
                YouTube title
              </label>
              <input
                id="youtube-title"
                type="text"
                name="youtubeTitle"
                value={youtubeTitle}
                onChange={(e) => setYoutubeTitle(e.target.value.slice(0, 100))}
                maxLength={100}
                required
                placeholder="Title for the Short"
                className="mt-1 h-10 w-full rounded-md border border-black/[.12] bg-white px-3 text-sm outline-none ring-neutral-900/10 transition focus:border-neutral-400 focus:ring-2 dark:border-white/[.19] dark:bg-[var(--surface-2)]"
              />
              <div className="mt-1 flex items-center justify-between text-xs text-neutral-500">
                <span>YouTube uses this as the title. The caption above is the description.</span>
                <span>{youtubeTitle.length}/100</span>
              </div>
            </div>
          ) : null}

          <div className="mt-5 flex items-center justify-between">
            <label className="block text-sm font-medium">Media</label>
            <button
              type="button"
              onClick={toggleGif}
              className="inline-flex h-7 items-center gap-1 rounded-full bg-teal-500/15 px-2.5 text-xs font-medium text-teal-700 transition hover:brightness-95 dark:text-teal-300"
            >
              {showGif ? "Close GIFs" : "Search GIFs"}
            </button>
          </div>
          <input
            id="media-input"
            type="file"
            accept="image/*,video/*"
            multiple
            onChange={onPick}
            className="hidden"
          />
          <label
            htmlFor="media-input"
            className="mt-1 flex cursor-pointer flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-black/[.18] bg-black/[.015] px-4 py-6 text-center text-sm transition hover:border-black/[.3] hover:bg-black/[.03] dark:border-white/[.18] dark:bg-white/[.02] dark:hover:border-white/[.35]"
          >
            <span className="font-medium">Click to add media</span>
            <span className="text-xs text-neutral-500">
              Add one or many — images for carousels, video for shorts/longform
            </span>
          </label>

          {showGif ? (
            <div className="mt-2 rounded-xl border border-black/[.10] p-2 dark:border-white/[.12]">
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  runGifSearch(gifQuery);
                }}
                className="flex gap-2"
              >
                <input
                  value={gifQuery}
                  onChange={(e) => setGifQuery(e.target.value)}
                  placeholder="Search memes — e.g. crying jordan, kevin hart sad"
                  className="h-9 flex-1 rounded-lg border border-black/[.12] bg-white px-3 text-sm text-neutral-900 outline-none transition focus:border-teal-400 dark:border-white/[.19] dark:bg-[var(--surface-2)] dark:text-neutral-100"
                />
                <button
                  type="submit"
                  className="inline-flex h-9 items-center rounded-lg bg-neutral-900 px-3 text-sm font-medium text-white dark:bg-white dark:text-neutral-900"
                >
                  Search
                </button>
              </form>
              {gifLoading ? (
                <p className="py-6 text-center text-xs text-neutral-500">Searching…</p>
              ) : (
                <div className="mt-2 grid max-h-64 grid-cols-3 gap-2 overflow-y-auto sm:grid-cols-4">
                  {gifResults.map((g) => (
                    <button
                      key={g.id}
                      type="button"
                      onClick={() => pickGif(g)}
                      title={g.title}
                      className="relative aspect-square overflow-hidden rounded-lg border border-black/[.08] transition hover:border-teal-400 dark:border-white/[.14]"
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={g.preview} alt={g.title} className="h-full w-full object-cover" />
                    </button>
                  ))}
                  {gifResults.length === 0 ? (
                    <p className="col-span-full py-6 text-center text-xs text-neutral-500">
                      No GIFs found.
                    </p>
                  ) : null}
                </div>
              )}
              <p className="mt-1.5 text-[10px] text-neutral-400">
                GIFs import as MP4 so they work in carousels on every platform. Powered by GIPHY.
              </p>
            </div>
          ) : null}

          {uploads.length > 0 ? (
            <div className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-4">
              {uploads.map((u) => (
                <MediaTile key={u.id} upload={u} onRemove={() => removeUpload(u.id)} />
              ))}
            </div>
          ) : null}

          {instagramSelected ? (
            <ReelCoverField
              cover={reelCover}
              hasVideo={hasVideo}
              onPick={onPickReelCover}
              onRemove={removeReelCover}
            />
          ) : null}

          <label className="mt-5 block text-sm font-medium">
            Schedule (optional)
          </label>
          <input
            type="datetime-local"
            name="scheduledFor"
            value={scheduleAt}
            onChange={(e) => setScheduleAt(e.target.value)}
            className="mt-1 h-10 w-full rounded-md border border-black/[.12] bg-white px-3 text-sm dark:border-white/[.19] dark:bg-[var(--surface-2)]"
          />
          <p className="mt-1 text-xs text-neutral-500">
            Leave blank to publish immediately.
            {nextSlots[profileId]
              ? ` Next open Agent Post slot for this profile is ${nextSlots[profileId]}.`
              : " Agent Posts use 12:00am, 3:00, 6:00, or 9:00pm ET."}
          </p>

          <CommentDmSection
            enabled={commentDmEnabled}
            onEnabledChange={setCommentDmEnabled}
            keyword={commentDmKeyword}
            onKeywordChange={setCommentDmKeyword}
            message={commentDmText}
            onMessageChange={setCommentDmText}
            resource={commentDmResource}
            onResourceChange={setCommentDmResource}
            reply={commentDmReply}
            onReplyChange={setCommentDmReply}
            capable={dmCapable}
            onInsertCta={() => {
              const word = commentDmKeyword.trim() || "KEYWORD";
              const line = `Comment "${word}" and I'll send it over.`;
              setContent((prev) =>
                prev.startsWith(line) ? prev : prev ? `${line}\n\n${prev}` : line,
              );
            }}
          />

          {state.error ? (
            <p className="mt-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-300">
              {state.error}
            </p>
          ) : null}

          <div className="mt-5 flex items-center justify-end gap-3">
            {isUploading ? (
              <span className="text-xs text-neutral-500">Uploading media…</span>
            ) : null}
            <SubmitButton scheduled={scheduled} disabled={isUploading} />
          </div>
        </div>
      </div>

      <aside className="rounded-2xl border border-black/[.08] bg-white p-5 dark:border-white/[.14] dark:bg-[var(--surface-1)]">
        <h3 className="text-sm font-medium">Accounts to post to</h3>
        <p className="mt-1 text-xs text-neutral-500">
          Select one or more connected accounts for this profile.
        </p>
        <ul className="mt-4 space-y-2">
          {profileAccounts.length === 0 ? (
            <li className="text-sm text-neutral-500">
              No accounts connected for this profile.
            </li>
          ) : (
            profileAccounts.map((a) => {
              const key = `${a.platform}::${a._id}`;
              const username = a.metadata?.profileData?.username;
              const checked = selectedAccounts.has(key);
              return (
                <li key={a._id}>
                  <label className="flex cursor-pointer items-center gap-3 rounded-md border border-black/[.08] p-2.5 transition hover:bg-black/[.03] dark:border-white/[.14] dark:hover:bg-white/[.04]">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleAccount(key)}
                      className="size-4 rounded border-black/20"
                    />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">
                        {a.displayName || username || platformLabel(a.platform)}
                      </p>
                      <div className="mt-0.5 flex items-center gap-2">
                        <PlatformBadge platform={a.platform} />
                      </div>
                    </div>
                  </label>
                </li>
              );
            })
          )}
        </ul>
      </aside>
    </form>
  );
}

function CommentDmSection({
  enabled,
  onEnabledChange,
  keyword,
  onKeywordChange,
  message,
  onMessageChange,
  resource,
  onResourceChange,
  reply,
  onReplyChange,
  capable,
  onInsertCta,
}: {
  enabled: boolean;
  onEnabledChange: (v: boolean) => void;
  keyword: string;
  onKeywordChange: (v: string) => void;
  message: string;
  onMessageChange: (v: string) => void;
  resource: string;
  onResourceChange: (v: string) => void;
  reply: string;
  onReplyChange: (v: string) => void;
  capable: boolean;
  onInsertCta: () => void;
}) {
  const open = enabled && capable;
  return (
    <section
      className={`mt-6 rounded-xl border p-4 ${
        open
          ? "border-teal-500/35 bg-teal-500/[.07]"
          : "border-black/[.08] bg-black/[.015] dark:border-white/[.14] dark:bg-white/[.02]"
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-sm font-medium">Comments to DM</h3>
          <p className="mt-0.5 text-xs leading-relaxed text-neutral-500">
            When someone comments the keyword on this Instagram or Facebook
            post, we reply on the comment, then DM them the text and the
            link. Works on scheduled posts too — the funnel attaches when
            the post goes live. TikTok cannot do this.
          </p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={open}
          aria-label="Enable comments to DM"
          disabled={!capable}
          onClick={() => onEnabledChange(!enabled)}
          className={`relative h-6 w-11 shrink-0 rounded-full transition ${
            capable ? "cursor-pointer" : "cursor-not-allowed opacity-50"
          } ${open ? "bg-teal-500" : "bg-neutral-200 dark:bg-white/[.16]"}`}
        >
          <span
            className={`absolute top-0.5 size-5 rounded-full bg-white shadow-sm transition ${
              open ? "left-[22px]" : "left-0.5"
            }`}
          />
        </button>
      </div>

      {!capable ? (
        <p className="mt-3 text-xs text-neutral-500">
          Select an Instagram or Facebook account on the right to enable this.
        </p>
      ) : null}

      {open ? (
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <div>
            <label htmlFor="comment-dm-keyword" className="block text-xs font-medium">
              Trigger keyword
            </label>
            <input
              id="comment-dm-keyword"
              value={keyword}
              onChange={(e) => onKeywordChange(e.target.value)}
              placeholder="OS"
              autoComplete="off"
              className="mt-1 h-10 w-full rounded-md border border-black/[.12] bg-white px-3 text-sm dark:border-white/[.19] dark:bg-[var(--surface-2)]"
            />
            <p className="mt-1 text-[11px] text-neutral-500">
              Case does not matter (Claude, claude, CLAUDE). Trailing emoji is fine.
            </p>
          </div>
          <div className="sm:col-span-2">
            <label htmlFor="comment-dm-resource" className="block text-xs font-medium">
              Links in the DM
            </label>
            <textarea
              id="comment-dm-resource"
              value={resource}
              onChange={(e) => onResourceChange(e.target.value)}
              rows={3}
              placeholder={"https://github.com/org/repo\nhttps://creatoros.ca"}
              autoComplete="off"
              className="mt-1 w-full resize-y rounded-md border border-black/[.12] bg-white px-3 py-2 text-sm leading-relaxed dark:border-white/[.19] dark:bg-[var(--surface-2)]"
            />
            <p className="mt-1 text-[11px] text-neutral-500">
              Full URLs, <span className="font-mono">/go/slug</span>, or bare
              slugs. One per line. Each one is pasted into the DM text.
            </p>
          </div>
          <div>
            <label htmlFor="comment-dm-reply" className="block text-xs font-medium">
              Public comment reply
            </label>
            <input
              id="comment-dm-reply"
              value={reply}
              onChange={(e) => onReplyChange(e.target.value.slice(0, 220))}
              placeholder="Awesome, check DMs!"
              autoComplete="off"
              className="mt-1 h-10 w-full rounded-md border border-black/[.12] bg-white px-3 text-sm dark:border-white/[.19] dark:bg-[var(--surface-2)]"
            />
            <p className="mt-1 text-[11px] text-neutral-500">
              Posted under their comment before the DM goes out.
            </p>
          </div>
          <div className="sm:col-span-2">
            <div className="flex items-center justify-between gap-2">
              <label htmlFor="comment-dm-text" className="block text-xs font-medium">
                DM text
              </label>
              <span className="text-[11px] tabular-nums text-neutral-400">
                {message.length}/640
              </span>
            </div>
            <textarea
              id="comment-dm-text"
              value={message}
              onChange={(e) => onMessageChange(e.target.value.slice(0, 640))}
              rows={3}
              placeholder="hey, here are the links I mentioned:"
              className="mt-1 w-full resize-y rounded-md border border-black/[.12] bg-white px-3 py-2 text-sm leading-relaxed dark:border-white/[.19] dark:bg-[var(--surface-2)]"
            />
            {resolveResourceUrls(resource).length > 0 ? (
              <p className="mt-2 whitespace-pre-wrap rounded-md border border-black/[.08] bg-black/[.03] px-3 py-2 text-[11px] leading-relaxed text-neutral-600 dark:border-white/[.12] dark:bg-white/[.04] dark:text-neutral-300">
                <span className="font-medium text-neutral-800 dark:text-neutral-100">
                  DM that gets sent
                </span>
                {"\n"}
                {buildDmMessage(keyword, message, resolveResourceUrls(resource))}
              </p>
            ) : null}
          </div>
          <div className="sm:col-span-2">
            <button
              type="button"
              onClick={onInsertCta}
              className="text-xs font-medium text-teal-800 underline-offset-2 hover:underline dark:text-teal-300"
            >
              Add &ldquo;Comment &lsquo;{keyword.trim() || "KEYWORD"}&rsquo;&rdquo; to the
              caption
            </button>
          </div>
        </div>
      ) : null}
    </section>
  );
}

function ReelCoverField({
  cover,
  hasVideo,
  onPick,
  onRemove,
}: {
  cover: Upload | null;
  hasVideo: boolean;
  onPick: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onRemove: () => void;
}) {
  return (
    <div className="mt-5">
      <label className="block text-sm font-medium" htmlFor="reel-cover-input">
        Instagram Reel cover
        <span className="ml-1.5 font-normal text-neutral-500">(optional)</span>
      </label>
      <p className="mt-1 text-xs text-neutral-500">
        JPG or PNG. This is the still Instagram shows in the grid. Leave blank
        to use the first frame
        {hasVideo ? "." : " — add a video first for this to apply."}
      </p>
      <input
        id="reel-cover-input"
        type="file"
        accept="image/jpeg,image/png,image/webp"
        onChange={onPick}
        className="hidden"
      />
      <div className="mt-2 flex items-start gap-3">
        {cover ? (
          <div
            className={`relative w-24 overflow-hidden rounded-lg border bg-neutral-100 dark:bg-[var(--surface-2)] ${
              cover.status === "error"
                ? "border-red-300 dark:border-red-900/60"
                : "border-black/[.08] dark:border-white/[.14]"
            }`}
            style={{ aspectRatio: "9 / 16" }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={cover.previewUrl}
              alt="Reel cover preview"
              className="h-full w-full object-cover"
            />
            {cover.status === "uploading" ? (
              <div className="absolute inset-0 flex items-center justify-center bg-black/40 text-[10px] font-medium text-white">
                Uploading…
              </div>
            ) : null}
            {cover.status === "error" ? (
              <div className="absolute inset-0 flex items-center justify-center bg-red-900/50 px-1 text-center text-[10px] font-medium text-white">
                {cover.error || "Failed"}
              </div>
            ) : null}
            <button
              type="button"
              onClick={onRemove}
              aria-label="Remove Reel cover"
              className="absolute right-1 top-1 grid size-5 place-items-center rounded-full bg-black/60 text-white"
            >
              <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
                <path d="M3 3l6 6M9 3l-6 6" />
              </svg>
            </button>
          </div>
        ) : (
          <label
            htmlFor="reel-cover-input"
            className="flex w-24 cursor-pointer flex-col items-center justify-center rounded-lg border border-dashed border-black/[.18] bg-black/[.015] text-center text-[11px] text-neutral-500 transition hover:border-black/[.3] hover:bg-black/[.03] dark:border-white/[.18] dark:bg-white/[.02] dark:hover:border-white/[.35]"
            style={{ aspectRatio: "9 / 16" }}
          >
            Add cover
          </label>
        )}
        {cover?.status === "error" ? (
          <label
            htmlFor="reel-cover-input"
            className="mt-1 text-xs font-medium text-teal-800 underline-offset-2 hover:underline dark:text-teal-300"
          >
            Try another image
          </label>
        ) : null}
      </div>
    </div>
  );
}

function MediaTile({
  upload,
  onRemove,
}: {
  upload: Upload;
  onRemove: () => void;
}) {
  const { previewUrl, kind, status } = upload;
  return (
    <div
      className={`group relative aspect-square overflow-hidden rounded-lg border bg-neutral-100 dark:bg-[var(--surface-2)] ${
        status === "error"
          ? "border-red-300 dark:border-red-900/60"
          : "border-black/[.08] dark:border-white/[.14]"
      }`}
    >
      {kind === "image" ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={previewUrl} alt="" className="h-full w-full object-cover" />
      ) : kind === "video" ? (
        <video src={previewUrl} muted className="h-full w-full object-cover" />
      ) : (
        <div className="flex h-full w-full items-center justify-center px-2 text-center text-[10px] text-neutral-500">
          {upload.file?.name ?? "file"}
        </div>
      )}

      {status === "uploading" ? (
        <div className="absolute inset-0 flex items-center justify-center bg-black/40 text-[11px] font-medium text-white">
          Uploading…
        </div>
      ) : null}
      {status === "error" ? (
        <div className="absolute inset-0 flex items-center justify-center bg-red-900/50 px-1 text-center text-[10px] font-medium text-white">
          {upload.error || "Failed"}
        </div>
      ) : null}

      {upload.type === "video" ? (
        <span className="absolute bottom-1 left-1 rounded bg-black/60 px-1 text-[9px] font-medium uppercase tracking-wide text-white">
          {kind === "image" ? "GIF→MP4" : "Video"}
        </span>
      ) : null}

      <button
        type="button"
        onClick={onRemove}
        aria-label="Remove"
        className="absolute right-1 top-1 grid size-5 place-items-center rounded-full bg-black/60 text-white opacity-0 transition group-hover:opacity-100"
      >
        <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
          <path d="M3 3l6 6M9 3l-6 6" />
        </svg>
      </button>
    </div>
  );
}
