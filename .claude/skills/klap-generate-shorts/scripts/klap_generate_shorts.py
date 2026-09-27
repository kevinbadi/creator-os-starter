#!/usr/bin/env python3
"""
Klap Generate Shorts - Complete End-to-End Workflow

This script handles the FULL Klap workflow in one execution:
1. Submit video URL to Klap for editing
2. Poll for video processing completion
3. List all generated shorts
4. Export each short to get download URLs
5. Download all videos locally
6. Store everything in database
7. Send notifications when complete

Usage:
    python3 implementation/klap_generate_shorts_enhanced.py "https://youtube.com/watch?v=VIDEO_ID"
    python3 implementation/klap_generate_shorts_enhanced.py "https://youtube.com/watch?v=VIDEO_ID" --user-id 2
"""

import os
import sys
import time
import json
import uuid
import requests
import argparse
import psycopg2
import subprocess
import platform
from pathlib import Path
from datetime import datetime, timedelta
from dotenv import load_dotenv
from concurrent.futures import ThreadPoolExecutor, as_completed

# Load environment variables
load_dotenv()

# Try parent directory if not found
if not os.getenv('KLAP_API_KEY'):
        parent_env = os.path.join(os.path.dirname(os.path.dirname(__file__)), '.env')
        if os.path.exists(parent_env):
            load_dotenv(parent_env)
    
# ============================================================================
# CONFIGURATION
# ============================================================================
    
API_KEY = os.getenv('KLAP_API_KEY')
API_URL = "https://api.klap.app/v2"
DATABASE_URL = os.getenv('DATABASE_URL')
WEBHOOK_URL = os.getenv('NOTIFICATION_WEBHOOK_URL', '')

# Download directory
DOWNLOAD_DIR = Path(os.path.dirname(os.path.dirname(__file__))) / 'downloads' / 'shorts'

# Polling configuration
TASK_POLL_INTERVAL = 30  # seconds between task status checks
EXPORT_POLL_INTERVAL = 5  # seconds between export status checks
MAX_TASK_POLLS = 60  # max attempts for task completion (30 min)
MAX_EXPORT_POLLS = 40  # max attempts for export completion

if not API_KEY:
    raise ValueError("KLAP_API_KEY not found in .env file")

# ============================================================================
# NOTIFICATION SYSTEM
# ============================================================================

def send_desktop_notification(title, message, sound=True):
    """Send desktop notification based on OS"""
    system = platform.system()
    
    try:
        if system == "Darwin":  # macOS
            sound_flag = 'sound name "default"' if sound else ''
            script = f'display notification "{message}" with title "{title}" {sound_flag}'
            subprocess.run(["osascript", "-e", script], check=True)
            print(f"🔔 Desktop notification sent")
            
        elif system == "Linux":
            subprocess.run(["notify-send", title, message], check=True)
            
        elif system == "Windows":
            ps_script = f'''
            Add-Type -AssemblyName System.Windows.Forms
            $notify = New-Object System.Windows.Forms.NotifyIcon
            $notify.Icon = [System.Drawing.SystemIcons]::Information
            $notify.Visible = $true
            $notify.ShowBalloonTip(5000, "{title}", "{message}", [System.Windows.Forms.ToolTipIcon]::Info)
            '''
            subprocess.run(["powershell", "-Command", ps_script], check=True)
            
    except Exception as e:
        print(f"⚠️ Could not send desktop notification: {e}")


def send_webhook_notification(title, message, data=None):
    """Send webhook notification (Slack/Discord compatible)"""
    if not WEBHOOK_URL:
        return
    
    try:
        payload = {
            "text": f"🎬 *{title}*\n{message}",
            "attachments": []
        }
        
        if data:
            payload["attachments"].append({
                "color": "#36a64f",
                "fields": [
                    {"title": k, "value": str(v), "short": True}
                    for k, v in data.items()
                ]
            })
        
        requests.post(WEBHOOK_URL, json=payload, timeout=10)
        print(f"📨 Webhook notification sent")
        
    except Exception as e:
        print(f"⚠️ Could not send webhook: {e}")


def notify(title, message, data=None):
    """Send all configured notifications"""
    send_desktop_notification(title, message)
    send_webhook_notification(title, message, data)


# ============================================================================
# API HELPERS
# ============================================================================

