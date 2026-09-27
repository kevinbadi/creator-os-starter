"""
YouTube to HeyGen Long-Form Avatar Video Agent

Converts YouTube videos into long-form avatar videos using your HeyGen clone.
Flow: YouTube URL → Gemini extracts full script → Condense to 2500 words max → HeyGen avatar video

Usage:
    python3 implementation/youtube_to_heygen_longform.py "https://youtube.com/watch?v=VIDEO_ID"

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

# Max words for long-form video
MAX_WORDS = 2000

# ============================================================================
# ALEX HORMOZI LONG-FORM SCRIPT PROMPT
# ============================================================================

SCRIPT_EXTRACTION_PROMPT = """**** STYLE

Role: You are a professional content marketing copywriter. Your goal is to analyze and rewrite the provided video into a long form video script, in the tone of business influencer Alex Hormozi. YOUR SCRIPT OUTPUT MUST BE EXACTLY 2000 WORDS. This is critical - aim for precisely 2000 words to maximize video length.

Alex Hormozis tone and style

Alex Hormozi Script Writing Agent - System Prompt
You are an expert script writing agent specializing in Alex Hormozi's distinctive copywriting style for long-form content. Your task is to analyze YouTube videos and create compelling scripts that capture Hormozi's unique approach to persuasive communication.
Core Principles of Hormozi's Style, while also making sure we talk about the similar stuff that the original video was talking about
1. HOOK Structure

Pattern Interrupt: Start with a bold, contrarian statement or shocking claim. What the tool/concept/news I am describing/teaching, as well as a promise of what they will learn by watching this video
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
Opening

Hook with pattern interrupt
Preview the core insight
Establish credibility quickly

Body (Middle 60-70%)

ONE core concept explained thoroughly
2-3 supporting points maximum
Each point needs: explanation → example → application
Use metaphors from business, physics, or everyday life

Close

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

Compelling hook
Clear value proposition
Core teaching moment (60-70% of script)
Strong close with CTA


Apply Hormozi's voice:

Direct, assertive language
Specific numbers and timeframes
Personal credibility markers
Logical progression from problem to solution


Remember: Hormozi's power comes from clarity, specificity, and logical inevitability. Every word should move the viewer closer to believing the transformation is possible and necessary.


be blunt: Use short, punchy sentances. Avoid fancy vocabulary. and alter the system prompt to satisfy the niche we are creating content in which is AI technology, saas, AI agents, etc.


YOUR OUTPUT SHOULD ONLY BE THE SCRIPT. NOTHING ELSE. ONLY OUTPUT THE NEW SCRIPT. Dont even add the words "hook or the time of each section because we need to directly send this script to another node. so your output needs to literlly JUST be the script. Dont add [HOOK] [BODY] [CLOSE]. and DO NOT ADD the time each section takes PLEASE


YOUR CLOSING CTA SHOULD ALWAYS BE A DROP A COMMENT CTA. EXAMPLE: if the script is talking about a new Gemini 3 workflow, then the CTA should be something like "COMMENT GEMINI, and ill send over a free agent blueprint for you to get started"

THE OUTPUT NEEDS TO ONLY BE THE TEXT DO NOT ADD /n because the workflow wont work if you do.

CRITICAL: YOUR SCRIPT MUST BE EXACTLY 2000 WORDS. Not less, not more. Count your words and ensure you hit 2000 words. This is essential for video length optimization.
"""

CONDENSE_PROMPT = """Take this script and edit it to be EXACTLY {max_words} words. Not less, not more.

{script}

Only output the new video script at exactly {max_words} words. No syntax or markdown please do not include any /n md syntax at all. Just the words of the script."""

# ============================================================================
# GEMINI: EXTRACT SCRIPT FROM YOUTUBE
# ============================================================================

def extract_script_from_youtube(youtube_url: str) -> str:
    """
    Use Gemini to analyze YouTube video and extract full Alex Hormozi-style script.
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

    word_count = len(script.split())
    print(f"✅ Full script extracted ({len(script)} characters, ~{word_count} words)")
    return script


