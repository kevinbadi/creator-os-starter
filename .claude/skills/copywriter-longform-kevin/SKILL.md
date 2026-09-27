---
name: copywriter-longform-kevin
description: Write long-form YouTube scripts (8 to 20 minutes) in Kevin's (@KevBuildsApps) voice - greeting hooks, recap intros, chapter maps, live-demo walkthroughs, listicle breakdowns, and academy/subscribe CTAs, modeled from his 20 most recent long-form videos (Apr to Aug 2026). Use when Kevin, the Copywriter page, or any automation needs a YouTube tutorial / breakdown / reaction script "in my style" for a tool setup, build update, or news take.
---

# Kevin long-form YouTube voice (@KevBuildsApps)

Style model built 2026-09-14 from the 20 most recent long-form videos with
captions (`references/transcripts.md` has every transcript + stats,
`references/style.json` the numbers). Rebuild after new uploads:

```bash
node --env-file=.env.local scripts/copywriter-ingest-youtube.mjs https://www.youtube.com/@KevBuildsApps 20
node --env-file=.env.local scripts/copywriter-build-style.mjs kevbuildsapps-yt-style copywriter-longform-kevin
```

Short-form (Reels / TikTok) is a different skill: `copywriter-shortform-kevin`.
Do not mix them. YouTube never uses a comment-word CTA.

## The numbers (hard targets)

| | target | range seen |
|---|---|---|
| Duration | **10 to 12 min** | 5:34 to 24:31 (median 11:30) |
| Words | **2000 to 2500** | 1156 to 4524 (median 2316) |
| Speaking pace | **~200 wpm** | 188 to 207 |
| Sentences | **90 to 140** | mean 134 |
| Words per sentence | **~20** (same run-on spoken sentences as the reels) | |
| Hook | **first 1 to 2 sentences, ~20 to 40 words** | mean 28 |
| Intro | **90 to 180 words, ~6% of the script**, ends at the promise | median 134 words |
| Sections | **7 to 9** (from the chapter / key-point map) | 7 to 9 |
| CTA | **subscribe mid-intro AND academy + next-video at the end** | 0 of 20 used a comment word |

Write ~2300 words for an 11:30 read. Every 200 words is ~1 minute on screen.
A tight "Full Setup" can land at 1100 to 1400 words / 6 to 8 min. A deep
walkthrough (Obsidian, marketing team, trader) can run 3500 to 4500 / 18 to 24
min. Match the brief; default to the 10 to 12 min band.

## Who is talking

Kevin: builds AI agents, automations, iPhone farms, knowledge graphs (Obsidian),
open-source tools, and mobile apps (Creator OS) for creators and agencies.
First person, present tense, talking to camera while the screen does the work.
He shows what he built this week (or last night), names the real tool (Claude
Code, DeepSeek V4 Flash, Ollama, Obsidian, OpenClaw, Playwright, FFmpeg,
Remotion, Whisper, Builder.io Agent Native) and the real number (35 times
cheaper, 150 people cloned the repo, 10 years of video, 600,000 views, $20/month
vs $200). He teaches setups so the viewer can copy them.

## Title patterns (pick one, keep the parenthetical)

Almost every title has a suffix in parentheses. 7 of 20 end in `(Full Setup)`.

1. **"This X…"** "This New AI Coding Framework Changed Software Forever (AGENT NATIVE)"
   "This Claude + threads automation makes $5000/month on autopilot, here's how (FREE CLAUDE SKILL)"
2. **"I Built…"** "I Built & Open-Sourced a $1M AI Video Editor, (HYPER EDIT V3)"
   "I Built an ENTIRE Marketing Team With Claude Code + Supercomputer, Here's How"
3. **"X + Y = Z (Full Setup)"** "Claude Code + DeepSeek v4 Flash = Free Claude Code (Full Setup)"
   "OpenClaw + Blender = Designer AGI (Full Setup)"
4. **"I Turned X Into Y"** "I Turned Claude Fable Into the Ultimate AI Operating System"
5. **"These N … here's how"** / **"N Free … (W Proof)"**
6. **News / hot take.** "Claude MYTHOS Has Finally Arrived." / "Anthropic's New Claude Mythos Changes Everything (Really BAD)"

Title rules: name the tool, stack a claim or dollar figure, ALL CAPS the
product or "Full Setup" in the parens. Never a question title. Never
"Ultimate Guide to".

## Hook patterns (pick one, do not blend)

12 of 20 open with **"What's going on"**.

1. **"What's going on guys? Kev here."** Default. Variants: "It's your boy Kev."
   "What's going on you absolute legend? It's your boy Kev here."
2. **Greeting + point at the screen.** "What's going on, guys? So, what you're seeing on the screen is the entire brain behind one of my businesses called Creator OS..."
   "What's going on, guys? So, what you're seeing on the screen is this new tool called Obsidian..."
3. **Company roast / callout.** "Anthropic, Anthropic, Anthropic, you done goofed up."
   "Anthropic, you guys need to seek deeply because DeepSeek is coming for you."
4. **Imagine cold-open** (skip the greeting). "Imagine a superpowered AI agent that runs 100% privately on your computer."
5. **"Wow" news dump.** "Wow, wow, wow, wow. So, just yesterday I spoke about how Google just changed the entire AI space..."
6. **"What the heck is happening in AI right now?"** then a year-of-leaps recap into today's drop.
7. **Self-deprecating this-week.** "Guys, sorry if I look a little bit homeless right now, but over the past week I've been playing around with Claude Opus 4.7..."
8. **Results flex after the greeting.** "This marketing automation in the month of July generated 600,000 views, 1,500 followers, and over 500 app downloads..."

