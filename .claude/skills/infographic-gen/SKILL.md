# infographic-gen

Infographic and newspaper-style news post pipeline for {{PERSONA_NAME}} — generates 4:5 images with text overlay paired with written captions for social media.

## Two Modes

### 1. News Mode (`--news`) — Newspaper-style viral news posts
1. **News Search** — Gemini + Google Search grounding finds the top 5 most viral Samoa news stories from the past 7 days, ranked by virality.
2. **Post Generation** — Gemini writes a newspaper-style post: bold headline, subheadline, body text, CTA to download {{BRAND_NAME}}.
3. **Background Generation** — FAL nano-banana-2 generates a dramatic, editorial-style background (muted tones, 4:5).
4. **Newspaper Composite** — ffmpeg composites a newspaper front-page layout: "DISCOVER SAMOA" masthead, date, headline, subheadline, body, CTA bar, branding.
5. **Output** — Newspaper image PNG + sidecar JSON saved to `~/{{PersonaDir}}/infographics/{date}-news-{slug}/`

### 2. Standard Mode (default) — Infographic fact posts
1. **Content Ideation** — Gemini generates an infographic concept: topic, title, 3-5 key facts/stats, background image prompt, and a long-form written caption.
2. **Background Generation** — FAL nano-banana-2 generates a scene-setting background at 4:5 aspect ratio.
3. **Text Overlay** — ffmpeg composites a semi-transparent overlay + title + bullet points + branding onto the background image.
4. **Output** — Infographic PNG + sidecar JSON saved to `~/{{PersonaDir}}/infographics/{date}-{slug}/`

## Usage

```bash
# NEWS MODE — search viral Samoa news and generate newspaper post
node skills/infographic-gen/scripts/infographic-gen.js --news
node skills/infographic-gen/scripts/infographic-gen.js --news --dry-run

# STANDARD MODE — topic-bank infographic
node skills/infographic-gen/scripts/infographic-gen.js
node skills/infographic-gen/scripts/infographic-gen.js --topic "Samoa Travel Facts"
node skills/infographic-gen/scripts/infographic-gen.js --topic "To Sua Ocean Trench" --facts 4 --dry-run
```

## Options

| Flag | Default | Description |
|------|---------|-------------|
| --news | false | News mode: search viral Samoa news, newspaper layout |
| --topic "..." | auto-rotate | Override topic selection (standard mode only) |
| --facts N | 3-5 | Override fact count (standard mode only) |
| --dry-run | false | Print plan, skip image generation |

## Output

- Image: `~/{{PersonaDir}}/infographics/{date}-{slug}/infographic.png`
- Sidecar: `~/{{PersonaDir}}/infographics/{date}-{slug}/infographic.json`

Sidecar JSON includes `type: "news"` for news posts — the publish script reads this to adjust captions accordingly.

## Prerequisites

- `GEMINI_API_KEY` in `.env`
- `FAL_KEY` in `.env`
- ffmpeg installed
- Reference image: `brand-content/persona/reference.png` (standard mode with persona)

## Platforms

Instagram (4:5 feed post), Facebook (feed post), Twitter/X (image + tweet). No YouTube, no TikTok.

## Content Pillars (standard mode, auto-rotated)

1. Hidden Samoa
2. Local Life
3. Adventure
4. Business Spotlight
5. Travel Tips
6. Culture Education
