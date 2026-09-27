# Klap API: Generate Shorts - Complete Workflow

This document outlines the **complete end-to-end workflow** for generating shorts from a video using the Klap API.

## Overview

The Klap workflow automatically:
1. Takes a video URL (YouTube, etc.)
2. Sends it to Klap for AI-powered editing
3. Polls for processing completion
4. Exports all generated shorts
5. Downloads videos locally
6. Stores everything in the database
7. Sends notifications when complete

## API Details
- **Base URL**: `https://api.klap.app/v2`
- **Authentication**: Bearer Token (provided in `.env` as `KLAP_API_KEY`)
- **Documentation**: [Klap API Docs](https://klap.app)

## Complete Workflow

### Step 1: Submit Video for Processing
**Endpoint**: `POST /tasks/video-to-shorts`

```python
payload = {
    "source_video_url": "https://youtube.com/watch?v=VIDEO_ID",
    "language": "en",
    "max_duration": 30,
    "max_clip_count": 5,
    "editing_options": {
        "intro_title": False
    }
}

response = requests.post(f"{API_URL}/tasks/video-to-shorts", 
                         headers=headers, json=payload)
task_id = response.json()["id"]
```

**Response**: Returns a Task object with an `id`.

### Step 2: Poll Task Status Until Complete
**Endpoint**: `GET /tasks/{task_id}`

Poll every 30 seconds until `status` is `success`, `complete`, or `ready`.

```python
while True:
    response = requests.get(f"{API_URL}/tasks/{task_id}", headers=headers)
    data = response.json()
    status = data["status"]
    
    if status in ["success", "complete", "ready"]:
        folder_id = data["output_id"]  # This is the folder containing shorts
        break
    elif status == "error":
        raise Exception(data.get("error_message"))
    
    time.sleep(30)
```

**Important**: The `output_id` (or `folder_id`) is needed for the next steps.

### Step 3: List Generated Shorts
**Endpoint**: `GET /projects/{folder_id}`

```python
response = requests.get(f"{API_URL}/projects/{folder_id}", headers=headers)
shorts = response.json()

# Each short contains:
# - id: Unique short ID
# - name: Generated title
# - virality_score: AI-predicted virality (0-100)
# - virality_score_explanation: Why this score
# - publication_captions: Ready-to-use captions for TikTok, YouTube, etc.
# - transcript_text: Full transcript
```

### Step 4: Export Each Short
**Endpoint**: `POST /projects/{folder_id}/{short_id}/exports`

Shorts don't have download URLs by default - you must **export** them first.

```python
for short in shorts:
    short_id = short["id"]
    
    # Create export request
    response = requests.post(
        f"{API_URL}/projects/{folder_id}/{short_id}/exports",
        headers=headers,
        json={}  # Optional: add watermark settings
    )
    export_id = response.json()["id"]
    
    # Poll for export completion
    while True:
        response = requests.get(
            f"{API_URL}/projects/{folder_id}/{short_id}/exports/{export_id}",
            headers=headers
        )
        data = response.json()
        
        if data["status"] in ["success", "complete"]:
            download_url = data["src_url"]
            break
        
        time.sleep(5)
```

### Step 5: Download Videos
Once you have the `src_url` from the export, download the video:

```python
response = requests.get(download_url, stream=True)
with open(f"{short_name}.mp4", "wb") as f:
    for chunk in response.iter_content(chunk_size=8192):
        f.write(chunk)
```

### Step 6: Store in Database
Store each clip in `video_to_shorts_agent` table with the **output_video_url**:

```python
# Initial insert when clip is generated
cursor.execute("""
    INSERT INTO video_to_shorts_agent (
        id, name, status, src_url, folder_id, virality_score,
        descriptions, author_id, created_at, project_id
    ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
""", (clip_id, name, 'generated', source_url, folder_id, 
      virality_score, '', user_id, now, folder_id))

# Update with output_video_url after export completes
cursor.execute("""
    UPDATE video_to_shorts_agent 
    SET output_video_url = %s,
        status = 'downloaded',
        descriptions = %s,
        finished_at = %s
    WHERE id = %s
""", (export_download_url, local_file_path, now, clip_id))
```

**Important**: The `output_video_url` column stores the final exported video URL from Klap (e.g., `https://storage.googleapis.com/klap-renders/xxx.mp4`).

### Step 7: Send Notification
Notify user when complete (desktop + webhook):

```python
# macOS desktop notification
subprocess.run(["osascript", "-e", 
    f'display notification "Downloaded {count} shorts!" with title "🎬 Klap Ready!"'])

# Webhook (Slack/Discord)
requests.post(webhook_url, json={"text": f"Downloaded {count} shorts!"})
```

## Implementation

### Main Script (Recommended)
**File**: `implementation/klap_generate_shorts_enhanced.py`

```bash
# Generate shorts with full workflow
python3 implementation/klap_generate_shorts_enhanced.py "https://youtube.com/watch?v=VIDEO_ID"

# With custom user ID
python3 implementation/klap_generate_shorts_enhanced.py "https://youtube.com/watch?v=VIDEO_ID" --user-id 2
```

This script handles the **entire workflow automatically**:
- Submits video
- Polls for completion
- Exports all shorts
- Downloads videos
- Stores in database
- Sends notifications

## Database Schema

### Table: `video_to_shorts_agent`

| Column | Type | Description |
|--------|------|-------------|
| id | text | Unique clip ID (from Klap) |
| name | text | Generated clip title |
| status | text | pending → processing → complete → exported → downloaded |
| src_url | text | Original source video URL (YouTube, etc.) |
| **output_video_url** | text | **Final exported video URL** (Google Storage) |
| folder_id | text | Klap folder containing all shorts from a job |
| project_id | text | Parent job ID (links clips together) |
| virality_score | int | AI-predicted virality (0-100) |
| virality_score_explanation | text | Explanation for score |
| publication_captions | jsonb | Ready-to-use captions |
| descriptions | text | Local file path or notes |
| author_id | int | User who submitted |
| created_at | timestamp | When submitted |
| finished_at | timestamp | When downloaded |

### Status Flow

```
pending → processing → complete → exported → downloaded
                  ↘ failed (on error)
```

## Environment Variables

Required in `.env`:

```bash
KLAP_API_KEY=your_klap_api_key
DATABASE_URL=postgresql://user:pass@host:5432/db

# Optional
NOTIFICATION_WEBHOOK_URL=https://hooks.slack.com/services/...
```

## Klap Web Interface

You can also view/manage shorts at:
- **Klap Dashboard**: `https://klap.app/spaces/{folder_id}`
- **Individual Short**: `https://klap.app/spaces/{folder_id}#{short_id}`

## Error Handling

The script automatically handles:
- API rate limits (with retries)
- Processing timeouts (configurable)
- Export failures (continues with other shorts)
- Database connection issues
- Network errors

All errors are logged to the database for debugging.

## Polling Configuration

Defaults (configurable in script):

```python
TASK_POLL_INTERVAL = 30    # seconds between task checks
EXPORT_POLL_INTERVAL = 5   # seconds between export checks  
MAX_TASK_POLLS = 60        # ~30 min max wait for processing
MAX_EXPORT_POLLS = 40      # ~3 min max wait for export
```

## Example Output

```
======================================================================
🚀 KLAP SHORTS GENERATOR - COMPLETE WORKFLOW
======================================================================
📹 Source: https://youtube.com/watch?v=Dg_G0ifSiB0
👤 User ID: 2
======================================================================

📌 STEP 1: Submitting video to Klap...
🎬 Submitting video: https://youtube.com/watch?v=Dg_G0ifSiB0
✅ Task created: abc123

📌 STEP 2: Waiting for video processing...
⏳ Polling for task completion............. Done!
✅ Processing complete! Folder ID: mwJ6KNRr

📌 STEP 3: Fetching generated shorts...
✅ Found 5 shorts

📌 STEP 4: Exporting shorts...
   [1/5] 🎬 Turn your ideas into viral videos...
       📤 Creating export... ✅
       ⏳ Waiting for export... ✅
       📥 Downloading... ✅ (5.2 MB)
   ...

======================================================================
✅ WORKFLOW COMPLETE!
======================================================================
📁 Downloaded: 5/5 shorts
📂 Location: /path/to/downloads/shorts/klap_mwJ6KNRr_20251211
🗄️ Database: Updated with 5 clips

🔔 Notification sent!
```
