import os
import time
import argparse
from dotenv import load_dotenv
import google.generativeai as genai
import yt_dlp

# Load environment variables
load_dotenv()
API_KEY = os.getenv('GEMINI_API_KEY')

if not API_KEY:
    # Try to look in parent directory .env if not found
    parent_env = os.path.join(os.path.dirname(os.path.dirname(__file__)), '.env')
    if os.path.exists(parent_env):
        load_dotenv(parent_env)
        API_KEY = os.getenv('GEMINI_API_KEY')

if not API_KEY:
    print("WARNING: GEMINI_API_KEY not found in environment variables.")

def download_video(url, output_path="temp_video.mp4"):
    """Download YouTube video using yt-dlp"""
    print(f"Downloading video from {url}...")
    ydl_opts = {
        'format': 'best[ext=mp4]',
        'outtmpl': output_path,
        'quiet': True,
    }
    with yt_dlp.YoutubeDL(ydl_opts) as ydl:
        ydl.download([url])
    print("Download complete.")
    return output_path

def upload_to_gemini(path):
    """Uploads the file to Gemini and waits for it to be processed."""
    print(f"Uploading {path} to Gemini...")
    file = genai.upload_file(path)
    print(f"Uploaded file: {file.name}")

    # Verify that the file is processed.
    while file.state.name == "PROCESSING":
        print(".", end="", flush=True)
        time.sleep(2)
        file = genai.get_file(file.name)
    
    if file.state.name == "FAILED":
        raise ValueError(f"File processing failed: {file.state.name}")
        
    print(f"\nFile processing complete: {file.uri}")
    return file

def generate_viral_post(video_file):
    """Generates a viral post using Gemini"""
    print("Generating viral post...")
    
    model = genai.GenerativeModel(model_name="gemini-1.5-pro")
    
    prompt = """
    Role: You are a professional content marketing copywriter. 
    Your goal is to analyze and rewrite the provided video into a viral twitter/linkedin post that catches the attention of the viewer, and educates them. 
    The goal of these posts is to create a CTA for the viewer to drop a comment to receive an educational resource that is associated to the post content.

    Structure:
    1. Hook: Shocking headline + stat (e.g., "$125,000 generated", "1.6 million views"). Use emojis.
    2. Body: "How it works", "Why it is powerful", "Impact on business".
    3. Steps: "The step by step" or "How to" copy the workflow/idea.
    4. CTA: Prompt user to comment a keyword (e.g., "SWAP") and "Like this post" to receive a free resource in DMs. Mention they must be following.

    Tone: High energy, professional but viral, emoji-rich.
    Constraint: Do NOT use '\\n' literal characters in output, use actual newlines. Only use emojis.
    """
    
    response = model.generate_content([video_file, prompt])
    return response.text

def main():
    parser = argparse.ArgumentParser(description="Generate Viral Post from YouTube Video using Gemini")
    parser.add_argument("url", help="YouTube Video URL")
    args = parser.parse_args()

    if not API_KEY:
        print("Error: GEMINI_API_KEY is required.")
        return

    genai.configure(api_key=API_KEY)
    
    temp_video = "temp_video.mp4"
    try:
        # 1. Download
        download_video(args.url, temp_video)
        
        # 2. Upload
        gemini_file = upload_to_gemini(temp_video)
        
        # 3. Generate
        post_content = generate_viral_post(gemini_file)
        
        print("\n" + "="*50)
        print("GENERATED VIRAL POST")
        print("="*50 + "\n")
        print(post_content)
        
        # Cleanup Gemini file (optional, good practice)
        # genai.delete_file(gemini_file.name)
        
    except Exception as e:
        print(f"An error occurred: {e}")
    finally:
        if os.path.exists(temp_video):
            os.remove(temp_video)
            print("Temporary video file removed.")

if __name__ == "__main__":
    main()
