---
name: longform-video-clone-edit
description: End-to-end longform video cloning pipeline. Downloads YouTube video, transcribes, generates HeyGen avatar chunks, detects PIP vs fullscreen vs noface segments, precisely locates webcam bubbles, composites avatar overlay with lip-synced audio. Handles screen recordings with PIP webcam bubbles and fullscreen talking head.
metadata:
  openclaw:
    emoji: 🎬
    requires:
      envVars: []
      anyBins: ["ffmpeg", "ffprobe", "yt-dlp", "python3"]
      pip: ["opencv-python-headless", "requests"]
---

# Longform Video Clone Pipeline

Clone longform YouTube videos (10-60 min) by replacing the creator's face with a HeyGen avatar. Handles mixed content: fullscreen talking head, screen recordings with PIP webcam bubbles, and no-face segments.

## Key Parameters (per-project)
- **HeyGen Avatar ID**: Set per project
- **HeyGen Voice ID**: Set per project  
- **Working dir**: `~/.openclaw/workspace/face-swap-clone/longform-v2/` (or per-project)

## Working Directory Structure
```
project/
├── source/
│   ├── video.mp4              # Downloaded source video
│   ├── transcript.json        # Whisper word-level transcript
│   ├── chunks.json            # Text chunks for HeyGen (≤4000 chars each)
│   ├── heygen_jobs.json       # HeyGen job IDs
│   ├── classification.json    # Segment classification (pip/fullscreen/noface)
│   └── bubble_bounds.json     # Detected webcam bubble coordinates
├── avatar/
│   ├── chunk_0.mp4 ... chunk_N.mp4  # Downloaded HeyGen outputs
│   ├── avatar_stitched.mp4    # Concatenated avatar chunks
│   └── avatar_sped.mp4        # Speed-matched to source duration
├── segments/                   # Cut video segments (no audio)
├── frames/                     # Extracted frames for analysis
└── renders/                    # Final composited outputs
```

## Pipeline Overview

1. Download source video
2. Transcribe with Whisper (word-level timestamps)
3. Chunk transcript → submit to HeyGen (≤4000 chars per chunk)
4. Poll + download HeyGen chunks
5. Stitch chunks → speed-match to source duration
6. Face detection: classify every second as fullscreen / PIP / noface
7. Detect exact webcam bubble bounds from source pixels
8. Composite: overlay avatar on each segment type
9. Mux avatar audio onto final video (NOT source audio)
10. Compress for delivery

---

## Step 1: Download Source Video

```bash
mkdir -p project/{source,avatar,segments,frames,renders}
yt-dlp -o "source/video.mp4" "YOUTUBE_URL"
ffprobe -v error -show_entries format=duration,stream=width,height,r_frame_rate -of json source/video.mp4
```

## Step 2: Transcribe

Use the `whisper-transcribe` skill or OpenAI Whisper directly:
```bash
whisper source/video.mp4 --model base --output_format json --word_timestamps True
```
Output: `source/transcript.json`

## Step 3: Chunk Transcript for HeyGen

**CRITICAL**: HeyGen has a **4000 character limit** per input. Split transcript into chunks.

```python
import json

transcript = json.load(open("source/transcript.json"))
full_text = transcript["text"]

# Split into ≤3800 char chunks at sentence boundaries
chunks = []
current = ""
for sentence in full_text.replace(". ", ".\n").split("\n"):
    if len(current) + len(sentence) + 1 > 3800:
        chunks.append(current.strip())
        current = sentence
    else:
        current += " " + sentence
if current.strip():
    chunks.append(current.strip())

json.dump(chunks, open("source/chunks.json", "w"))
print(f"{len(chunks)} chunks, max {max(len(c) for c in chunks)} chars")
```

## Step 4: Submit HeyGen Jobs (MCP only)

Do **not** `requests.post("https://api.heygen.com/...")` and do **not** read `HEYGEN_API_KEY`. That bills the API-credit pool (often empty). Use **HeyGen MCP** `create_video` on plan credits:

- `type`: `"avatar"`
- `avatar_id`: look id from the persona wrapper (photo look, not group id)
- `voice_id`: persona voice
- `script`: one chunk (≤3800 chars)
- `aspect_ratio`: `"16:9"`

Save returned video ids to `source/heygen_jobs.json`. Sleep ~2s between chunks.

**Voice**: MCP field is `script` + `voice_id`. Do not send deprecated `"type": "id"`.

## Step 5: Poll + Download Chunks

Poll with MCP `get_video` (not `v1/video_status.get` + API key). When status is completed, HTTP GET the signed `video_url` into `avatar/chunk_{i}.mp4`.

