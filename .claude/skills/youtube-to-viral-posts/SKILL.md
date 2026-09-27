---
name: youtube-to-viral-posts
description: Converts YouTube videos into viral Twitter/LinkedIn posts using Gemini AI video analysis. Generates posts with hooks, stats, step-by-step breakdowns, and CTAs. Trigger when asked to create viral posts from YouTube videos, generate social media posts from video content, or repurpose YouTube videos into text posts.
---

# YouTube to Viral Posts

Converts YouTube videos into viral Twitter/LinkedIn posts using Gemini AI video analysis. Downloads the video, uploads to Gemini, and generates a viral post following a proven format.

## What It Does

1. Downloads YouTube video via yt-dlp
2. Uploads video to Gemini for AI analysis
3. Generates a viral post following the proven structure: Hook → Body → Steps → CTA
4. Stores the result in `youtube_social_post` database table

## How to Run

```bash
# Generate viral post from YouTube video
python3 skills/youtube-to-viral-posts/scripts/youtube_to_viral_posts.py "https://www.youtube.com/watch?v=VIDEO_ID"

# With custom CTA keyword
python3 skills/youtube-to-viral-posts/scripts/youtube_to_viral_posts.py "https://www.youtube.com/watch?v=VIDEO_ID" --cta-keyword "AGENT"
```

## Configuration

### Environment Variables

```env
GEMINI_API_KEY=xxx
DATABASE_URL=postgresql://...
```

### Dependencies

```bash
pip install google-generativeai yt-dlp psycopg2-binary python-dotenv
```

## Post Format (Critical Structure)

### 1. Hook (Shocking Headline + Stat)
- Include a believable stat (e.g., "$125,000 generated", "1.6 million views")
- Reference the AI/tech being discussed
- Attention-grabbing language

### 2. Body (Value Proposition)
- How it works
- Why it's powerful
- Impact on business

### 3. Steps (How-To)
- Step-by-step breakdown using arrow notation (→)
- OR "how to copy this workflow/idea"

### 4. CTA (Call to Action)
- Comment keyword related to the tech (e.g., "SWAP", "AGENT")
- Ask them to like the post
- "Must be following to receive DM"
- Offer free resource (Loom walkthrough, tutorial)

## Output Constraints

- ✅ Use emojis throughout
- ✅ Include stat in hook (can be fabricated but realistic)
- ✅ End with clear CTA (comment keyword)
- ✅ Output clean text with real newlines
- ❌ No markdown formatting
- ❌ No `\n` as literal text

## Important Notes

- **Video Processing**: Gemini upload can take 30-60 seconds for longer videos
- **File Cleanup**: Temp video files are deleted after processing
- **Rate Limiting**: Add delays between multiple video processing requests
- **Database**: Uses `ON CONFLICT` for duplicate URL handling
- **Video Format**: yt-dlp downloads as MP4

## Scripts

| File | Purpose |
|------|---------|
| `youtube_to_viral_posts.py` | Main viral post generator |
