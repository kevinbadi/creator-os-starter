---
name: linkedin-connection-agent
description: Tracks LinkedIn connection requests sent via PhantomBuster and stores analytics in the database. Monitors acceptance rates, pending invites, and new connections. Trigger when asked about LinkedIn connection tracking, LinkedIn outreach analytics, or PhantomBuster LinkedIn results.
---

# LinkedIn Connection Agent

Fetches LinkedIn connection request results from a PhantomBuster agent, calculates acceptance metrics, and stores analytics in the database. Runs as a daily cron job via Modal.

## What It Does

1. Calls PhantomBuster API to get latest LinkedIn connection results
2. Downloads structured JSON profile data from S3
3. Calculates metrics: total sent, accepted, pending, acceptance rate
4. Stores aggregate stats and individual profiles in `linkedin_agent_data` table
5. Tracks status changes (e.g., "Invitation sent" → "Request accepted")

## How to Run

### Local

```bash
# View analytics only
python3 skills/linkedin-connection-agent/scripts/linkedin_connection_agent.py --analytics

# Store results in database
python3 skills/linkedin-connection-agent/scripts/linkedin_connection_agent.py --analytics --store
```

### Modal Cron (Daily at 6 PM EST / 11 PM UTC)

```bash
modal deploy skills/linkedin-connection-agent/scripts/modal_linkedin_connections.py
modal run skills/linkedin-connection-agent/scripts/modal_linkedin_connections.py
```

## Configuration

### Environment Variables

```env
PHANTOMBUSTER_API_KEY=xxx
PHANTOMBUSTER_AGENT_ID=685897070795556  # LinkedIn connections agent
DATABASE_URL=postgresql://...
```

### Dependencies

```bash
pip install requests psycopg2-binary python-dotenv
```

## Metrics Parsing (Important)

- **total_sent** = profiles with `invitationDate` (we sent them an invite)
- **total_accepted** = profiles with `status = "Request accepted"`
- **pending** = profiles with `status = "Invitation sent"`
- **acceptance_rate** = total_accepted / total_sent × 100

**Do NOT count** "Already connected" as accepted — those are pre-existing connections.

## Important Notes

- PhantomBuster daily limit: 20 connection requests
- Agent ID `685897070795556` is required — it's the specific LinkedIn connections agent
- Individual profiles tracked by unique `linkedin_url` for status updates
- Aggregate stats stored daily for trend tracking

## Scripts

| File | Purpose |
|------|---------|
| `linkedin_connection_agent.py` | Local analytics script |
| `modal_linkedin_connections.py` | Modal cron deployment |
