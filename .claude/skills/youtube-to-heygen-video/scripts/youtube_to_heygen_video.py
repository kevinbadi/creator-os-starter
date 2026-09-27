"""
YouTube to HeyGen Avatar Video Agent

Converts YouTube videos into short-form avatar videos using your HeyGen clone.
Flow: YouTube URL → Gemini extracts Alex Hormozi-style script → Generate caption → HeyGen avatar video

Usage:
    python3 implementation/youtube_to_heygen_video.py "https://youtube.com/watch?v=VIDEO_ID"

Environment Variables:
    GEMINI_API_KEY - Google Gemini API key
    HEYGEN_API_KEY - HeyGen API key
    HEYGEN_AVATAR_ID - Your avatar ID
    HEYGEN_VOICE_ID - Your voice clone ID
    DATABASE_URL - PostgreSQL connection string
"""

import os
import sys
import argparse
import time
import requests
from datetime import datetime
from dotenv import load_dotenv

# Add parent directory to path for imports
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

# Load environment variables
load_dotenv()
parent_env = os.path.join(os.path.dirname(os.path.dirname(__file__)), '.env')
if os.path.exists(parent_env):
    load_dotenv(parent_env)

# ============================================================================
# CONFIGURATION
# ============================================================================

GEMINI_API_KEY = os.getenv('GEMINI_API_KEY')
HEYGEN_API_KEY = os.getenv('HEYGEN_API_KEY')
HEYGEN_AVATAR_ID = os.getenv('HEYGEN_AVATAR_ID')
HEYGEN_VOICE_ID = os.getenv('HEYGEN_VOICE_ID')
DATABASE_URL = os.getenv('DATABASE_URL')

GEMINI_MODEL = "gemini-2.0-flash"

# ============================================================================
# ALEX HORMOZI STYLE SCRIPT PROMPT (from n8n workflow)
# ============================================================================

