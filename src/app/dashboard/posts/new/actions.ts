"use server";

import { after } from "next/server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createPost } from "@/lib/zernio/client";
import { fitTwitterCaption, fitThreadsCaption } from "@/lib/twitter-caption";
import {
  flushPendingCommentDmSetups,
  isCommentDmPlatform,
  queueCommentToDm,
  resolveResourceUrls,
} from "@/lib/comments/automations";

export type ComposerState = {
  error?: string;
  message?: string;
};

export async function publishPost(
  _prev: ComposerState,
  formData: FormData,
): Promise<ComposerState> {
  const content = String(formData.get("content") ?? "").trim();
  const profileId = String(formData.get("profileId") ?? "").trim();
  const scheduledFor = String(formData.get("scheduledFor") ?? "").trim();
  const youtubeTitle = String(formData.get("youtubeTitle") ?? "").trim();
  const instagramThumbnail = String(
    formData.get("instagramThumbnail") ?? "",
  ).trim();
  const accountIds = formData.getAll("account").map((v) => String(v));

  const commentDmEnabled = String(formData.get("commentDmEnabled") ?? "") === "1";
  const commentDmKeyword = String(formData.get("commentDmKeyword") ?? "").trim();
  const commentDmText = String(formData.get("commentDmText") ?? "").trim();
  const commentDmResourceRaw = String(
    formData.get("commentDmResource") ?? "",
  ).trim();
  const commentDmReply = String(formData.get("commentDmReply") ?? "").trim();

  // Media arrives as already-uploaded "type::url" strings (via /api/upload).
  const mediaItems = formData
    .getAll("media")
    .map((v) => String(v))
    .map((s) => {
      const i = s.indexOf("::");
      const type = s.slice(0, i) === "video" ? "video" : "image";
      const item: {
        type: "image" | "video";
        url: string;
        instagramThumbnail?: string;
      } = { type, url: s.slice(i + 2) };
      return item;
    })
    .filter((m) => m.url);

  if (instagramThumbnail && !/^https?:\/\//i.test(instagramThumbnail)) {
    return { error: "The Instagram Reel cover did not upload. Try the image again." };
  }

  if (!content && mediaItems.length === 0)
    return { error: "Add a caption or at least one media file." };
  if (!profileId) return { error: "Pick a profile." };
  if (accountIds.length === 0) return { error: "Pick at least one account." };

  const wantsYoutube = accountIds.some(
    (id) => id.split("::")[0]?.toLowerCase() === "youtube",
  );
  if (wantsYoutube && !youtubeTitle) {
    return {
      error:
        "Add a YouTube title. Shorts use the title plus the caption as the description.",
    };
  }
  if (youtubeTitle.length > 100) {
    return { error: "Keep the YouTube title under 100 characters." };
  }

  const hasVideo = mediaItems.some((m) => m.type === "video");
  const igCover =
    instagramThumbnail && hasVideo ? instagramThumbnail : "";
  if (igCover) {
    const firstVideo = mediaItems.find((m) => m.type === "video");
    if (firstVideo) firstVideo.instagramThumbnail = igCover;
  }
  const platforms = accountIds.map((id) => {
    const [platform, accountId] = id.split("::");
    const entry: {
      platform: string;
      accountId: string;
      profileId: string;
      platformSpecificData?: Record<string, unknown>;
      customContent?: string;
    } = { platform, accountId, profileId };
    const plat = platform.toLowerCase();
    if (plat === "youtube") {
      entry.platformSpecificData = {
        title: youtubeTitle,
        visibility: "public",
        ...(hasVideo ? { shorts: true } : {}),
      };
    }
    if (plat === "instagram" && igCover) {
      entry.platformSpecificData = {
        instagramThumbnail: igCover,
        thumbnailUrl: igCover,
      };
    }
    if (plat === "twitter" || plat === "x") {
      entry.customContent = fitTwitterCaption(content);
    }
    if (plat === "threads") {
      entry.customContent = fitThreadsCaption(content);
    }
    return entry;
  });

  let resourceUrl: string | null = null;
  if (commentDmEnabled) {
    if (!platforms.some((p) => isCommentDmPlatform(p.platform))) {
      return {
        error:
          "Comments-to-DM only works on Instagram and Facebook. Select one of those accounts, or turn the workflow off.",
      };
    }
    if (!commentDmKeyword) {
      return { error: "Add the keyword that should trigger comments-to-DM." };
    }
    if (commentDmKeyword.length > 40) {
      return { error: "Keep the comments-to-DM keyword under 40 characters." };
    }
    if (!commentDmText) {
      return { error: "Add the DM text to send when someone comments the keyword." };
    }
    if (commentDmText.length > 640) {
      return { error: "Keep the DM text under 640 characters." };
    }
    const resourceUrls = resolveResourceUrls(commentDmResourceRaw);
    resourceUrl = resourceUrls.join("\n");
    if (!resourceUrl) {
      return {
        error:
          "Add the link(s) to send in the DM — full URLs, /go/slugs, or bare slugs like comment-dm. One per line is fine.",
      };
    }
  }

  const result = await createPost({
    content,
    platforms,
    mediaItems: mediaItems.length ? mediaItems : undefined,
    ...(youtubeTitle ? { title: youtubeTitle } : {}),
    ...(scheduledFor
      ? { scheduledFor: new Date(scheduledFor).toISOString() }
      : { publishNow: true }),
  });

  if (!result.ok) return { error: result.error };

  let commentDmQuery = "";
  if (commentDmEnabled && resourceUrl) {
    if (!result.post) {
      commentDmQuery = "?commentDm=error";
    } else {
      let outcome: Awaited<ReturnType<typeof queueCommentToDm>>;
      try {
        outcome = await queueCommentToDm({
          post: result.post,
          platforms,
          keyword: commentDmKeyword,
          dmMessage: commentDmText,
          resourceUrl,
          commentReply: commentDmReply,
          scheduledFor: scheduledFor
            ? new Date(scheduledFor).toISOString()
            : null,
        });
      } catch (e) {
        console.error(
          "[comment-dm] queue failed:",
          e instanceof Error ? e.message : e,
        );
        outcome = {
          status: "error",
          wired: 0,
          pending: 0,
          failed: 1,
          error: e instanceof Error ? e.message : "queue failed",
        };
      }
      commentDmQuery = `?commentDm=${outcome.status}`;
      // Immediate publish can lag a few seconds on platformPostId. Scheduled
      // posts wait until they go live — polling here would just spin.
      if (outcome.status !== "wired" && !scheduledFor) {
        const zernioPostId = result.post._id;
        after(async () => {
          for (let i = 0; i < 8; i++) {
            await new Promise((r) => setTimeout(r, 4000));
            try {
              await flushPendingCommentDmSetups({ postId: zernioPostId });
            } catch (e) {
              console.error(
                "[comment-dm] flush after publish:",
                e instanceof Error ? e.message : e,
              );
            }
          }
        });
      }
    }
  }

  revalidatePath("/dashboard/posts");
  revalidatePath("/dashboard");
  redirect(`/dashboard/posts${commentDmQuery}`);
}
