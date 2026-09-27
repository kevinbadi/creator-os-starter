---
name: linkedin-message-agent
description: Check LinkedIn inbox for new/unread messages and auto-respond using AI. Browser automation via CDP. Logs all conversations to database for tracking. Trigger when asked to check LinkedIn messages, respond to LinkedIn DMs, or monitor LinkedIn inbox.
---

# LinkedIn Message Check & Respond Agent

Monitors LinkedIn inbox for unread messages, reads conversation context, generates contextual AI responses, and sends replies. All via CDP browser automation.

## Prerequisites

- Chrome with CDP running (auto-starts via Clawdbot)
- Logged into LinkedIn (cookies at `cookies/linkedin-zeusbycreatoros.json`)
- `ws` and `pg` npm packages
- `DATABASE_URL` env var for logging

## Quick Usage

### Check and respond to all unread messages
```bash
node skills/linkedin-message-agent/scripts/linkedin-message-agent.js
```

### Check only (don't send responses)
```bash
node skills/linkedin-message-agent/scripts/linkedin-message-agent.js --dry-run
```

### Limit number of conversations to process
```bash
node skills/linkedin-message-agent/scripts/linkedin-message-agent.js --limit 5
```

## Workflow

1. Navigate to LinkedIn Messaging inbox
2. Scan for unread conversations (indicated by bold/unread indicators)
3. For each unread conversation:
   - Click into the conversation
   - Read the last few messages for context
   - Determine if a response is needed (skip automated/spam)
   - Generate a contextual response as Kev's Assistant (CreatorOS AI employee)
   - Type and send the response
   - Log the conversation to the database
4. Output summary of all processed conversations

## Response Persona

Kev's Assistant responds as a professional AI employee at CreatorOS:
- Friendly, helpful, concise
- Interested in AI, automation, startups
- Can discuss CreatorOS services if relevant
- Avoids overselling, stays conversational
- If someone asks to meet/call, suggests they connect with Kevin

## CLI Options

| Flag | Default | Description |
|------|---------|-------------|
| `--dry-run` | false | Read messages only, don't respond |
| `--limit` | 10 | Max conversations to process |
| `--cdp-port` | 18800 | Chrome CDP port |

## Database

Logs to `social_messages` table:
- platform: 'linkedin'
- direction: 'inbound' or 'outbound'
- sender_name, content, conversation context

## Safety

- Max 10 conversations per run (avoid spam detection)
- 5-10s delays between conversations
- Never responds to obvious spam/automated messages
- Dry-run mode to verify before enabling auto-respond