If MCP is unauthenticated, stop. Never fall back to the API key.

**Watchdog**: HeyGen pollers can die silently. Always verify completion.

## Step 6: Stitch + Speed-Match

```bash
# Create concat list
for i in $(seq 0 $((N-1))); do echo "file 'chunk_${i}.mp4'"; done > avatar/concat_list.txt

# Stitch (run from avatar/ directory — paths are relative to list file!)
cd avatar && ffmpeg -y -f concat -safe 0 -i concat_list.txt -c copy avatar_stitched.mp4

# Get durations
SOURCE_DUR=$(ffprobe -v error -show_entries format=duration -of csv=p=0 ../source/video.mp4)
AVATAR_DUR=$(ffprobe -v error -show_entries format=duration -of csv=p=0 avatar_stitched.mp4)

# Speed factor: avatar/source
# If avatar < source → factor < 1 → SLOWS DOWN avatar (stretches it)
# If avatar > source → factor > 1 → SPEEDS UP avatar (compresses it)
FACTOR=$(python3 -c "print(f'{$AVATAR_DUR / $SOURCE_DUR:.6f}')")

ffmpeg -y -i avatar_stitched.mp4 \
    -filter_complex "[0:v]setpts=PTS/${FACTOR}[v];[0:a]atempo=${FACTOR}[a]" \
    -map "[v]" -map "[a]" -r 30 -c:v libx264 -preset fast -crf 18 -c:a aac -b:a 128k \
    avatar_sped.mp4
```

**⚠️ CRITICAL**: Get the speed direction right!
- `avatar < source` → factor < 1 → slows down (stretches)
- `avatar > source` → factor > 1 → speeds up (compresses)
- `atempo` only accepts 0.5-2.0. For extreme values, chain: `atempo=0.5,atempo=0.8`

## Step 7: Face Detection + Segment Classification

Classify every second of the video as one of:
- **fullscreen**: Creator's face is the main content (talking head)
- **pip**: Screen recording with a webcam bubble overlay containing the creator's face
- **noface**: No face detected (B-roll, slides without webcam)

```python
import cv2
import json

cap = cv2.VideoCapture("source/video.mp4")
fps = int(cap.get(cv2.CAP_PROP_FPS))
total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
cc = cv2.CascadeClassifier(cv2.data.haarcascades + 'haarcascade_frontalface_default.xml')

# Sample every 1 second (every fps frames)
classifications = []  # (frame_num, type, face_cx, face_cy, face_w)

for sec in range(0, total_frames // fps):
    frame_num = sec * fps
    cap.set(cv2.CAP_PROP_POS_FRAMES, frame_num)
    ret, frame = cap.read()
    if not ret:
        break
    
    gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
    faces = cc.detectMultiScale(gray, 1.1, 5, minSize=(50, 50))
    
    if len(faces) == 0:
        classifications.append((frame_num, "noface", 0, 0, 0))
    else:
        # Use largest face
        largest = max(faces, key=lambda f: f[2] * f[3])
        x, y, w, h = largest
        cx, cy = x + w // 2, y + h // 2
        
        # Classification: face Y position determines PIP vs fullscreen
        # PIP webcam bubbles are typically in bottom corners (y > 60% of frame)
        # Fullscreen talking head has face more centered
        if cy > height * 0.6 and w < width * 0.3:
            classifications.append((frame_num, "pip", cx, cy, w))
        else:
            classifications.append((frame_num, "fullscreen", cx, cy, w))

cap.release()
```

### Merge into Ranges

```python
# Merge consecutive same-type seconds into ranges
ranges = []
if classifications:
    curr_type = classifications[0][1]
    start_frame = classifications[0][0]
    face_positions = [(classifications[0][2], classifications[0][3])]
    
    for frame_num, seg_type, cx, cy, w in classifications[1:]:
        if seg_type != curr_type:
            # Average face position for this range
            avg_cx = int(sum(p[0] for p in face_positions) / len(face_positions))
            avg_cy = int(sum(p[1] for p in face_positions) / len(face_positions))
            ranges.append({
                "start": start_frame,
                "end": frame_num,
                "type": curr_type,
                "face": [avg_cx, avg_cy] if curr_type != "noface" else None
            })
            curr_type = seg_type
            start_frame = frame_num
            face_positions = [(cx, cy)]
        else:
            face_positions.append((cx, cy))
    
    # Last range
    avg_cx = int(sum(p[0] for p in face_positions) / len(face_positions))
    avg_cy = int(sum(p[1] for p in face_positions) / len(face_positions))
    ranges.append({
        "start": start_frame,
        "end": total_frames,
        "type": curr_type,
        "face": [avg_cx, avg_cy] if curr_type != "noface" else None
    })

# Merge small gaps: absorb noface segments < 8s between same-type ranges
# This dramatically reduces fragmentation
merged = [ranges[0]]
for r in ranges[1:]:
    prev = merged[-1]
    dur_s = (r["end"] - r["start"]) / fps
    if dur_s < 8 and prev["type"] != "noface" and len(merged) > 1:
        # Check if next range after this is same type as prev
        merged[-1]["end"] = r["end"]  # absorb
    else:
        merged.append(r)

json.dump(merged, open("source/classification.json", "w"), indent=2)
```

