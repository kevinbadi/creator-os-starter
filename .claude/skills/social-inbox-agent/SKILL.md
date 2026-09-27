---
name: social-inbox-agent
description: AI-powered social inbox agent — responds to inbound DMs on Instagram, Twitter, LinkedIn, and YouTube as {{PERSONA_NAME}} via Late API + Gemini, with PostgreSQL message tracking
---

## What It Does

Automatically responds to inbound DMs across all connected social platforms. Uses PostgreSQL as the single source of truth for all message tracking — no file-based state, no race conditions, no self-reply loops.

## How to Run

```bash
# Process all unreplied messages
node skills/social-inbox-agent/scripts/dm-response-agent.js

# Dry run — see what would be sent without sending
node skills/social-inbox-agent/scripts/dm-response-agent.js --dry-run

# Limit to N conversations
node skills/social-inbox-agent/scripts/dm-response-agent.js --limit 5

# Filter to specific platform
node skills/social-inbox-agent/scripts/dm-response-agent.js --platform instagram
```

**Requires env vars:** `LATE_API_KEY`, `GEMINI_API_KEY`, `DATABASE_URL`

## Message Workflow

```
1. FETCH — Get all conversations from Late API (GET /v1/inbox/conversations)
2. For each conversation:
   a. FETCH messages (GET /v1/inbox/conversations/{id}/messages)
   b. SYNC — Store all incoming messages in PostgreSQL (social_inbox table)
   c. SAFETY CHECKS — Run all anti-spam guards (see below)
   d. FIND — Identify the latest unreplied incoming message
   e. GENERATE — Create reply via Gemini with conversation context
   f. SEND — Post reply via Late API
   g. TRACK — Atomically store outgoing reply + mark incoming as replied in DB
```

## Database Tracking (social_inbox table)

| Column | Purpose |
|---|---|
| `late_message_id` | Unique Late API message ID (unique constraint) |
| `late_conversation_id` | Groups messages by conversation |
| `direction` | `incoming` or `outgoing` |
| `replied` | Boolean — has this incoming message been replied to? |
| `replied_at` | Timestamp of when we replied |
| `reply_text` | The reply we sent (or `[SKIPPED]`) |
| `message_text` | The original message content |
| `sender_name` | Who sent it |
| `platform` | instagram, twitter, linkedin, youtube |

### Key DB queries the agent uses:
- **Is this message already replied?** → `SELECT replied FROM social_inbox WHERE late_message_id = $1`
- **Is this text our own reply?** → `SELECT id FROM social_inbox WHERE direction = 'outgoing' AND message_text = $1`
- **Spam ratio?** → `SELECT direction, COUNT(*) FROM social_inbox WHERE late_conversation_id = $1 GROUP BY direction`

## Safety Rules (Anti-Spam)

These were added after a 200-message spam incident on 2026-03-14:

1. **ONE reply per conversation per run** — even if 50 unreplied messages exist, sends exactly ONE reply to the latest
2. **Never double-message** — if the last message in the conversation is ours (outgoing), skip entirely
3. **Never reply to self** — outgoing messages tracked in DB; if conversation's `lastMessage` matches our DB outgoing text, skip
4. **Spam ratio guard** — if outgoing > 2× incoming (and > 3 total), skip the conversation
5. **Pagination-aware** — Late API caps at 100 messages; agent cross-references `conversation.lastMessage` with DB to detect messages beyond the pagination window
6. **Atomic tracking** — reply send + DB update in a single transaction; no partial states

## Beyond-Pagination Logic

When a conversation has 100+ messages (e.g., after a spam incident), the messages endpoint won't return the newest ones. The agent handles this:

1. Compares `conversation.updatedTime` vs last visible message timestamp
2. If conversation was updated >30s after last visible message → newer message exists
3. Checks DB: is `conversation.lastMessage` text one of our outgoing replies? → skip
4. If not our reply → creates a synthetic incoming record with a **text-based ID** (base64 of message content), generates reply, tracks in DB
5. Text-based synthetic IDs ensure the same incoming message always deduplicates, even when `updatedTime` changes from our own replies

## Response Strategy

Loads persona from `onboarding-config.json` (phase1.*):
- Persona name, backstory, voice, brand info, target audience, primary CTA

### Response Rules
- Keep replies short (1-3 sentences for simple, up to 5 for detailed questions)
- No markdown formatting — this is a DM, not a document
- Max 1-2 emojis per message, only if natural
- Answer questions first, then guide toward offer if relevant
- Don't be salesy or pushy — be genuinely helpful
- Never break character or mention being AI
- Skip low-effort messages (just emojis, etc.) with `[SKIP]`

## Setup Requirements

- PostgreSQL with `social_inbox` table (unique constraint on `late_message_id`)
- Late API account with connected social platforms
- Gemini API key for reply generation
- Platform account IDs in `onboarding-config.json` → `phase2.platforms.*.late_id`

## Cron Configuration

Designed to run every 1 minute via cron. Safe for concurrent/isolated runs because all state is in PostgreSQL, not local files.

```
Schedule: * * * * *
Target: isolated
Command: node skills/social-inbox-agent/scripts/dm-response-agent.js --limit 10
```