Hook rules: never a question-to-the-audience hook except the rare "What the heck
is happening". Never "In this video I will". The promise lands a few sentences
later as **"And in this video, I'm going to show you..."** (he often says it
twice). The word **free** appears in the hook or title whenever the thing is
free. Correct Whisper-isms when quoting (OpenClaw not Open Claw, Ollama not
Olama, agentic not "a gentic", Kev not Kyle).

## Intro (sentences 3 to ~10, 90 to 180 words)

Two shapes. Do not blend.

- **Tight promise** (newer / shorter videos): greeting, one why-it-matters
  claim, name the tool, "in this video I'm going to show you exactly how",
  optional "if you're new here, my name's Kev... No-Code Academy", then
  "Let's dive right in."
- **Recap then promise** (series updates, 150 to 250 words): previous video on
  this channel, what V2 did, a clone/count number, today's V3 drop, then the
  same promise line.

Always include: why this is happening **now** (last night, this week, just
dropped), one concrete number, the tool said in full, and a **chapter map**
("This video is going to go through two chapters" / "five chapters. First...
From there... Then we're going to go step by step").

Land with **"Let's dive right in."** / **"Let's get right into it, baby."**
He also drops **"If you're new here, like and subscribe"** right before the
dive, not only at the end.

## Body flow (the 7 to 9 sections)

- **Chaptered breakdown, then setup.** Facts first (benchmarks, cost, speed),
  then "step one, guys, is we want to head over to ollama.com". (DeepSeek,
  Ollama, Gemma). Each chapter = claim + number on screen + "this is freaking
  nuts" aside.
- **Listicle with live proof.** "Starting off with the first tool... Number two
  is called OpenCV. Let me show you what it's about and let me show you the
  example." Each item = name it, what it does, one real workflow from his
  business, optional "tutorial linked in the description".
- **Timed live build.** "To make things fun, let's put a 5-minute timer up on
  the screen and let's try and bang out this entire build." Copy, paste, hit
  enter, "Awesome. So now..."
- **Concept, then clone-and-build.** What it is, why companies pay thousands,
  then "step one, guys, you want to find the link in the description... hit
  clone repo." (Obsidian ingestion).
- **Reaction over an announcement.** Play the clip, talk over it ("You don't
  say."), then his take, then "I want to hear what you guys think."

Body rules: narrate the screen in present tense ("what you're seeing on the
screen", "I'm going to copy that", "hit enter"). Plain spoken English, run-on
"and so / and then / but" chaining. One idea per sentence. He **does** say
"let's dive right in" (long-form only). Skip "without further ado" unless it
is a listicle. No recap of the whole video at the end.

## CTA (YouTube, not Instagram)

Mid-video (after the intro, before the dive):
**"If you're new here, like and subscribe. Let's dive right in."**

End shape: **tease the next video + academy or repo + "I'll see you guys in
the next one."**

Real ones:
- "And like a good Christopher Nolan movie, this video has more to it than it seems because I'm going to be turning what you just saw into a mobile app, and that's going to be in the next video. And all of my mobile apps I give away to my academy on Skool called Kev's No-Code Academy... Shout out to Builder.io for sponsoring this video. I'll see you guys in the next one."
- "Hope this helped. See you guys in the next one."
- "On top of that, guys, if you want one-on-one help... join the No-Code Academy or booking a call with me. Like and subscribe, and let's get right into it."
- "I want to hear what you guys think. Wild times, guys. So let me hear your thoughts and I'll see you in the next one."

Rules: never "just comment WORD". Never "link in bio". The GitHub / Ollama /
Obsidian links live in the **description**, spoken as "link in the description
down below". Academy is Skool (Kev's No-Code Academy) or a 1-on-1 call.
Sponsor shoutout only when there is a sponsor.

## Vocabulary and tics (use, do not overuse)

"what's going on guys", "Kev here", "you guys", "pretty freaking",
"absolutely nuts" / "freaking nuts", "this is absolutely insane, okay?",
"where it gets crazier", "game-changing", "bang it out", "this puppy",
"vibe coding", "dangerously skip permissions", "open-sourced", "literally",
"basically", "at the same time", "right?" as a tag, "what you're seeing on
the screen", "let's dive right in", "I'll see you guys in the next one".
Numbers are spoken as digits. Tool names in full the first time.

Never: em dashes, emoji, "delve", "unlock", "revolutionize", "in today's
world", hashtags in the spoken script, Instagram comment-word CTAs.

Captions mishear constantly. When quoting or writing, use the real names:
Claude Code, Anthropic, GPT Astra, slop, OpenClaw, Ollama, agentic, DeepSeek,
Make.com.

## Output format

Return ALL of:

1. `Title:` one line, matching a title pattern above, with a parenthetical
   suffix.
2. The spoken script as continuous speech. Line-break at chapter turns
   (after the intro dive, each numbered tool / step, and the outro). No
   headings, no stage directions, no timestamps in the script body.
3. `Description:` 2 to 4 short lines restating the hook, then a links block
   (repo, tool, academy, 1-on-1), then `what to watch next`, then a
   `Chapters` list with estimated timestamps.

## Self-check before returning

1. Word count matches the requested band (default 2000 to 2500).
2. Hook done by sentence 2. Promise said as "in this video I'm going to show you".
3. Intro is 90 to 180 words and includes a chapter map of 7 to 9 beats.
4. Body names real tools and real numbers. Screen is narrated, not summarized.
5. CTA is subscribe + description link / academy / next video. Zero comment words.
6. Read it aloud at 200 wpm: 10 to 12 min unless a shorter Full Setup was asked.
7. No banned words, no em dashes, Whisper-isms corrected.
