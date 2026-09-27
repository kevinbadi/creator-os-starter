"""
Instagram DM Sales Agent - Modal Deployment

Runs the Instagram DM agent on Modal.com serverless infrastructure.

IMPORTANT: You must pre-authenticate locally first to generate a valid session file!
1. Run locally: python instagram_dm_sales_agent.py (complete 2FA)
2. Upload session: modal volume put ig-sessions ./instagram_session.json
3. Deploy: modal deploy instagram_dm_modal.py
4. Run: modal run instagram_dm_modal.py::send_dms

Prerequisites:
- modal installed: pip install modal
- modal setup: modal setup
- Volume created: modal volume create ig-sessions
"""

import modal
import os

# Create Modal app
app = modal.App("instagram-dm-agent")

# Volume for persistent session storage
volume = modal.Volume.from_name("ig-sessions", create_if_missing=True)

# Container image with all dependencies
image = (
    modal.Image.debian_slim(python_version="3.11")
    .apt_install("chromium", "chromium-driver")
    .pip_install(
        "playwright",
        "python-dotenv",
        "psycopg2-binary",
        "colorama",
    )
    .run_commands("playwright install chromium")
)


@app.function(
    image=image,
    volumes={"/sessions": volume},
    secrets=[modal.Secret.from_name("agenticos-secrets")],  # Contains DATABASE_URL, IG creds
    timeout=3600,  # 1 hour max
    retries=0,
)
def send_dms(max_dms: int = 10, batch_size: int = 5):
    """
    Send Instagram DMs using the saved session.
    
    Args:
        max_dms: Maximum DMs to send this run
        batch_size: How many before taking a break
    """
    import json
    import csv
    import random
    import time
    from datetime import datetime
    from pathlib import Path
    
    from playwright.sync_api import sync_playwright
    import psycopg2
    
    # Paths
    SESSION_FILE = "/sessions/instagram_session.json"
    LEADS_FILE = "/sessions/instagram_leads.csv"
    SENT_LOG_FILE = "/sessions/instagram_sent_log.csv"
    
    # Load environment
    DATABASE_URL = os.environ.get("DATABASE_URL")
    
    print("=" * 60)
    print("📱 Instagram DM Agent (Modal)")
    print("=" * 60)
    
    # Check session exists
    if not Path(SESSION_FILE).exists():
        print("❌ No session file found!")
        print("   Run locally first to authenticate, then upload:")
        print("   modal volume put ig-sessions ./instagram_session.json")
        return {"error": "No session file"}
    
    # Load session
    with open(SESSION_FILE, "r") as f:
        storage_state = json.load(f)
    print("✅ Session loaded")
    
    # Get leads from database (not contacted yet)
    leads = []
    try:
        conn = psycopg2.connect(DATABASE_URL)
        cursor = conn.cursor()
        cursor.execute("""
            SELECT username, message_sent 
            FROM instagram_leads 
            WHERE contacted = FALSE 
            LIMIT %s
        """, (max_dms,))
        leads = [{"username": row[0], "message": row[1]} for row in cursor.fetchall()]
        cursor.close()
        conn.close()
        print(f"📋 Loaded {len(leads)} leads from database")
    except Exception as e:
        print(f"❌ Database error: {e}")
        return {"error": str(e)}
    
    if not leads:
        print("✅ No pending leads to contact!")
        return {"sent": 0, "message": "All caught up"}
    
    # Start browser
    results = {"sent": 0, "failed": 0, "errors": []}
    
    with sync_playwright() as p:
        browser = p.chromium.launch(
            headless=True,
            args=[
                "--disable-blink-features=AutomationControlled",
                "--disable-dev-shm-usage",
                "--no-sandbox",
            ]
        )
        
        context = browser.new_context(
            storage_state=storage_state,
            viewport={"width": 1920, "height": 1080},
            user_agent="Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36"
        )
        
        page = context.new_page()
        
        # Verify login
        page.goto("https://www.instagram.com/", wait_until="domcontentloaded")
        time.sleep(3)
        
        if page.locator('svg[aria-label="Home"]').count() == 0:
            print("❌ Not logged in! Session may have expired.")
            print("   Re-authenticate locally and re-upload session.")
            browser.close()
            return {"error": "Session expired"}
        
        print("✅ Logged in!")
        
        # Process leads
        for i, lead in enumerate(leads):
            username = lead["username"]
            message = lead["message"]
            
            print(f"\n[{i+1}/{len(leads)}] Sending DM to @{username}...")
            
            try:
                # Go to inbox
                page.goto("https://www.instagram.com/direct/inbox/", wait_until="domcontentloaded")
                time.sleep(3)
                
                # Click compose - try multiple selectors
                compose_selectors = [
                    'svg[aria-label="New message"]',
                    '[aria-label="New message"]',
                    'svg[aria-label="New Message"]',
                    '[aria-label="New Message"]',
                ]
                compose_clicked = False
                for sel in compose_selectors:
                    compose = page.locator(sel).first
                    if compose.count() > 0 and compose.is_visible():
                        compose.click()
                        compose_clicked = True
                        break
                
                if not compose_clicked:
                    raise Exception("Compose button not found")
                time.sleep(2)
                
                # Search user - try multiple selectors
                search_selectors = [
                    'input[placeholder="Search..."]',
                    'input[name="queryBox"]',
                    'input[aria-label="Search"]',
                    '[role="dialog"] input',
                ]
                search_found = False
                for sel in search_selectors:
                    search = page.locator(sel).first
                    if search.count() > 0 and search.is_visible():
                        search.fill(username)
                        search_found = True
                        break
                
                if not search_found:
                    raise Exception("Search input not found")
                time.sleep(2.5)
                
                # Select user from results
                page.keyboard.press("ArrowDown")
                time.sleep(0.5)
                page.keyboard.press("Enter")
                time.sleep(1.5)
                
                # Click Chat/Next button
                chat_selectors = [
                    'button:has-text("Chat")',
                    'button:has-text("Next")',
                    'div[role="button"]:has-text("Chat")',
                    'div[role="button"]:has-text("Next")',
                ]
                for sel in chat_selectors:
                    btn = page.locator(sel).first
                    if btn.count() > 0 and btn.is_visible():
                        btn.click()
                        break
                time.sleep(2)
                
                # Find message input - try multiple selectors
                msg_selectors = [
                    'textarea[placeholder="Message..."]',
                    'div[contenteditable="true"][role="textbox"]',
                    'div[contenteditable="true"]',
                    '[role="textbox"]',
                    'p[contenteditable="true"]',
                ]
                msg_input = None
                for sel in msg_selectors:
                    elem = page.locator(sel).first
                    if elem.count() > 0 and elem.is_visible():
                        msg_input = elem
                        break
                
                if not msg_input:
                    raise Exception("Message input not found")
                
                # Fill message (paste, don't type - avoids newline issues)
                msg_input.click()
                time.sleep(0.5)
                msg_input.fill(message)
                time.sleep(1)
                
                # Send - try multiple selectors
                send_selectors = [
                    'button:has-text("Send")',
                    '[aria-label="Send"]',
                    'div[role="button"]:has-text("Send")',
                ]
                send_clicked = False
                for sel in send_selectors:
                    btn = page.locator(sel).first
                    if btn.count() > 0 and btn.is_visible():
                        btn.click()
                        send_clicked = True
                        break
                
                if not send_clicked:
                    # Fallback: press Enter
                    msg_input.press("Enter")
                
                time.sleep(2)
                
                print(f"✅ Sent to @{username}")
                results["sent"] += 1
                
                # Update database
                try:
                    conn = psycopg2.connect(DATABASE_URL)
                    cursor = conn.cursor()
                    cursor.execute("""
                        UPDATE instagram_leads
                        SET contacted = TRUE, contacted_at = NOW(), 
                            dm_success = TRUE, status = 'contacted'
                        WHERE username = %s
                    """, (username,))
                    conn.commit()
                    cursor.close()
                    conn.close()
                except Exception as db_err:
                    print(f"⚠️ DB update failed: {db_err}")
                    
            except Exception as e:
                print(f"❌ Failed: {e}")
                results["failed"] += 1
                results["errors"].append({"username": username, "error": str(e)})
                
                # Update database with failure
                try:
                    conn = psycopg2.connect(DATABASE_URL)
                    cursor = conn.cursor()
                    cursor.execute("""
                        UPDATE instagram_leads
                        SET contacted = TRUE, contacted_at = NOW(),
                            dm_success = FALSE, dm_error = %s
                        WHERE username = %s
                    """, (str(e), username))
                    conn.commit()
                    cursor.close()
                    conn.close()
                except:
                    pass
            
            # Delay between DMs
            if i < len(leads) - 1:
                delay = random.randint(45, 90)
                print(f"⏳ Waiting {delay}s...")
                time.sleep(delay)
            
            # Batch break
            if (i + 1) % batch_size == 0 and i < len(leads) - 1:
                batch_delay = random.randint(180, 360)
                print(f"☕ Batch break: {batch_delay}s...")
                time.sleep(batch_delay)
        
        # Save updated session
        try:
            updated_state = context.storage_state()
            with open(SESSION_FILE, "w") as f:
                json.dump(updated_state, f)
            volume.commit()
            print("💾 Session saved to volume")
        except Exception as e:
            print(f"⚠️ Could not save session: {e}")
        
        browser.close()
    
    print("\n" + "=" * 60)
    print(f"🎉 Complete! Sent: {results['sent']}, Failed: {results['failed']}")
    print("=" * 60)
    
    return results


@app.function(
    image=image,
    volumes={"/sessions": volume},
    secrets=[modal.Secret.from_name("agenticos-secrets")],
)
def upload_leads_from_db():
    """Sync leads from database to volume for inspection."""
    import psycopg2
    import csv
    
    DATABASE_URL = os.environ.get("DATABASE_URL")
    
    conn = psycopg2.connect(DATABASE_URL)
    cursor = conn.cursor()
    cursor.execute("""
        SELECT username, full_name, contacted, dm_success, status
        FROM instagram_leads
        ORDER BY created_at DESC
        LIMIT 100
    """)
    
    rows = cursor.fetchall()
    
    with open("/sessions/leads_status.csv", "w", newline="") as f:
        writer = csv.writer(f)
        writer.writerow(["username", "full_name", "contacted", "dm_success", "status"])
        writer.writerows(rows)
    
    volume.commit()
    cursor.close()
    conn.close()
    
    return {"synced": len(rows)}


@app.local_entrypoint()
def main(max_dms: int = 10):
    """Run from CLI: modal run instagram_dm_modal.py --max-dms 20"""
    result = send_dms.remote(max_dms=max_dms)
    print(result)

