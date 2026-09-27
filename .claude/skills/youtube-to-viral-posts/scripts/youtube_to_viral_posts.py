"""
YouTube to Viral Posts Agent

Converts YouTube videos into viral Twitter/LinkedIn posts using Gemini AI.
Gemini analyzes YouTube URLs directly - no download needed.

Usage:
    python3 implementation/youtube_to_viral_posts.py "https://youtube.com/watch?v=VIDEO_ID"
    python3 implementation/youtube_to_viral_posts.py "https://youtube.com/watch?v=VIDEO_ID" --cta-keyword "AGENT"

Environment Variables:
    GEMINI_API_KEY - Google Gemini API key
    DATABASE_URL - PostgreSQL connection string

Database Table: youtube_social_post
    - id (SERIAL)
    - original_youtube_url (TEXT)
    - twitter_linkedin_post (TEXT)
    - created_at (TIMESTAMP)
"""

import os
import sys
import argparse
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
DATABASE_URL = os.getenv('DATABASE_URL')

# Gemini model - use flash for speed, pro for quality
GEMINI_MODEL = "gemini-2.0-flash"

# ============================================================================
# SYSTEM PROMPT (from n8n workflow)
# ============================================================================

VIRAL_POST_PROMPT = """**** STYLE

Role: You are a professional content marketing copywriter. Your goal is to analyze and rewrite the provided video into a viral twitter/linkedin post that catches the attention of the viewer, and educates them. the goal of these posts it to create a CTA for the viewer to drop a comment to receive an educational resource that is associated to the post content. Here is an exact example Holy sh*t! I just swapped a UGC creator with an AI character in 5 minutes 🤯

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


here is another one, they follow the same type of content flow

"shocking headline, that includes the tech/ai agent/ai workflow i am discussing"

"how it works, why it is powerful, and how it is impacting my business and other businesses in a good way"

"the step by step, or "how to" go ahead and copy me or the worfklow, or the idea, or how to learn about the idea"

FINAL CTA "prompting the user to comment something related to the tech we are talking about to recieve a free resource in the dm´s"

the cta will include that they must be following as well.


ONLY output the new post ready to go for twitter/linkedin. thanks.


Do not add ANY /n markdown in your output, only use emojis.

the hook should also include some type of stat, even if its made up. Like "this n8n agent generated $125,000, or 150,000 new followers, or 55 booked calls, or 1.6 million views etc."""

# ============================================================================
# GEMINI VIDEO ANALYSIS (Direct YouTube URL - no download needed)
# ============================================================================