def condense_script(script: str, max_words: int = MAX_WORDS) -> str:
    """
    Use Gemini to condense the script to max words.
    """
    try:
        from google import genai
    except ImportError:
        print("ERROR: google-genai not installed")
        sys.exit(1)

    word_count = len(script.split())

    if word_count <= max_words:
        print(f"✅ Script already under {max_words} words ({word_count} words)")
        return script

    print(f"📝 Condensing script from {word_count} to max {max_words} words...")

    client = genai.Client(api_key=GEMINI_API_KEY)

    response = client.models.generate_content(
        model=GEMINI_MODEL,
        contents=CONDENSE_PROMPT.format(max_words=max_words, script=script)
    )

    condensed = response.text.strip()

    # Clean up any markdown artifacts
    condensed = condensed.replace('\\n', ' ').replace('\n\n', ' ').replace('\n', ' ')

    new_word_count = len(condensed.split())
    print(f"✅ Script condensed ({new_word_count} words)")
    return condensed

# ============================================================================
# HEYGEN: GENERATE AVATAR VIDEO
# ============================================================================

# HeyGen has a 5000 character limit per video_input
HEYGEN_CHAR_LIMIT = 4800  # Leave buffer for safety


def split_script_into_segments(script: str, max_chars: int = HEYGEN_CHAR_LIMIT) -> list:
    """
    Split a long script into segments that fit within HeyGen's character limit.
    Splits at sentence boundaries to maintain natural flow.
    """
    if len(script) <= max_chars:
        return [script]

    segments = []
    current_segment = ""

    # Split by sentences (period followed by space or end)
    sentences = []
    temp = ""
    for char in script:
        temp += char
        if char in '.!?' and len(temp) > 1:
            sentences.append(temp)
            temp = ""
    if temp.strip():
        sentences.append(temp)

    for sentence in sentences:
        # If adding this sentence would exceed limit, start new segment
        if len(current_segment) + len(sentence) > max_chars:
            if current_segment.strip():
                segments.append(current_segment.strip())
            current_segment = sentence
        else:
            current_segment += sentence

    # Add final segment
    if current_segment.strip():
        segments.append(current_segment.strip())

    return segments


