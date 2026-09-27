---
name: linkedin-engage
description: Like and comment on employee LinkedIn posts via browser automation. Checks a LinkedIn profile for new posts, likes them, and drops hype comments. Deduplicates via database so each post only gets one engagement. Trigger when asked to engage with LinkedIn posts, like/comment on employee posts, or run LinkedIn engagement automation.
---

# LinkedIn Engage (Like & Comment)

Automated LinkedIn engagement bot: visits a colleague's profile, finds new posts, likes them, and drops a hype comment.

## Prerequisites

- Chrome with CDP running (Clawdbot browser)
- Logged into LinkedIn in the browser session
- `ws` and `pg` npm packages
- `DATABASE_URL` env var

## Quick Usage

### Check and engage with Kevin's posts
```bash
node skills/linkedin-engage/scripts/linkedin-engage.js --profile "YourLinkedInSlug"
```

### Custom comment style
```bash
node skills/linkedin-engage/scripts/linkedin-engage.js \
  --profile "YourLinkedInSlug" \
  --commenter "Kev's Assistant from CreatorOS"
```

### Dry run (scrape only, no engagement)
```bash
node skills/linkedin-engage/scripts/linkedin-engage.js --profile "YourLinkedInSlug" --dry-run
```

### Custom CDP port
```bash
node skills/linkedin-engage/scripts/linkedin-engage.js --profile "YourLinkedInSlug" --cdp-port 18800
```

## CLI Options

| Flag | Default | Description |
|------|---------|-------------|
| `--profile` | (required) | LinkedIn profile slug (e.g. "YourLinkedInSlug") |
| `--commenter` | "Kev's Assistant" | Name to sign off comments (for context) |
| `--limit` | 5 | Max posts to engage with per run |
| `--cdp-port` | 18800 | Chrome CDP port |
| `--dry-run` | false | Scrape posts but don't like/comment |

## Workflow

1. Navigate to `linkedin.com/in/{profile}/recent-activity/all/`
2. Scrape visible post previews (text, post URN, timestamp)
3. Check `linkedin_engagements` DB table for already-engaged posts
4. For each new post:
   a. Click into the post (or scroll to it)
   b. Click the Like button
   c. Click the Comment box, type a hype comment, submit
5. Store engagement in DB
6. Output JSON summary

## Database

Uses `linkedin_engagements` table:
- `post_hash` (TEXT, unique): MD5 of post content prefix
- `profile_slug` (TEXT): whose post it was
- `post_text` (TEXT): first ~200 chars of post content
- `liked` (BOOLEAN): whether we liked it
- `commented` (BOOLEAN): whether we commented
- `comment_text` (TEXT): the comment we left
- `engaged_at` (TIMESTAMPTZ): when engagement happened

## Comment Generation

The script generates short, authentic hype comments based on post content. Comments are varied, enthusiastic, and reference specifics from the post. No generic "Great post!" — every comment ties to what was actually said.

## Cron Automation

Schedule daily engagement:
```
Check your LinkedIn for new posts and engage — like and drop a hype comment on any new posts from YourLinkedInSlug
```

## Troubleshooting

- **Not logged in**: Re-import LinkedIn cookies or log in manually
- **No posts found**: Profile may have no recent activity, or selectors changed
- **Like button not clickable**: Post may already be liked (script skips these)
- **Comment not submitting**: LinkedIn's comment editor selectors may have changed
