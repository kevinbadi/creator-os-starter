# Gemini API: Viral Shorts Post Generator

This document outlines the workflow for generating a viral Twitter/LinkedIn post from a YouTube video using Google Gemini.

## API Details
- **Provider**: Google Gemini API
- **Model**: `gemini-1.5-pro` (or `gemini-1.5-flash` for speed)
- **Authentication**: API Key (provided in `.env` as `GEMINI_API_KEY`)

## Workflow

### 1. Input
The workflow accepts a **YouTube URL**.

### 2. Process (Gemini Analysis)
The system sends the video URL (or transcript) to Gemini with a specific persona and prompt to generate a viral post.

**Persona**: Professional content marketing copywriter.
**Goal**: Analyze video, rewrite into viral Twitter/LinkedIn post.
**Structure**:
1.  **Hook**: Shocking headline + stat.
2.  **Body**: How it works, why it's powerful, impact.
3.  **Steps**: "How to" / step-by-step.
4.  **CTA**: Comment keyword + "Like this post".

**Prompt Template**:
> Role: You are a professional content marketing copywriter... [Full prompt in implementation]

### 3. Output
A formatted text post ready for Twitter/LinkedIn.

## Implementation
The implementation script is located at `../implementation/gemini_viral_shorts_post.py`.

### Usage
1.  Ensure `GEMINI_API_KEY` is set in `.env`.
2.  Install dependencies:
    ```bash
    pip install google-generativeai yt-dlp python-dotenv
    ```
3.  Run the script:
    ```bash
    python3 implementation/gemini_viral_shorts_post.py "YOUR_YOUTUBE_URL"
    ```