def create_heygen_video(script: str) -> str:
    """
    Create a long-form video using HeyGen avatar with Excited emotion.
    Landscape 1920x1080 with black background.

    For scripts over 5000 characters, splits into multiple video_inputs
    that HeyGen will concatenate into a single video.
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

    word_count = len(script.split())
    estimated_minutes = word_count / 150  # ~150 words per minute speaking

    print(f"🤖 Creating HeyGen long-form avatar video...")
    print(f"   Avatar: {HEYGEN_AVATAR_ID}")
    print(f"   Voice: {HEYGEN_VOICE_ID}")
    print(f"   Emotion: Excited")
    print(f"   Dimension: 1920x1080 (landscape)")
    print(f"   Estimated length: ~{estimated_minutes:.1f} minutes")

    # Split script into segments if needed
    segments = split_script_into_segments(script)

    if len(segments) > 1:
        print(f"   Script split into {len(segments)} segments (HeyGen 5000 char limit)")
        for i, seg in enumerate(segments):
            print(f"      Segment {i+1}: {len(seg)} chars")

    url = "https://api.heygen.com/v2/video/generate"

    # Build video_inputs for each segment
    video_inputs = []
    for segment in segments:
        video_inputs.append({
            "character": {
                "type": "avatar",
                "avatar_id": HEYGEN_AVATAR_ID,
                "avatar_style": "normal"
            },
            "voice": {
                "type": "text",
                "input_text": segment,
                "voice_id": HEYGEN_VOICE_ID,
                "emotion": "Excited"
            },
            "background": {
                "type": "color",
                "value": "#000000"
            }
        })

    payload = {
        "video_inputs": video_inputs,
        "dimension": {
            "width": 1920,
            "height": 1080
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


def poll_video_status(video_id: str, max_wait: int = 1800) -> dict:
    """
    Poll HeyGen for video completion status.
    Long-form videos can take 15-30 minutes.
    """
    url = f"https://api.heygen.com/v1/video_status.get?video_id={video_id}"

    headers = {
        "Accept": "application/json",
        "x-api-key": HEYGEN_API_KEY
    }

    print("⏳ Waiting for video generation (this may take 15-30 minutes for long-form)", end="", flush=True)

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
            time.sleep(30)  # Poll every 30 seconds for long-form
        else:
            print(f"\n⚠️  Unknown status: {status}")
            time.sleep(30)

    print("\n❌ Timeout waiting for video generation")
    raise Exception("Video generation timeout")

# ============================================================================
# DATABASE STORAGE (youtube_long_form_heygen table)
# ============================================================================

def store_in_database(youtube_url: str, video_url: str) -> int:
    """
    Store generated video info in youtube_long_form_heygen table.
    """
    if not DATABASE_URL:
        print("⚠️  DATABASE_URL not set - skipping database storage")
        return None

    try:
        import psycopg2
    except ImportError:
        print("⚠️  psycopg2 not installed - skipping database storage")
        return None

    print("💾 Storing in database (youtube_long_form_heygen)...")

    try:
        conn = psycopg2.connect(DATABASE_URL)
        cur = conn.cursor()

        # Create table if not exists (matching n8n schema)
        cur.execute("""
            CREATE TABLE IF NOT EXISTS youtube_long_form_heygen (
                id SERIAL PRIMARY KEY,
                original_youtube_url TEXT NOT NULL,
                raw_heygen_video_url TEXT,
                final_edited_video_url TEXT,
                created_at TIMESTAMP DEFAULT NOW()
            )
        """)

        cur.execute("""
            INSERT INTO youtube_long_form_heygen
            (original_youtube_url, raw_heygen_video_url, created_at)
            VALUES (%s, %s, %s)
            RETURNING id
        """, (youtube_url, video_url, datetime.utcnow()))

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

def process_youtube_to_longform(youtube_url: str, max_words: int = MAX_WORDS, wait_for_video: bool = True) -> dict:
    """
    Main workflow: YouTube URL → Full Script → Condensed Script → HeyGen Long-Form Video

    Args:
        youtube_url: YouTube video URL
        max_words: Maximum words for script (default 2500)
        wait_for_video: Whether to wait for video completion

    Returns:
        Dict with video details
    """
    print("\n" + "="*60)
    print("🎬 YOUTUBE TO HEYGEN LONG-FORM VIDEO")
    print("="*60)
    print(f"YouTube URL: {youtube_url}")
    print(f"Max Words: {max_words}")
    print()

    try:
        # Step 1: Extract full script from YouTube video
        full_script = extract_script_from_youtube(youtube_url)

        print("\n" + "-"*40)
        print("📝 FULL SCRIPT (preview):")
        print("-"*40)
        print(full_script[:500] + "..." if len(full_script) > 500 else full_script)
        print("-"*40 + "\n")

        # Step 2: Condense script to max words
        script = condense_script(full_script, max_words)

        print("\n" + "-"*40)
        print(f"📝 CONDENSED SCRIPT ({len(script.split())} words, preview):")
        print("-"*40)
        print(script[:500] + "..." if len(script) > 500 else script)
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
        row_id = store_in_database(youtube_url, video_url)

        return {
            "success": True,
            "youtube_url": youtube_url,
            "script": script,
            "word_count": len(script.split()),
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
        description="Convert YouTube videos to HeyGen long-form avatar videos"
    )
    parser.add_argument(
        "url",
        help="YouTube video URL"
    )
    parser.add_argument(
        "--max-words",
        "-m",
        type=int,
        default=MAX_WORDS,
        help=f"Maximum words for script (default: {MAX_WORDS})"
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
    result = process_youtube_to_longform(
        youtube_url=args.url,
        max_words=args.max_words,
        wait_for_video=not args.no_wait
    )

    sys.exit(0 if result["success"] else 1)


if __name__ == "__main__":
    main()