SCRIPT_EXTRACTION_PROMPT = """**** STYLE

Role: You are a professional content marketing copywriter. Your goal is to analyze and rewrite the provided video into a 60 second video script, in the tone of business influencer Alex Hormozi 180 words equates to 1 min of talking on average so aim for that.

Alex Hormozis tone and style

Alex Hormozi Script Writing Agent - System Prompt
You are an expert script writing agent specializing in Alex Hormozi's distinctive copywriting style for short-form content. Your task is to analyze YouTube videos and create compelling scripts that capture Hormozi's unique approach to persuasive communication.
Core Principles of Hormozi's Style, while also making sure we talk about the similar stuff that the original video was talking about
1. HOOK Structure (First 3-5 seconds)

Pattern Interrupt: Start with a bold, contrarian statement or shocking claim.
Value Declaration: Immediately tell viewers what they'll gain
Problem Agitation: Hit a pain point that creates urgency
Examples of hook patterns:

"Everyone tells you X, but here's why that's bankrupting you..."
"I made $X doing the opposite of what gurus teach..."
"The reason you're failing at X has nothing to do with X..."



2. Content Architecture
A. The "Value Ladder" Approach

Start with the END result (the transformation)
Work backwards to show the gap between current state and desired state
Present the solution as inevitable logic, not opinion

B. The "Bridge Framework"

Where you are (current painful reality)
Where you want to be (desired outcome with specifics)
What's blocking you (the real obstacle, not the obvious one)
The bridge (your core insight/method)

3. Language Patterns
Directness & Clarity

Use simple, punchy sentences
Avoid jargon unless immediately defined
Speak in concrete numbers and specific examples
Replace vague terms with precise metrics

Authority Markers

Reference personal experience with specific numbers ("When I scaled from $0 to $100M...")
Use case studies with real results
Acknowledge common objections before they arise

Rhythmic Delivery

Short sentence. Longer explanatory sentence. Short punch.
Use of "And here's why:" or "Here's the thing:" as transition phrases
Strategic repetition of key concepts in different words

4. Persuasion Mechanics
The "Logical Stack"

Present an accepted truth
Show why conventional wisdom fails
Introduce the counter-intuitive insight
Prove it with logic + evidence
Show the application

Objection Handling

"You might be thinking..." (preemptively address doubts)
"Now, I know what you're saying..." (validate then redirect)
Use the "Yes, and" structure rather than "Yes, but"

Value Amplification

Break down abstract concepts into tangible ROI
Use time comparisons ("This one thing will save you 6 months...")
Show the compounding effect over time

5. Structural Elements
Opening (First 15 seconds)

Hook with pattern interrupt
Preview the core insight
Establish credibility quickly

Body (Middle 60-70%)

ONE core concept explained thoroughly
2-3 supporting points maximum
Each point needs: explanation → example → application
Use metaphors from business, physics, or everyday life

Close (Final 15-20 seconds)

Restate the transformation in different words
Create urgency or consequence for inaction
Simple, clear call-to-action

6. Tonal Characteristics

Confident without arrogance: "I know this works because..."
Educational intensity: Teaching with urgency
No fluff: Every sentence serves the argument
Conversational authority: Like explaining to a friend, but you're the expert
Outcome-obsessed: Always tie back to results

7. Content Frameworks to Apply
The "Grand Slam Offer" Structure

Dream outcome
Perceived likelihood of achievement
Time delay reduction
Effort and sacrifice minimization

lastly, remove the /n markdown from the output script. It must be just the words the avatar will read in the script, because if we leave the /n md stuff, then it is not going to sound nice
The "Value Equation"

What you get (value) / What you pay (cost + time + effort + sacrifice)

The "Lead Domino"

Identify the ONE belief that, if changed, makes everything else easier

Your Process

Analyze the input video for:

Core topic/transformation being discussed
Key data points, stories, or proof elements
Target audience pain points
Unique angles or insights


Structure your script using:

Compelling hook (3-5 seconds)
Clear value proposition (next 10 seconds)
Core teaching moment (60-70% of script)
Strong close with CTA (final 15-20 seconds)


Apply Hormozi's voice:

Direct, assertive language
Specific numbers and timeframes
Personal credibility markers
Logical progression from problem to solution


be blunt: Use short, punchy sentances. Avoid fancy vocabulary. and alter the system prompt to satisfy the niche we are creating content in which is AI technology, saas, AI agents, etc.


YOUR OUTPUT SHOULD ONLY BE THE SCRIPT. NOTHING ELSE. ONLY OUTPUT THE NEW SCRIPT. Dont even add the words "hook or the time of each section because we need to directly send this script to another node. so your output needs to literlly JUST be the script. Dont add [HOOK] [BODY] [CLOSE]. and DO NOT ADD the time each section takes PLEASE


YOUR CLOSING CTA SHOULD ALWAYS BE A DROP A COMMENT CTA. EXAMPLE: if the script is talking about a new Gemini 3 workflow, then the CTA should be something like "COMMENT GEMINI, and ill send over a free agent blueprint for you to get started"
"""

CAPTION_PROMPT = """You are going to get a video script. Your goal is to turn the video script into a social media post caption that will go along with the video.

The caption should be:
- SEO and keyword rich
- Include relevant hashtags
- End with the same comment CTA as the video script you're receiving

Your output should ONLY be the caption text. No markdown, no syntax, nothing other than the caption text.

Here is the script:
{script}"""

# ============================================================================
# GEMINI: EXTRACT SCRIPT FROM YOUTUBE
# ============================================================================

def extract_script_from_youtube(youtube_url: str) -> str:
    """
    Use Gemini to analyze YouTube video and extract Alex Hormozi-style script.
    """
    try:
        from google import genai
        from google.genai import types
    except ImportError:
        print("ERROR: google-genai not installed. Run: pip install google-genai")
        sys.exit(1)

    if not GEMINI_API_KEY:
        print("ERROR: GEMINI_API_KEY not found in environment variables")
        sys.exit(1)

    print(f"🎥 Analyzing YouTube video with Gemini...")
    print(f"   URL: {youtube_url}")

    client = genai.Client(api_key=GEMINI_API_KEY)

    response = client.models.generate_content(
        model=GEMINI_MODEL,
        contents=types.Content(
            parts=[
                types.Part(
                    file_data=types.FileData(file_uri=youtube_url)
                ),
                types.Part(text=SCRIPT_EXTRACTION_PROMPT)
            ]
        )
    )

    script = response.text.strip()

    # Clean up any markdown artifacts
    script = script.replace('\\n', ' ').replace('\n\n', ' ').replace('\n', ' ')

    print(f"✅ Script extracted ({len(script)} characters, ~{len(script.split())} words)")
    return script