## Step 8: Detect Webcam Bubble Bounds (CRITICAL FOR PIP)

For PIP segments, find the **exact pixel boundaries** of the webcam bubble in the source video. Do NOT estimate — detect from actual frames.

```python
import cv2
import numpy as np

def detect_bubble_bounds(source_path, face_cx, face_cy, fps):
    """Detect exact webcam bubble boundaries around a known face position."""
    cap = cv2.VideoCapture(source_path)
    # Seek to a frame where this face position is active
    # ... (use classification data to find appropriate timestamp)
    
    ret, frame = cap.read()
    h, w = frame.shape[:2]
    
    # Scan outward from face center to find bubble edges
    # Left edge: scan left from face, find bright→dark transition
    left_edge = face_cx
    for x in range(face_cx, max(face_cx - 500, 0), -1):
        if frame[face_cy, x, :].mean() > 230 and frame[face_cy, min(x+5, w-1), :].mean() < 200:
            left_edge = x + 1
            break
    
    # Right edge
    right_edge = face_cx
    for x in range(face_cx, min(face_cx + 500, w)):
        if frame[face_cy, x, :].mean() > 230:
            right_edge = x - 1
            break
    
    # Top edge: scan up from face center
    top_edge = face_cy
    for y in range(face_cy, max(face_cy - 400, 0), -1):
        curr = frame[y, face_cx, :].mean()
        prev = frame[y-1, face_cx, :].mean()
        if curr < 200 and prev > 220:
            top_edge = y
            break
    
    # Bottom edge
    bottom_edge = min(face_cy + 200, h)
    for y in range(h - 1, face_cy, -1):
        if frame[y, face_cx, :].mean() > 230:
            bottom_edge = y
            break
    
    cap.release()
    return {
        "x": left_edge,
        "y": top_edge, 
        "w": right_edge - left_edge,
        "h": bottom_edge - top_edge
    }
```

**Key insight**: Webcam bubbles in screen recordings are typically:
- Bottom-left or bottom-right corner
- Rounded rectangles with subtle shadow/border
- Consistent size throughout the video (~389x292 in 1080p)
- Face position (left vs right) may change during the video

Sample multiple PIP frames to verify bubble position consistency and detect left/right switches.

## Step 9: Detect Avatar Face Position

```python
import cv2

cc = cv2.CascadeClassifier(cv2.data.haarcascades + 'haarcascade_frontalface_default.xml')
cap = cv2.VideoCapture("avatar/avatar_sped.mp4")

# Sample multiple frames to get stable face center
positions = []
for t in [30, 60, 120, 180]:
    cap.set(cv2.CAP_PROP_POS_MSEC, t * 1000)
    ret, frame = cap.read()
    if not ret: continue
    gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
    faces = cc.detectMultiScale(gray, 1.1, 5, minSize=(100, 100))
    if len(faces) > 0:
        largest = max(faces, key=lambda f: f[2] * f[3])
        x, y, w, h = largest
        positions.append((x + w//2, y + h//2, w, h))

avg_cx = int(sum(p[0] for p in positions) / len(positions))
avg_cy = int(sum(p[1] for p in positions) / len(positions))
avg_w = int(sum(p[2] for p in positions) / len(positions))
avg_h = int(sum(p[3] for p in positions) / len(positions))

# Avatar crop: centered on face, proportional to bubble aspect ratio
# For bubble W:H ratio, crop avatar at same ratio
CROP_W = int(avg_w * 2.0)  # ~2x face width
CROP_H = int(CROP_W * bubble_h / bubble_w)  # Match bubble aspect ratio
CROP_X = avg_cx - CROP_W // 2
CROP_Y = avg_cy - CROP_H // 2
```

## Step 10: Build Composite

**⚠️ CRITICAL**: All segments rendered WITHOUT audio (`-an`). Avatar audio muxed at the very end. This ensures lip sync is perfect.