def get_headers():
    """Get API headers with authorization"""
    return {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {API_KEY}"
    }


# ============================================================================
# DATABASE FUNCTIONS
# ============================================================================

def get_db_connection():
    """Get database connection"""
    return psycopg2.connect(DATABASE_URL)


def store_parent_job(task_id, source_url, user_id=2):
    """Store parent job record for tracking"""
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        
        job_id = f"job_{task_id}"
        name = f"[PARENT] Klap Job {datetime.now().strftime('%m/%d/%Y %H:%M')}"
        
        cursor.execute("""
            INSERT INTO video_to_shorts_agent (
                id, name, status, src_url, project_id, author_id, created_at
            ) VALUES (%s, %s, %s, %s, %s, %s, %s)
            ON CONFLICT (id) DO UPDATE SET
                status = EXCLUDED.status,
                src_url = EXCLUDED.src_url
        """, (job_id, name, 'processing', source_url, job_id, user_id, datetime.now()))
        
        conn.commit()
        cursor.close()
        conn.close()
        
        print(f"🗄️ Parent job stored: {job_id}")
        return job_id
        
    except Exception as e:
        print(f"❌ Database error: {e}")
        return None


def update_parent_job(job_id, status, folder_id=None, clip_count=0):
    """Update parent job status"""
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        
        if folder_id:
            cursor.execute("""
                UPDATE video_to_shorts_agent 
                SET status = %s, folder_id = %s, 
                    descriptions = %s, finished_at = %s
                WHERE id = %s
            """, (status, folder_id, f"Generated {clip_count} clips", 
                  datetime.now() if status in ['complete', 'exported', 'failed'] else None,
                  job_id))
        else:
            cursor.execute("""
                UPDATE video_to_shorts_agent 
                SET status = %s
                WHERE id = %s
            """, (status, job_id))
        
        conn.commit()
        cursor.close()
        conn.close()
        
    except Exception as e:
        print(f"❌ Database update error: {e}")


def store_clip(clip_data, folder_id, source_url, user_id=2):
    """Store individual clip in database"""
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        
        clip_id = clip_data['id']
        
        cursor.execute("""
            INSERT INTO video_to_shorts_agent (
                id, name, status, src_url, folder_id, virality_score,
                virality_score_explanation, publication_captions,
                author_id, created_at, project_id
            ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            ON CONFLICT (id) DO UPDATE SET
                status = EXCLUDED.status,
                src_url = EXCLUDED.src_url,
                virality_score = EXCLUDED.virality_score
        """, (
            clip_id,
            clip_data.get('name', 'Untitled'),
            'generated',
            source_url,
            folder_id,
            clip_data.get('virality_score', 0),
            clip_data.get('virality_score_explanation', ''),
            json.dumps(clip_data.get('publication_captions', {})),
            user_id,
            datetime.now(),
            folder_id  # project_id links clips together
        ))
        
        conn.commit()
        cursor.close()
        conn.close()
        
        return clip_id
        
    except Exception as e:
        print(f"❌ Error storing clip: {e}")
        return None


def update_clip_downloaded(clip_id, download_url, local_path):
    """Update clip with download info and output_video_url"""
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        
        cursor.execute("""
            UPDATE video_to_shorts_agent 
            SET output_video_url = %s, 
                status = 'downloaded',
                descriptions = %s, 
                finished_at = %s
            WHERE id = %s
        """, (download_url, f"Downloaded to: {local_path}", datetime.now(), clip_id))
        
        conn.commit()
        cursor.close()
        conn.close()
        
    except Exception as e:
        print(f"❌ Error updating clip: {e}")


# ============================================================================
# KLAP API FUNCTIONS
# ============================================================================

def submit_video(video_url, language="en"):
    """
    STEP 1: Submit video to Klap for processing
    """
    endpoint = f"{API_URL}/tasks/video-to-shorts"
    payload = {
        "source_video_url": video_url,
        "language": language,
        "max_duration": 30,
        "max_clip_count": 5,
        "editing_options": {
            "intro_title": False
        }
    }
    
    print(f"🎬 Submitting video: {video_url}")
        response = requests.post(endpoint, headers=get_headers(), json=payload)
        response.raise_for_status()
    
    data = response.json()
    task_id = data.get('id')
    print(f"✅ Task created: {task_id}")
        
    return data


