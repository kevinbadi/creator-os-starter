---
name: gemini-viral-shorts
description: Generates viral Twitter/LinkedIn posts from YouTube videos using Google Gemini API. Professional copywriter persona creates posts with hooks, stats, and CTAs. Trigger when asked to generate viral posts using Gemini, create social media content from YouTube URLs, or make viral short-form text content.
---

# Gemini Viral Shorts Post Generator

Uses Google Gemini API to analyze YouTube videos and generate viral Twitter/LinkedIn posts with a professional content marketing copywriter persona.

## What It Does

1. Takes a YouTube URL as input
2. Sends the video (or transcript) to Gemini with a copywriter persona prompt
3. Generates a viral post with: Hook (shocking headline + stat) → Body (value proposition) → Steps (how-to) → CTA (comment keyword)
4. Outputs formatted text ready for posting

## How to Run

```bash
# Generate viral post from YouTube video
python3 skills/gemini-viral-shorts/scripts/gemini_viral_shorts_post.py "YOUR_YOUTUBE_URL"
```

## Configuration

### Environment Variables

```env
GEMINI_API_KEY=xxx
```

### Dependencies

```bash
pip install google-generativeai yt-dlp python-dotenv
```

## Post Structure

1. **Hook**: Shocking headline + believable stat
2. **Body**: How it works, why it's powerful, business impact
3. **Steps**: Step-by-step breakdown
4. **CTA**: Comment keyword + "Like this post"

## Difference from `youtube-to-viral-posts`

This is a lighter-weight version focused purely on post generation:
- No database storage
- No custom CTA keyword flag
- Uses `gemini-1.5-pro` or `gemini-1.5-flash` (vs 2.0-flash in the other skill)
- Simpler single-purpose script

Use `youtube-to-viral-posts` for the full pipeline with database tracking. Use this for quick one-off post generation.

## Important Notes

- Ensure `GEMINI_API_KEY` is set in `.env`
- Gemini can analyze YouTube URLs directly without downloading
- Output is clean text — no markdown formatting
- For higher quality posts, use `gemini-1.5-pro`; for speed, use `gemini-1.5-flash`

## Scripts

| File | Purpose |
|------|---------|
| `gemini_viral_shorts_post.py` | Main Gemini post generator |
