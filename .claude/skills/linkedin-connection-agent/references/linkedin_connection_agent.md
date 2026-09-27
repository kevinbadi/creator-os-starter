# LinkedIn Connection Agent

## GOAL
Track LinkedIn connection requests sent via PhantomBuster agent and store analytics in database.

## PHANTOMBUSTER AGENT DETAILS
- **Agent ID**: 685897070795556 (REQUIRED - specific agent for LinkedIn connections)
- **Purpose**: Send LinkedIn connection requests to leads
- **Daily Limit**: 20 connection requests
- **API Key**: Required in .env file

## REQUIRED CONFIGURATION

### Environment Variables (in .env)
```bash
PHANTOMBUSTER_API_KEY=QGUtgLhzz2i437bWBM6UN0MBoagJoFR3OX7UHT7dKSI
PHANTOMBUSTER_AGENT_ID=685897070795556
DATABASE_URL=postgresql://...
```

## CORRECT METRICS PARSING ⚠️ IMPORTANT

### Status Values in PhantomBuster Response
- `"Invitation sent"` → We sent an invite, waiting for response (PENDING)
- `"Request accepted"` → They accepted our invitation! ✅ (ACCEPTED)
- `"Already connected"` → Pre-existing connection (NOT from this campaign)
- `"Not invited yet"` → In queue, not yet processed

### Correct Calculation Logic
```python
# CORRECT PARSING:
# - total_sent = profiles with invitationDate (we sent them an invite)
# - total_accepted = profiles with status = "Request accepted"
# - pending = profiles with status = "Invitation sent"

invites_sent = []
requests_accepted = []
pending_invites = []

for profile in profiles:
    invitation_date = profile.get('invitationDate', '')
    status = profile.get('status', '')
    
    # Only count profiles where WE sent an invitation
    if invitation_date:
        invites_sent.append(profile)
        
        if status == 'Request accepted':
            requests_accepted.append(profile)
        elif status == 'Invitation sent':
            pending_invites.append(profile)

total_sent = len(invites_sent)
total_accepted = len(requests_accepted)
pending = len(pending_invites)
acceptance_rate = (total_accepted / total_sent * 100) if total_sent > 0 else 0
```

### Example Metrics
```
✅ TOTAL SENT: 10      (profiles with invitationDate)
🎉 TOTAL ACCEPTED: 1   (status = "Request accepted")
⏳ PENDING: 9          (status = "Invitation sent")
📈 ACCEPTANCE RATE: 10%
```

## DATABASE SCHEMA

### Table: `linkedin_agent_data`
```sql
CREATE TABLE linkedin_agent_data (
    id SERIAL PRIMARY KEY,
    
    -- Aggregate Stats (for daily summaries)
    day_sent INTEGER,           -- Invitations sent today
    day_accepted INTEGER,       -- Requests accepted today
    total_sent INTEGER,         -- Total invitations sent
    total_accepted INTEGER,     -- Total requests accepted
    
    -- Individual Profile Tracking
    linkedin_url TEXT UNIQUE,   -- LinkedIn profile URL (for matching)
    profile_name TEXT,          -- Profile name
    connection TEXT,            -- Company name
    status TEXT,                -- Current status
    
    -- Timestamps
    invitation_date TIMESTAMP,  -- When we sent invitation
    connected_date TIMESTAMP,   -- When they accepted
    
    -- Metadata
    links_json TEXT,            -- URL to full results JSON
    raw_data JSONB,             -- Full profile data
    process_timestamp TIMESTAMP,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);
```

### Database Storage Strategy
1. **Aggregate Stats**: Store daily totals (total_sent, total_accepted) for tracking over time
2. **Individual Profiles**: Store each profile with linkedin_url as unique key for updates
3. **Status Updates**: When status changes from "Invitation sent" → "Request accepted", update connected_date

## API ENDPOINTS

### Get Agent Results
```
GET https://api.phantombuster.com/api/v2/agents/fetch-output?id=685897070795556
Headers:
  - X-Phantombuster-Key-1: {API_KEY}
```

### Response Structure
```json
{
  "status": "finished",
  "output": "logs containing JSON URL...",
  "isAgentRunning": false
}
```

### Structured Profile Data (from JSON URL)
```json
{
  "name": "Fihobiana Rasolondraibe Razafindrazaka",
  "linkedinProfileUrl": "https://linkedin.com/in/...",
  "companyName": "Self-employed",
  "status": "Request accepted",  // <-- KEY FIELD
  "invitationDate": "2025-12-12T05:22:12.089Z"  // <-- KEY FIELD
}
```

## CRON SCHEDULE

- **Schedule**: Daily at 6:00 PM EST (11:00 PM UTC)
- **Cron Expression**: `0 23 * * *`
- **Platform**: Modal (serverless)

### Modal Deployment
```bash
modal deploy modal_linkedin_connections.py
modal run modal_linkedin_connections.py  # Test run
```

## WORKFLOW STEPS

### 1. Fetch Agent Output
- Call PhantomBuster API to get latest results
- Extract JSON URL from output logs

### 2. Fetch Profile Data
- Download structured JSON from S3 URL
- Parse all profiles

### 3. Calculate Metrics
- Count profiles with `invitationDate` → total_sent
- Count profiles with `status = "Request accepted"` → total_accepted
- Count profiles with `status = "Invitation sent"` → pending

### 4. Store in Database
- Insert aggregate stats row for daily tracking
- Insert/update individual profiles
- Update status when acceptance detected

### 5. Return Summary
```json
{
  "status": "success",
  "total_sent": 10,
  "total_accepted": 1,
  "pending": 9,
  "acceptance_rate": "10.0%"
}
```

## USAGE

### Local Testing
```bash
# View analytics only
python3 implementation/linkedin_connection_agent.py --analytics

# Store results in database
python3 implementation/linkedin_connection_agent.py --analytics --store
```

### Modal Cron
```bash
# Deploy scheduled cron
modal deploy modal_linkedin_connections.py

# Manual test run
modal run modal_linkedin_connections.py
```

## SUCCESS CRITERIA

- ✅ Correctly parses `invitationDate` to identify sent invitations
- ✅ Correctly identifies `"Request accepted"` status as accepted
- ✅ Stores aggregate stats (total_sent, total_accepted) in database
- ✅ Tracks individual profiles with unique linkedin_url
- ✅ Updates status when acceptance detected
- ✅ Runs daily at 6 PM EST via Modal cron