def poll_task_completion(task_id):
    """
    STEP 2: Poll until video processing is complete
    """
    endpoint = f"{API_URL}/tasks/{task_id}"
    
    print(f"⏳ Polling for task completion...", end='', flush=True)
    
    for attempt in range(MAX_TASK_POLLS):
            response = requests.get(endpoint, headers=get_headers())
            response.raise_for_status()
        
            data = response.json()
        status = data.get('status', '')
            
        if status in ['success', 'complete', 'ready']:
            print(f" Done!")
            folder_id = data.get('output_id') or data.get('folder_id')
            print(f"✅ Processing complete! Folder ID: {folder_id}")
            return data, folder_id
            
        elif status in ['error', 'failed']:
            print(f" Failed!")
            raise Exception(f"Task failed: {data.get('error_message', 'Unknown error')}")
        
        print(".", end='', flush=True)
        time.sleep(TASK_POLL_INTERVAL)
    
    raise Exception("Task polling timeout")


def list_generated_shorts(folder_id):
    """
    STEP 3: List all generated shorts in the folder
    """
    endpoint = f"{API_URL}/projects/{folder_id}"
    
    print(f"📋 Fetching generated shorts...")
    response = requests.get(endpoint, headers=get_headers())
    response.raise_for_status()
    
    shorts = response.json()
    print(f"✅ Found {len(shorts)} shorts")
    
    return shorts


def export_short(folder_id, short_id):
    """
    STEP 4a: Create export for a single short
    """
    endpoint = f"{API_URL}/projects/{folder_id}/{short_id}/exports"
    
    response = requests.post(endpoint, headers=get_headers(), json={})
    response.raise_for_status()
    
    data = response.json()
    return data.get('id')


def poll_export_completion(folder_id, short_id, export_id):
    """
    STEP 4b: Poll until export is complete
    """
    endpoint = f"{API_URL}/projects/{folder_id}/{short_id}/exports/{export_id}"
    
    for attempt in range(MAX_EXPORT_POLLS):
        response = requests.get(endpoint, headers=get_headers())
        response.raise_for_status()
        
        data = response.json()
        status = data.get('status', '')
        
        if status in ['success', 'complete', 'ready']:
            return data.get('src_url') or data.get('url')
        
        elif status == 'error':
            raise Exception("Export failed")
        
        time.sleep(EXPORT_POLL_INTERVAL)
    
    raise Exception("Export polling timeout")


def download_video(url, filepath):
    """
    STEP 5: Download video to local filesystem
    """
    response = requests.get(url, stream=True, timeout=300)
    response.raise_for_status()
    
    with open(filepath, 'wb') as f:
        for chunk in response.iter_content(chunk_size=8192):
            if chunk:
                f.write(chunk)
    
    return filepath


# ============================================================================
# MAIN WORKFLOW
# ============================================================================