def generate_caption(script: str) -> str:
    """
    Use Gemini to generate a social media caption from the script.
    """
    try:
        from google import genai
    except ImportError:
        print("ERROR: google-genai not installed")
        sys.exit(1)

    print(f"📝 Generating social media caption...")

    client = genai.Client(api_key=GEMINI_API_KEY)

    response = client.models.generate_content(
        model=GEMINI_MODEL,
        contents=CAPTION_PROMPT.format(script=script)
    )

    caption = response.text.strip()
    print(f"✅ Caption generated ({len(caption)} characters)")
    return caption

# ============================================================================
# HEYGEN: GENERATE AVATAR VIDEO
# ============================================================================

def create_heygen_video(script: str) -> str:
    """
    Create a video using HeyGen avatar with Excited emotion.
    Landscape 1920x1080 with black background.
    """
    if not HEYGEN_API_KEY:
        print("ERROR: HEYGEN_API_KEY not found")
        sys.exit(1)
    if not HEYGEN_AVATAR_ID:
        print("ERROR: HEYGEN_AVATAR_ID not found")
        sys.exit(1)
    if not HEYGEN_VOICE_ID:
        print("ERROR: HEYGEN_VOICE_ID not found")
        sys.exit(1)

    print(f"🤖 Creating HeyGen avatar video...")
    print(f"   Avatar: {HEYGEN_AVATAR_ID}")
    print(f"   Voice: {HEYGEN_VOICE_ID}")
    print(f"   Emotion: Excited")
    print(f"   Dimension: 1080x1920 (vertical/shorts)")

    url = "https://api.heygen.com/v2/video/generate"

    payload = {
        "video_inputs": [
            {
                "character": {
                    "type": "avatar",
                    "avatar_id": HEYGEN_AVATAR_ID,
                    "avatar_style": "normal"
                },
                "voice": {
                    "type": "text",
                    "input_text": script,
                    "voice_id": HEYGEN_VOICE_ID,
                    "emotion": "Excited"
                },
                "background": {
                    "type": "color",
                    "value": "#000000"
                }
            }
        ],
        "dimension": {
            "width": 1080,
            "height": 1920
        }
    }

    headers = {
        "accept": "application/json",
        "content-type": "application/json",
        "x-api-key": HEYGEN_API_KEY
    }

    response = requests.post(url, json=payload, headers=headers)

    if response.status_code != 200:
        print(f"❌ HeyGen API error: {response.status_code}")
        print(f"   Response: {response.text}")
        raise Exception(f"HeyGen API error: {response.text}")

    data = response.json()

    if data.get("error"):
        raise Exception(f"HeyGen error: {data['error']}")

    video_id = data.get("data", {}).get("video_id")
    print(f"✅ Video generation started (ID: {video_id})")

    return video_id


def poll_video_status(video_id: str, max_wait: int = 600) -> dict:
    """
    Poll HeyGen for video completion status.
    """
    url = f"https://api.heygen.com/v1/video_status.get?video_id={video_id}"

    headers = {
        "Accept": "application/json",
        "x-api-key": HEYGEN_API_KEY
    }

    print("⏳ Waiting for video generation", end="", flush=True)

    start_time = time.time()
    while time.time() - start_time < max_wait:
        response = requests.get(url, headers=headers)
        data = response.json()

        status = data.get("data", {}).get("status")

        if status == "completed":
            print("\n✅ Video generation complete!")
            return data.get("data", {})
        elif status == "failed":
            error = data.get("data", {}).get("error", "Unknown error")
            print(f"\n❌ Video generation failed: {error}")
            raise Exception(f"Video generation failed: {error}")
        elif status in ["pending", "processing"]:
            print(".", end="", flush=True)
            time.sleep(10)
        else:
            print(f"\n⚠️  Unknown status: {status}")
            time.sleep(10)

    print("\n❌ Timeout waiting for video generation")
    raise Exception("Video generation timeout")

# ============================================================================
# DATABASE STORAGE (gemini_video_agent table)
# ============================================================================