```bash
#!/bin/bash
set -e

SOURCE="source/video.mp4"
AVATAR="avatar/avatar_sped.mp4"

# Read classification.json and bubble_bounds.json
# For each range:

for each range in classification:
    case $type in
        "fullscreen")
            # Use raw avatar frame (no crop/scale — avoids warp distortion)
            ffmpeg -y -ss $start -t $dur -i "$AVATAR" \
                -c:v libx264 -preset fast -crf 18 -an -f mpegts \
                segments/seg_${i}.ts
            ;;
        "pip")
            # Overlay cropped avatar onto exact webcam bubble position
            ffmpeg -y -ss $start -t $dur -i "$SOURCE" -ss $start -t $dur -i "$AVATAR" \
                -filter_complex \
                "[1:v]crop=${CROP_W}:${CROP_H}:${CROP_X}:${CROP_Y},scale=${BUB_W}:${BUB_H}[pip];
                 [0:v][pip]overlay=${BUB_X}:${BUB_Y}[out]" \
                -map "[out]" -c:v libx264 -preset fast -crf 18 -an -f mpegts \
                segments/seg_${i}.ts
            ;;
        "noface")
            # Passthrough source video (no modification)
            ffmpeg -y -ss $start -t $dur -i "$SOURCE" \
                -c:v libx264 -preset fast -crf 18 -an -f mpegts \
                segments/seg_${i}.ts
            ;;
    esac
done

# Concatenate all segments (video only, no audio)
ffmpeg -y -f concat -safe 0 -i concat_list.txt -c copy renders/nosound.mp4

# Mux AVATAR audio (NOT source audio — this is what makes lip sync work)
ffmpeg -y -i renders/nosound.mp4 -i avatar/avatar_sped.mp4 \
    -map 0:v -map 1:a -c:v copy -c:a aac -shortest \
    renders/final_clone.mp4
```

### Why Avatar Audio?
The avatar's lip movements are synced to the avatar's generated speech. Using source audio would create a mismatch because HeyGen generates speech at different pacing than the original. Speed-matching gets the total duration right, but micro-timing still differs. Avatar audio = perfect lip sync.

## Step 11: Compress for Delivery

```bash
# Telegram (16MB limit for 32-min video)
ffmpeg -y -i renders/final_clone.mp4 -vf "scale=360:-2" \
    -c:v libx264 -crf 40 -preset fast -c:a aac -b:a 32k \
    renders/telegram_preview.mp4

# Higher quality preview (640p)
ffmpeg -y -i renders/final_clone.mp4 -vf "scale=640:-2" \
    -c:v libx264 -crf 28 -preset fast -c:a aac -b:a 64k \
    renders/preview_640p.mp4
```

---

## Critical Lessons Learned

### Speed-Match Direction
- `avatar_duration / source_duration` = factor
- Factor < 1 → avatar is shorter → **slow down** (stretch)
- Factor > 1 → avatar is longer → **speed up** (compress)
- Got this wrong = completely wrong duration. Verify output duration after!

### ffmpeg Concat Paths
- Paths in concat list files are **relative to the list file**, NOT cwd
- Run ffmpeg from the same directory as the list file, or use absolute paths
- Use `-f concat -safe 0` (not pipe concat — causes moov atom issues)

### HeyGen Gotchas
- 4000 char limit per input — must chunk
- Voice type: `"type": "text"` (not `"type": "id"`)
- Pollers die silently — always verify with watchdog/cron
- Check for "Insufficient credit" errors on failures
- Typical processing: 10-20 min per chunk

### PIP Detection
- Position-based: face Y > 60% of frame height + face width < 30% of frame width = PIP
- Dense 1-second scanning (every fps frames) catches transitions
- Merge small gaps (<8s) between same-type ranges to reduce fragmentation
- Webcam bubble position (left/right) can change mid-video — detect per-range

### Webcam Bubble Detection  
- Do NOT estimate bubble size — detect exact pixel boundaries
- Scan outward from known face center for brightness transitions
- Typical bubble: ~389x292 in 1080p, bottom corner, rounded rectangle
- Bubble extends to frame edge on the bottom and side

### Audio
- **Always use avatar audio, never source audio** for the final render
- Render all video segments with `-an` (no audio)
- Mux avatar audio as final step with `-map 0:v -map 1:a`
- This is THE key to lip sync

### Fullscreen Segments
- Use raw avatar frame — do NOT crop and rescale to 1920x1080
- Cropping 800x550 and scaling to 1920x1080 causes horizontal warp distortion
- The avatar is already rendered at the correct resolution

### Fire-and-Forget for Long Encodes
- Long ffmpeg encodes (30+ min video): use `nohup bash script.sh &`
- Monitor with cron jobs polling for file existence / completion markers
- Never block the main agent session on a 15-min encode
