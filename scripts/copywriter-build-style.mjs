#!/usr/bin/env node
// Build a style model from copywriter_sources rows for a given tag.
// Writes references/{transcripts.md,style.json} under the skill dir.
//
//   node --env-file=.env.local scripts/copywriter-build-style.mjs <tag> [skill-dir]
//
// Examples:
//   node --env-file=.env.local scripts/copywriter-build-style.mjs kevbuildsapps-style copywriter-shortform-kevin
//   node --env-file=.env.local scripts/copywriter-build-style.mjs kevbuildsapps-yt-style copywriter-longform-kevin
//
// Backward compat (handle only → "<handle>-style" + copywriter-shortform-<kevin|handle>):
//   node --env-file=.env.local scripts/copywriter-build-style.mjs kevbuildsapps
import fs from "node:fs";
import path from "node:path";
import { Pool } from "pg";

function parseArgs(argv) {
  const a = argv.filter(Boolean);
  if (!a.length) return { tag: "kevbuildsapps-style", skillDir: "copywriter-shortform-kevin", handle: "kevbuildsapps" };
  const first = a[0];
  const looksLikeTag = first.includes("-style");
  if (!looksLikeTag && a.length === 1) {
    const handle = first.replace(/^@/, "").toLowerCase();
    return {
      tag: `${handle}-style`,
      skillDir: `copywriter-shortform-${handle === "kevbuildsapps" ? "kevin" : handle}`,
      handle,
    };
  }
  const tag = first;
  const handle = tag.replace(/-yt-style$/, "").replace(/-style$/, "");
  const skillDir = a[1] || (tag.endsWith("-yt-style")
    ? `copywriter-longform-${handle === "kevbuildsapps" ? "kevin" : handle}`
    : `copywriter-shortform-${handle === "kevbuildsapps" ? "kevin" : handle}`);
  return { tag, skillDir, handle };
}

const { tag, skillDir, handle } = parseArgs(process.argv.slice(2));
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const OUT = path.join(".claude/skills", skillDir, "references");
fs.mkdirSync(OUT, { recursive: true });

const sentences = (t) => t.replace(/\s+/g, " ").match(/[^.!?]+[.!?]+|[^.!?]+$/g)?.map((s) => s.trim()).filter(Boolean) ?? [];
const words = (t) => t.split(/\s+/).filter(Boolean);
const CTA_RE = /\b(just comment|comment the word|like and subscribe|please (like|subscribe)|if you haven't subscribed|link in (the )?(bio|description)|join (the |my )?(no.?code )?academy|book a (call|one-on-one)|i'll see you (guys )?in the next|shout out to .{0,40}sponsor)\b/i;
const INTRO_PROMISE_RE = /\b(in this video|today i('m| am) going to|i('m| am) going to show you|i got something|let me (show|explain|walk)|here('s| is) how)\b/i;
const SECTION_RE = /\b(so (the )?(first|second|third|next|last)|number (one|two|three|1|2|3)|step (one|two|three|1|2|3)|now (the|this)|the next (one|thing|tool|step))\b/i;

function titlePattern(title) {
  const t = title || "";
  if (/^I Built/i.test(t)) return "I Built…";
  if (/^I Turned/i.test(t)) return "I Turned…";
  if (/^This /i.test(t)) return "This X…";
  if (/^These /i.test(t)) return "These N…";
  if (/^My /i.test(t)) return "My … workflow";
  if (/\+/.test(t) && /=/.test(t)) return "X + Y = Z";
  if (/Has Finally Arrived/i.test(t)) return "X Has Finally Arrived";
  if (/Changes Everything/i.test(t)) return "X Changes Everything";
  return "other";
}

function titleSuffix(title) {
  const m = (title || "").match(/\(([^)]+)\)\s*$/);
  return m ? m[1] : null;
}

const { rows } = await pool.query(
  `select url, transcript, caption, hook3s, duration_sec, like_count, comment_count, view_count,
          posted_at, title, topic, summary, hook, key_points, format, cta
     from copywriter_sources where tag = $1 and status = 'done' and coalesce(transcript,'') <> ''
     order by posted_at desc nulls last, created_at desc`,
  [tag],
);
if (!rows.length) throw new Error(`no rows tagged ${tag}`);

const vids = rows.map((r) => {
  const t = r.transcript.trim();
  const ss = sentences(t);
  const w = words(t);
  const dur = r.duration_sec == null ? null : Number(r.duration_sec);
  const ctaIdx = (() => {
    let last = -1;
    ss.forEach((s, i) => { if (CTA_RE.test(s)) last = i; });
    return last;
  })();
  const ctaSentences = ss.filter((s) => CTA_RE.test(s));
  const commentWord = t.match(/comment\s+(?:the\s+word\s+)?["“]?([A-Za-z0-9-]+)["”]?/i)?.[1] ?? null;
  const firstTwo = ss.slice(0, 2).join(" ");
  const promiseIdx = ss.findIndex((s) => INTRO_PROMISE_RE.test(s));
  const introEnd = promiseIdx >= 0 ? Math.min(ss.length, Math.max(promiseIdx + 1, 2)) : Math.min(ss.length, 3);
  const intro = ss.slice(0, introEnd);
  const introText = intro.join(" ");
  const bodyStart = ss.length ? Math.min(introEnd, ss.length - 1) : 0;
  const body = ss.slice(bodyStart, ctaIdx > 0 ? ctaIdx : undefined);
  const sectionHits = ss.filter((s) => SECTION_RE.test(s)).length;
  const keyPoints = Array.isArray(r.key_points) ? r.key_points : [];
  const title = r.title || "";
  return {
    url: r.url,
    title,
    postedAt: r.posted_at,
    durationSec: dur,
    words: w.length,
    wpm: dur ? Math.round((w.length / dur) * 60) : null,
    sentences: ss.length,
    avgSentenceWords: ss.length ? Math.round(w.length / ss.length) : 0,
    hook: firstTwo,
    hookWords: words(firstTwo).length,
    intro: introText,
    introSentences: intro.length,
    introWords: words(introText).length,
    introPct: w.length ? Math.round((words(introText).length / w.length) * 100) : null,
    ctaSentences,
    ctaPositionPct: ctaIdx >= 0 && ss.length ? Math.round((ctaIdx / ss.length) * 100) : null,
    commentWord,
    bodySentences: body.length,
    sectionHits,
    sectionCount: keyPoints.length || sectionHits,
    likes: r.like_count, comments: r.comment_count, views: r.view_count,
    topic: r.topic, format: r.format, llmHook: r.hook, llmCta: r.cta,
    keyPoints,
    caption: r.caption,
    transcript: t,
    titlePattern: titlePattern(title),
    titleSuffix: titleSuffix(title),
  };
});

const num = (a) => a.filter((x) => typeof x === "number" && Number.isFinite(x));
const mean = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0);
const median = (a) => { const b = [...a].sort((x, y) => x - y); return b.length ? b[Math.floor(b.length / 2)] : 0; };
const freq = (arr) => { const m = new Map(); for (const x of arr) m.set(x, (m.get(x) || 0) + 1); return [...m.entries()].sort((a, b) => b[1] - a[1]); };