def store_in_database(youtube_url: str, video_url: str, caption: str) -> int:
    """
    Store generated video info in gemini_video_agent table.
    """
    if not DATABASE_URL:
        print("⚠️  DATABASE_URL not set - skipping database storage")
        return None

    try:
        import psycopg2
    except ImportError:
        print("⚠️  psycopg2 not installed - skipping database storage")
        return None

    print("💾 Storing in database (gemini_video_agent)...")

    try:
        conn = psycopg2.connect(DATABASE_URL)
        cur = conn.cursor()

        # Create table if not exists (matching n8n schema)
        cur.execute("""
            CREATE TABLE IF NOT EXISTS gemini_video_agent (
                id SERIAL PRIMARY KEY,
                original_youtube_url TEXT NOT NULL,
                raw_heygen_video_url TEXT,
                final_edited_video_url TEXT,
                post_caption TEXT,
                created_at TIMESTAMP DEFAULT NOW()
            )
        """)

        cur.execute("""
            INSERT INTO gemini_video_agent
            (original_youtube_url, raw_heygen_video_url, post_caption, created_at)
            VALUES (%s, %s, %s, %s)
            RETURNING id
        """, (youtube_url, video_url, caption, datetime.utcnow()))

        row_id = cur.fetchone()[0]
        conn.commit()
        cur.close()
        conn.close()

        print(f"✅ Stored in database (ID: {row_id})")
        return row_id

    except Exception as e:
        print(f"❌ Database error: {e}")
        return None

# ============================================================================
# MAIN WORKFLOW
# ============================================================================

def process_youtube_to_avatar(youtube_url: str, wait_for_video: bool = True) -> dict:
    """
    Main workflow: YouTube URL → Script → Caption → HeyGen Avatar Video

    Args:
        youtube_url: YouTube video URL
        wait_for_video: Whether to wait for video completion

    Returns:
        Dict with video details
    """
    print("\n" + "="*60)
    print("🎬 YOUTUBE TO HEYGEN AVATAR VIDEO")
    print("="*60)
    print(f"YouTube URL: {youtube_url}")
    print()

    try:
        # Step 1: Extract script from YouTube video (Alex Hormozi style)
        script = extract_script_from_youtube(youtube_url)

        print("\n" + "-"*40)
        print("📝 EXTRACTED SCRIPT:")
        print("-"*40)
        print(script[:500] + "..." if len(script) > 500 else script)
        print("-"*40 + "\n")

        # Step 2: Generate social media caption
        caption = generate_caption(script)

        print("\n" + "-"*40)
        print("📱 SOCIAL MEDIA CAPTION:")
        print("-"*40)
        print(caption[:300] + "..." if len(caption) > 300 else caption)
        print("-"*40 + "\n")

        # Step 3: Create HeyGen video
        video_id = create_heygen_video(script)

        # Step 4: Wait for completion
        video_url = None
        if wait_for_video:
            video_data = poll_video_status(video_id)
            video_url = video_data.get("video_url")

            print("\n" + "="*60)
            print("🎉 VIDEO READY!")
            print("="*60)
            print(f"Video URL: {video_url}")
            print("="*60)

        # Step 5: Store in database
        row_id = store_in_database(youtube_url, video_url, caption)

        return {
            "success": True,
            "youtube_url": youtube_url,
            "script": script,
            "caption": caption,
            "video_id": video_id,
            "video_url": video_url,
            "database_id": row_id
        }

    except Exception as e:
        print(f"\n❌ ERROR: {e}")
        import traceback
        traceback.print_exc()
        return {
            "success": False,
            "youtube_url": youtube_url,
            "error": str(e)
        }

# ============================================================================
# CLI ENTRY POINT
# ============================================================================

def main():
    parser = argparse.ArgumentParser(
        description="Convert YouTube videos to HeyGen avatar videos (Alex Hormozi style)"
    )
    parser.add_argument(
        "url",
        help="YouTube video URL"
    )
    parser.add_argument(
        "--no-wait",
        action="store_true",
        help="Don't wait for video completion (just start generation)"
    )

    args = parser.parse_args()

    # Validate URL
    if "youtube.com" not in args.url and "youtu.be" not in args.url:
        print("⚠️  Warning: URL doesn't look like a YouTube link")

    # Run workflow
    result = process_youtube_to_avatar(
        youtube_url=args.url,
        wait_for_video=not args.no_wait
    )

    sys.exit(0 if result["success"] else 1)


if __name__ == "__main__":
    main()
