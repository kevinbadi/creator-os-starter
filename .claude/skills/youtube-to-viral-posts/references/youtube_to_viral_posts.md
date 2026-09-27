# YouTube to Viral Posts Agent

## Overview

Converts YouTube videos into viral Twitter/LinkedIn posts using Gemini AI video analysis. The agent downloads the video, uploads it to Gemini, generates a viral post following a proven format, and stores the result in the database.

## Workflow

```
YouTube URL → Download Video → Upload to Gemini → Generate Viral Post → Store in Database
```

## Database Table

**Table:** `youtube_social_post`

| Column | Type | Description |
|--------|------|-------------|
| `id` | SERIAL | Auto-increment primary key |
| `original_youtube_url` | TEXT | Source YouTube URL (required) |
| `twitter_linkedin_post` | TEXT | Generated viral post content |
| `created_at` | TIMESTAMP | When the post was generated |

## Post Format (CRITICAL)

The generated post MUST follow this exact structure:

### 1. Hook (Shocking Headline + Stat)
- Include a made-up but believable stat (e.g., "$125,000 generated", "150,000 new followers", "55 booked calls", "1.6 million views")
- Reference the AI/tech/workflow being discussed
- Use attention-grabbing language

### 2. Body (Value Proposition)
- How it works
- Why it is powerful
- Impact on business (personal or others)

### 3. Steps (How-To)
- Step by step breakdown
- OR "how to copy this workflow/idea"
- Use arrow notation (→) for steps

### 4. CTA (Call to Action)
- Prompt user to comment a keyword related to the tech (e.g., "SWAP", "AGENT", "VIDEO")
- Ask them to like the post
- Mention they must be following to receive DM
- Offer a free resource (Loom walkthrough, tutorial, template)

## Example Output

```
Holy sh*t! I just swapped a UGC creator with an AI character in 5 minutes 🤯

Same video. Same expressions. Same movements.

Completely different person.

Perfect for DTC brands & agencies who want to test multiple UGC variations without filming 10 different people.

The use case:

You've got a winning UGC video. The script works. The pacing works.

But you want to test it with different creators—different ages, genders, ethnicities—to see what resonates best with your audience.

Traditionally, you'd need to:

Hire 5-10 different creators → Brief them all → Hope they match the original energy → Pay $500+ per person → Wait weeks

This AI workflow does it differently:

→ Start with your original UGC video
→ Create AI character image with Nano Banana
→ Upload both to FAL AI's Wan Animate model
→ AI swaps the creator while maintaining all facial expressions, movements, sync
→ Get variation in ~10 minutes

The motion tracking is insane.

Every head tilt, smile, gesture from the original is replicated perfectly on the AI character.

What you can test:

→ Same winning script, 5 different creator demographics
→ A/B test which "face" drives highest CTR
→ Localize content for different markets
→ Refresh creative without reshooting

I recorded a full Loom walkthrough showing the exact process step-by-step.

Want the complete tutorial?

> Comment "SWAP"

> Like this post

And I'll send the Loom over (must be following so I can DM)

(Obviously, only use this with videos you own 100% rights to + get creator permission upfront if you plan to make AI variations.)
```

## Constraints

### MUST DO
- Use emojis throughout the post
- Include a stat in the hook (can be fabricated but realistic)
- End with a clear CTA asking for a comment keyword
- Mention "must be following" in the CTA
- Output clean text with real newlines (no `\n` literals)

### MUST NOT
- Add markdown formatting (`**bold**`, `# headers`, etc.)
- Include `\n` as literal text in output
- Skip the CTA or stat
- Generate generic/boring hooks

## Environment Variables

```bash
GEMINI_API_KEY=your_gemini_api_key
DATABASE_URL=postgresql://...
```

## Usage

```bash
# Generate viral post from YouTube video
python3 implementation/youtube_to_viral_posts.py "https://www.youtube.com/watch?v=VIDEO_ID"

# With custom CTA keyword
python3 implementation/youtube_to_viral_posts.py "https://www.youtube.com/watch?v=VIDEO_ID" --cta-keyword "AGENT"
```

## API Details

### Gemini Model
- **Model:** `gemini-2.0-flash` (or `gemini-1.5-pro` for higher quality)
- **Capability:** Video analysis with text generation
- **Process:** Upload video file → Wait for processing → Generate content

## Warnings & Learned Constraints

### WARNING: Video Processing Time
Gemini video upload can take 30-60 seconds for longer videos. The script polls until `file.state.name != "PROCESSING"`.

### WARNING: Video Format
yt-dlp should download as MP4. If video format issues occur, use `format: 'best[ext=mp4]/best'`.

### WARNING: File Cleanup
Always delete temporary video files after processing to avoid disk space issues.

## Best Practices

1. **Rate Limiting:** Add delays between multiple video processing requests
2. **Error Handling:** Wrap Gemini API calls in try/except for network issues
3. **Temp Files:** Use unique filenames with timestamps to avoid conflicts
4. **Database Upserts:** Use `ON CONFLICT` to handle duplicate URLs gracefully