const STOP = new Set("the a an and or to of in on for with is it this that you your i my me we our it's i'm so but if then just can be do does have has are was at as by from not no its about into out up one all more than what how there here they them their will would use using".split(" "));
const allWords = vids.flatMap((v) => words(v.transcript.toLowerCase().replace(/[^a-z0-9'\s-]/g, "")));
const topWords = freq(allWords.filter((w) => !STOP.has(w) && w.length > 2)).slice(0, 40);
const openers = freq(vids.map((v) => words(v.hook)[0]?.toLowerCase() ?? "")).slice(0, 10);
const ctaWords = freq(vids.map((v) => v.commentWord?.toUpperCase()).filter(Boolean));
const durations = num(vids.map((v) => v.durationSec));
const wpm = num(vids.map((v) => v.wpm));
const wc = vids.map((v) => v.words);
const introW = vids.map((v) => v.introWords);
const introPct = num(vids.map((v) => v.introPct));
const sections = vids.map((v) => v.sectionCount);
const longform = tag.endsWith("-yt-style") || mean(durations) > 180;

const style = {
  handle, tag, skillDir, sampleSize: vids.length, builtAt: new Date().toISOString(),
  duration: durations.length
    ? { meanSec: Math.round(mean(durations)), medianSec: Math.round(median(durations)), minSec: Math.min(...durations), maxSec: Math.max(...durations) }
    : null,
  words: { mean: Math.round(mean(wc)), median: Math.round(median(wc)), min: Math.min(...wc), max: Math.max(...wc) },
  wpm: wpm.length ? { mean: Math.round(mean(wpm)), median: Math.round(median(wpm)) } : null,
  sentences: { meanPerVideo: Math.round(mean(vids.map((v) => v.sentences))), meanWordsPerSentence: Math.round(mean(vids.map((v) => v.avgSentenceWords))) },
  hook: { meanWords: Math.round(mean(vids.map((v) => v.hookWords))), openers, examples: vids.map((v) => v.hook) },
  intro: {
    meanSentences: Math.round(mean(vids.map((v) => v.introSentences))),
    meanWords: Math.round(mean(introW)),
    medianWords: Math.round(median(introW)),
    meanPctOfScript: Math.round(mean(introPct)),
    examples: vids.map((v) => ({ title: v.title, words: v.introWords, pct: v.introPct, text: v.intro })),
  },
  sections: {
    mean: Math.round(mean(sections) * 10) / 10,
    median: median(sections),
    min: Math.min(...sections),
    max: Math.max(...sections),
    fromKeyPoints: true,
  },
  titles: {
    patterns: freq(vids.map((v) => v.titlePattern)),
    suffixes: freq(vids.map((v) => v.titleSuffix).filter(Boolean)),
    examples: vids.map((v) => v.title).filter(Boolean),
  },
  cta: {
    withCommentWord: vids.filter((v) => v.commentWord).length,
    commentWords: ctaWords,
    positionPct: Math.round(mean(num(vids.map((v) => v.ctaPositionPct)))),
    placement: longform ? "end-of-video plus description link / like-subscribe; comment-word rare" : "last 1-2 sentences",
    examples: vids.flatMap((v) => v.ctaSentences).slice(0, 30),
    llmCtas: vids.map((v) => v.llmCta).filter(Boolean).slice(0, 20),
  },
  formats: freq(vids.map((v) => v.format).filter(Boolean)),
  topWords,
  performance: vids.map((v) => ({ url: v.url, title: v.title, views: v.views, likes: v.likes, comments: v.comments, durationSec: v.durationSec, words: v.words, topic: v.topic, sections: v.sectionCount })),
};
fs.writeFileSync(path.join(OUT, "style.json"), JSON.stringify(style, null, 2));

const kind = longform ? "long-form YouTube videos" : "reels";
const md = [`# @${handle} — ${vids.length} ${kind} (transcripts + stats)\n`, `Tag \`${tag}\`. Built ${style.builtAt.slice(0, 10)} from ${vids.length} videos.\n`];
for (const [i, v] of vids.entries()) {
  md.push(`## ${i + 1}. ${v.title || v.topic || "(untitled)"}\n`);
  md.push(`- ${v.url}`);
  const posted = v.postedAt ? String(v.postedAt).slice(0, 10) : "?";
  const dur = v.durationSec == null ? "?" : (v.durationSec >= 60 ? `${Math.floor(v.durationSec / 60)}:${String(Math.round(v.durationSec % 60)).padStart(2, "0")}` : `${v.durationSec}s`);
  md.push(`- posted ${posted} · ${dur} · ${v.words} words · ${v.wpm ?? "?"} wpm · ${v.sentences} sentences · likes ${v.likes ?? "?"} · comments ${v.comments ?? "?"}`);
  md.push(`- format: ${v.format || "?"}`);
  if (v.title) md.push(`- title pattern: ${v.titlePattern}${v.titleSuffix ? ` · suffix: (${v.titleSuffix})` : ""}`);
  md.push(`- hook: ${v.hook}`);
  md.push(`- intro (${v.introSentences} sentences, ${v.introWords} words, ${v.introPct}%): ${v.intro}`);
  md.push(`- cta: ${v.ctaSentences.join(" | ") || "(none)"}${v.commentWord ? ` · comment word: ${v.commentWord.toUpperCase()}` : ""}`);
  if (v.keyPoints.length) md.push(`- sections (${v.sectionCount}): ${v.keyPoints.join(" / ")}`);
  md.push(`\n### Transcript\n\n${v.transcript}\n`);
  if (v.caption) md.push(`### Caption / description\n\n${v.caption.replace(/\n{3,}/g, "\n\n")}\n`);
}
fs.writeFileSync(path.join(OUT, "transcripts.md"), md.join("\n"));

const summary = {
  tag, skillDir, out: OUT, sampleSize: vids.length,
  duration: style.duration, words: style.words, wpm: style.wpm,
  intro: { meanWords: style.intro.meanWords, medianWords: style.intro.medianWords, meanPctOfScript: style.intro.meanPctOfScript },
  sections: style.sections,
  titles: { patterns: style.titles.patterns, suffixes: style.titles.suffixes },
  hook: { meanWords: style.hook.meanWords, openers: style.hook.openers },
  cta: { withCommentWord: style.cta.withCommentWord, positionPct: style.cta.positionPct },
  formats: style.formats,
  topWords: style.topWords.slice(0, 20),
};
console.log(JSON.stringify(summary, null, 2));
console.log("\nTITLES:\n" + vids.map((v, i) => `${i + 1}. ${v.title || v.topic}`).join("\n"));
console.log("\nHOOKS:\n" + style.hook.examples.map((h, i) => `${i + 1}. ${h}`).join("\n"));
console.log("\nINTROS:\n" + style.intro.examples.map((h, i) => `${i + 1}. [${h.words}w / ${h.pct}%] ${h.text}`).join("\n"));
console.log("\nCTAs:\n" + (style.cta.examples.length ? style.cta.examples.map((h, i) => `${i + 1}. ${h}`).join("\n") : style.cta.llmCtas.map((h, i) => `${i + 1}. ${h}`).join("\n")));
await pool.end();
