---
name: copywriter-shortform-kevin
description: Write short-form video scripts (Instagram Reels / TikTok / Shorts, 35 to 60 seconds) in Kevin's (@kevbuildsapps) voice - his hooks, body flow, comment-word CTAs, pacing and word count, modeled from his 14 most recent reels (Sep 2026). Use when Kevin, the Copywriter page, or any automation needs a talking-head script "in my style" for a tool, workflow, build update, or open-source drop.
---

# Kevin short-form script voice (@kevbuildsapps)

Style model built 2026-09-14 from the 14 most recent reels with speech
(`references/transcripts.md` has every transcript + stats, `references/style.json`
the numbers). Rebuild after new posts:

```bash
node --env-file=.env.local scripts/copywriter-ingest-profile.mjs kevbuildsapps 20
node --env-file=.env.local scripts/copywriter-build-style.mjs kevbuildsapps-style copywriter-shortform-kevin
```

## The numbers (hard targets)

| | target | range seen |
|---|---|---|
| Duration | **40 to 45 s** | 37 to 61 s (one 89 s listicle) |
| Words | **140 to 170** | 129 to 221 (317 for the 89 s) |
| Speaking pace | **~215 wpm** | 190 to 232 |
| Sentences | **7 to 10** | 6 to 13 |
| Words per sentence | **~20** (long, run-on spoken sentences) | |
| Hook | **first 2 sentences, ~30 to 40 words**, finished inside 8 s | |
| CTA | **last 1 to 2 sentences**, starts at ~83% of the script | |
| Comment word | in **10 of 14** videos | |

Write ~155 words for a 43 s read. Every 20 words is ~5.5 s on screen.

## Who is talking

Kevin: builds AI agents, automations, iPhone farms, knowledge graphs (Obsidian),
open-source tools, for creators and agencies. First person, present tense,
talking to camera. He shows what he built this week, not theory. He names the
real tool (Claude Code, Humanizer, 21st Dev MCP, Obsidian, Markitdown, Mac
mini, iOS farm, Zernio) and the real number (100 iPhones, 15 per Mac mini,
10,000 UI designs, 33 telltale signs, top 100 trending, 30 seconds).

## Hook patterns (pick one, do not blend)

1. **"So" + what I just built + the claim.** Most common opener (5/14 start with "So").
   "So after building an iPhone farm for the past week, I have two reasons why this is probably gonna be very game-changing..."
2. **"All right" hype open + free app.** Highest engagement (245 and 59 likes).
   "All right, you guys gotta check this out. So I built this free app that basically lets this Mac mini run 100 iPhones at the same time."
   "All right, so this is pretty freaking wild. Over the past week, I've been working on this free app that..."
3. **Contrarian / group-secret.** "I seriously feel like there's just a group of us that know how to use AI to learn things 100 times faster."
   "I think the reason why people are not as excited as building these custom knowledge graphs... is because people are using them for knowledge and not for agentic workflows."
4. **Stat or absolute first.** "99% of the software that I build is based on the backbone of someone else's project. And that's the beauty of open source."
5. **Concede then pivot.** "Now, GPT Astra is obviously absolutely amazing, but if your agent is still pumping out the same generic slop as everyone else, then you have no competitive advantage. Here's four free plugins that I use to actually fix that."
6. **Weird claim + "Let me explain."** "So it turns out if you give your coding agents a little bit of ADHD... it actually works a lot better. Let me explain."
7. **Point at the screen.** "You see on the screen is a knowledge graph for my AI agent that runs my entire business. And this used to be hard to make."
8. **"Man, I used to not care about X until..."** (the China robots one).

Hook rules: the second sentence always sets up the promise ("Here's four free
plugins", "I want to show you the six workflows", "in this video I'm gonna
show you just how easy it is"). Never a question hook. Never "In this video I
will". The word **free** appears in the hook whenever the thing is free.

## Body flow (sentences 3 to 8)

- **Listicle walk**: "So the first one's called X, and it's ... The next one's called Y. Now this one's specifically for ... The third and my favorite here is Z." (plugins, six workflows, five second brains). Each item = name it, one line on what it does, one concrete outcome or number.
- **Build update**: "So in my previous video I spoke about ... But the power of X is ... And so that's what we now have inside of the codebase, you can now ..." (farm update).
- **Live demo narration**: "The first workflow is actually running right now and it's called ... And as we can see right here, it's literally about to fire off as we're speaking." (100 iPhones).
- **Why it matters aside**: one sentence of opinion mid-body. "And I honestly think that the reason why the entire world is not excited about open source projects is literally because they're not hearing about it."

Body rules: plain spoken English, run-on "and so / and then / but" chaining,
present tense. One idea per sentence. Zero fluff transitions ("without
further ado", "let's dive in" never appear). No summaries, no recap.

## CTA (locked)

Shape: **"If you want [the thing], just comment [WORD] and I'll [send it over / shoot it over] [in the DMs]."**

Real ones:
- "If you want all three, just comment plugins and I'll send you the links in the DMs."
- "If you guys want this entire iOS agents code base, just comment iOS and I'll send it over."
- "You guys want the iOS farm code base? Just comment farm and I'll shoot it over along with the tutorial."
- "If you wanna try it out yourself, just comment ADHD and I'll send over the free GitHub repo."
- "Just comment open source and I'll send it over."

Rules: one word, lowercase in speech, ALL CAPS on screen; the word is the
topic noun (farm, iOS, plugins, obsidian, ADHD, China, build, brain). What gets
sent = codebase / repo / links / tutorial / list. Never "link in bio", never
"follow for more", never "like and subscribe". The CTA is the last thing said.

## Vocabulary and tics (use, do not overuse)

"basically", "literally", "pretty freaking wild", "you guys", "gotta check
this out", "at the same time", "at scale", "the freaking game", "shoot it
over", "send it over", "codebase", "workflow", "agent", "farm", "free",
"open source", "this week / last night / over the past week". Numbers are
spoken as digits. Tool names are said in full the first time.

Never: em dashes, emoji, "delve", "game-changer" as a noun (he says
"game-changing"), "unlock", "revolutionize", "in today's world", hashtags in
the spoken script, questions to the audience except the CTA "You guys want X?".

## Output format

Return ONLY the spoken script as one paragraph (no headings, no stage
directions) plus one line: `Comment word: WORD`. Then a `Caption:` block in
Kevin's caption style: lowercase-ish, 2 to 4 short lines restating the hook +
the comment word in quotes, 4 to 6 hashtags (#aitools #aiagents #vibecoding
#contentcreator #creatortools style). See captions in `references/transcripts.md`.

## Self-check before returning

1. Word count 140 to 170 (unless a listicle was explicitly asked for).
2. Hook done by sentence 2, promise stated, real tool + real number present.
3. Body names 2 to 6 concrete things, each with what it does.
4. CTA is the exact locked shape, one comment word, last sentence.
5. Read it aloud at 215 wpm: 40 to 45 s.
6. No banned words, no em dashes.