def generate_viral_post(youtube_url: str, cta_keyword: str = None) -> str:
    """
    Generate viral Twitter/LinkedIn post from YouTube video using Gemini.

    Gemini can analyze YouTube videos directly via URL - no download needed.

    Args:
        youtube_url: YouTube video URL
        cta_keyword: Optional custom CTA keyword (e.g., "AGENT")

    Returns:
        Generated viral post text
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

    print(f"🎥 Analyzing YouTube video directly with {GEMINI_MODEL}...")
    print(f"   URL: {youtube_url}")

    # Initialize Gemini client
    client = genai.Client(api_key=GEMINI_API_KEY)

    # Build prompt with optional custom CTA keyword
    prompt = VIRAL_POST_PROMPT
    if cta_keyword:
        prompt += f"\n\nIMPORTANT: Use '{cta_keyword}' as the CTA keyword for commenting."

    # Gemini can analyze YouTube videos directly via URL
    response = client.models.generate_content(
        model=GEMINI_MODEL,
        contents=types.Content(
            parts=[
                types.Part(
                    file_data=types.FileData(file_uri=youtube_url)
                ),
                types.Part(text=prompt)
            ]
        )
    )

    print("✅ Post generated successfully")
    return response.text

# ============================================================================
# DATABASE STORAGE
# ============================================================================

def store_in_database(youtube_url: str, post_content: str) -> int:
    """
    Store generated post in youtube_social_post table.

    Args:
        youtube_url: Original YouTube URL
        post_content: Generated viral post content

    Returns:
        Row ID of inserted record
    """
    if not DATABASE_URL:
        print("⚠️  DATABASE_URL not set - skipping database storage")
        return None

    try:
        import psycopg2
    except ImportError:
        print("⚠️  psycopg2 not installed - skipping database storage")
        return None

    print("💾 Storing post in database...")

    try:
        conn = psycopg2.connect(DATABASE_URL)
        cur = conn.cursor()

        # Insert with ON CONFLICT to handle duplicate URLs
        cur.execute("""
            INSERT INTO youtube_social_post (original_youtube_url, twitter_linkedin_post, created_at)
            VALUES (%s, %s, %s)
            ON CONFLICT (original_youtube_url) DO UPDATE
            SET twitter_linkedin_post = EXCLUDED.twitter_linkedin_post,
                created_at = EXCLUDED.created_at
            RETURNING id
        """, (youtube_url, post_content, datetime.utcnow()))

        row_id = cur.fetchone()[0]
        conn.commit()
        cur.close()
        conn.close()

        print(f"✅ Stored in database (ID: {row_id})")
        return row_id

    except psycopg2.Error as e:
        print(f"❌ Database error: {e}")
        # Try simple insert without ON CONFLICT (table might not have unique constraint)
        try:
            conn = psycopg2.connect(DATABASE_URL)
            cur = conn.cursor()
            cur.execute("""
                INSERT INTO youtube_social_post (original_youtube_url, twitter_linkedin_post, created_at)
                VALUES (%s, %s, %s)
                RETURNING id
            """, (youtube_url, post_content, datetime.utcnow()))
            row_id = cur.fetchone()[0]
            conn.commit()
            cur.close()
            conn.close()
            print(f"✅ Stored in database (ID: {row_id})")
            return row_id
        except Exception as e2:
            print(f"❌ Database insert failed: {e2}")
            return None

# ============================================================================
# MAIN WORKFLOW
# ============================================================================

def process_youtube_video(youtube_url: str, cta_keyword: str = None) -> dict:
    """
    Main workflow: YouTube URL → Viral Post → Database

    Gemini analyzes the YouTube video directly via URL - no download needed.

    Args:
        youtube_url: YouTube video URL
        cta_keyword: Optional custom CTA keyword

    Returns:
        Dict with post content and database ID
    """
    print("\n" + "="*60)
    print("🎬 YOUTUBE TO VIRAL POSTS AGENT")
    print("="*60)
    print(f"URL: {youtube_url}")
    if cta_keyword:
        print(f"CTA Keyword: {cta_keyword}")
    print()

    try:
        # Step 1: Generate viral post (Gemini analyzes YouTube URL directly)
        post_content = generate_viral_post(youtube_url, cta_keyword)

        # Step 2: Store in database
        row_id = store_in_database(youtube_url, post_content)

        # Print result
        print("\n" + "="*60)
        print("📝 GENERATED VIRAL POST")
        print("="*60 + "\n")
        print(post_content)
        print("\n" + "="*60)

        return {
            "success": True,
            "youtube_url": youtube_url,
            "post_content": post_content,
            "database_id": row_id
        }

    except Exception as e:
        print(f"\n❌ ERROR: {e}")
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
        description="Generate viral Twitter/LinkedIn posts from YouTube videos using Gemini AI"
    )
    parser.add_argument(
        "url",
        help="YouTube video URL"
    )
    parser.add_argument(
        "--cta-keyword",
        "-c",
        help="Custom CTA keyword for commenting (e.g., 'AGENT', 'SWAP')",
        default=None
    )

    args = parser.parse_args()

    # Validate URL
    if "youtube.com" not in args.url and "youtu.be" not in args.url:
        print("⚠️  Warning: URL doesn't look like a YouTube link")

    # Run workflow
    result = process_youtube_video(
        youtube_url=args.url,
        cta_keyword=args.cta_keyword
    )

    # Exit with appropriate code
    sys.exit(0 if result["success"] else 1)


if __name__ == "__main__":
    main()