def process_video(video_url, user_id=2, language="en"):
    """
    Complete end-to-end workflow:
    1. Submit video
    2. Poll for completion
    3. List shorts
    4. Export each short
    5. Download videos
    6. Store in database
    7. Notify user
    """
    
    print("=" * 70)
    print("🚀 KLAP SHORTS GENERATOR - COMPLETE WORKFLOW")
    print("=" * 70)
    print(f"📹 Source: {video_url}")
    print(f"👤 User ID: {user_id}")
    print("=" * 70)

    try:
        # ====== STEP 1: Submit Video ======
        print("\n📌 STEP 1: Submitting video to Klap...")
        task_data = submit_video(video_url, language)
        task_id = task_data.get('id')
        
        # Store parent job in database
        job_id = store_parent_job(task_id, video_url, user_id)

        # ====== STEP 2: Poll for Completion ======
        print("\n📌 STEP 2: Waiting for video processing...")
        completed_task, folder_id = poll_task_completion(task_id)
        
        # Update parent job
        update_parent_job(job_id, 'complete', folder_id)

        # ====== STEP 3: List Generated Shorts ======
        print("\n📌 STEP 3: Fetching generated shorts...")
        shorts = list_generated_shorts(folder_id)
        
        # Display shorts info
        print("\n📊 Generated Shorts:")
        for i, short in enumerate(shorts, 1):
            print(f"   {i}. {short.get('name', 'Untitled')[:50]}...")
            print(f"      Virality Score: {short.get('virality_score', 0)}")
        
        # Store each clip in database
        for short in shorts:
            store_clip(short, folder_id, video_url, user_id)
        
        # ====== STEP 4: Export Each Short ======
        print("\n📌 STEP 4: Exporting shorts...")
        
        # Create download directory
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        download_path = DOWNLOAD_DIR / f"klap_{folder_id}_{timestamp}"
        download_path.mkdir(parents=True, exist_ok=True)
        
        downloaded_files = []
        
        for i, short in enumerate(shorts, 1):
            short_id = short.get('id')
            name = short.get('name', 'Untitled')
            virality = short.get('virality_score', 0)
            
            print(f"\n   [{i}/{len(shorts)}] 🎬 {name[:45]}...")
            print(f"       Virality: {virality}")
            
            try:
                # Create export
                print(f"       📤 Creating export...", end='', flush=True)
                export_id = export_short(folder_id, short_id)
                print(f" ✅")
                
                # Poll for export completion
                print(f"       ⏳ Waiting for export...", end='', flush=True)
                export_url = poll_export_completion(folder_id, short_id, export_id)
                print(f" ✅")
                
                # Download video
                safe_name = "".join(c for c in name if c.isalnum() or c in (' ', '-', '_'))[:50]
                filename = f"{i}_{safe_name}.mp4"
                filepath = download_path / filename
                
                print(f"       📥 Downloading...", end='', flush=True)
                download_video(export_url, filepath)
                file_size = filepath.stat().st_size / 1024 / 1024
                print(f" ✅ ({file_size:.1f} MB)")
                
                # Update database
                update_clip_downloaded(short_id, export_url, str(filepath))
                
                downloaded_files.append({
                    'id': short_id,
                    'name': name,
                    'local_path': str(filepath),
                    'remote_url': export_url,
                    'virality': virality,
                    'size_mb': file_size
                })
                
            except Exception as e:
                print(f" ❌ Error: {e}")

        # ====== STEP 5: Final Updates & Notification ======
        print("\n📌 STEP 5: Finalizing...")
        
        # Update parent job as exported
        update_parent_job(job_id, 'exported', folder_id, len(downloaded_files))
        
        # Summary
        print("\n" + "=" * 70)
        print("✅ WORKFLOW COMPLETE!")
        print("=" * 70)
        print(f"📁 Downloaded: {len(downloaded_files)}/{len(shorts)} shorts")
        print(f"📂 Location: {download_path}")
        print(f"🗄️ Database: Updated with {len(downloaded_files)} clips")
        
        # List files
        print("\n📹 Downloaded Files:")
        total_size = 0
        for f in downloaded_files:
            print(f"   • {f['name'][:50]}...")
            print(f"     Size: {f['size_mb']:.1f} MB | Virality: {f['virality']}")
            total_size += f['size_mb']
        print(f"\n   Total Size: {total_size:.1f} MB")
        
        # Send notification
        notify(
            "🎬 Klap Shorts Ready!",
            f"Downloaded {len(downloaded_files)} shorts ({total_size:.1f} MB)",
            {
                "Videos": len(downloaded_files),
                "Total Size": f"{total_size:.1f} MB",
                "Location": str(download_path)
            }
        )
        
        return {
            'success': True,
            'job_id': job_id,
            'folder_id': folder_id,
            'download_path': str(download_path),
            'clips': downloaded_files
        }

    except Exception as e:
        print(f"\n❌ WORKFLOW FAILED: {e}")
        
        # Update job status if we have one
        if 'job_id' in locals() and job_id:
            update_parent_job(job_id, 'failed')
        
        # Notify about failure
        notify("❌ Klap Processing Failed", str(e))
        
        return {
            'success': False,
            'error': str(e)
        }


def main():
    parser = argparse.ArgumentParser(
        description="Generate shorts from video using Klap API - Complete Workflow"
    )
    parser.add_argument("url", help="Source video URL (YouTube, S3, etc.)")
    parser.add_argument("--user-id", type=int, default=2, help="User ID (default: 2)")
    parser.add_argument("--language", default="en", help="Language (default: en)")
    
    args = parser.parse_args()
    
    result = process_video(args.url, args.user_id, args.language)
    
    if result['success']:
        sys.exit(0)
    else:
        sys.exit(1)


if __name__ == "__main__":
    main()
