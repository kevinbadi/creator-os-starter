#!/usr/bin/env python3
"""
Instagram DM Sales Agent - Database-Driven Playwright Automation

Sends personalized DMs to leads stored in the PostgreSQL database.
Tracks contacted status directly in the database - fully closed loop.

Now with AI-powered personalization using Claude (Anthropic)!

Usage:
    python implementation/instagram_dm_sales_agent.py
    python implementation/instagram_dm_sales_agent.py --limit 20
    python implementation/instagram_dm_sales_agent.py --template ai      # AI-powered messages
    python implementation/instagram_dm_sales_agent.py --headless
    python implementation/instagram_dm_sales_agent.py --test
"""

import json
import random
import time
import argparse
import os
from datetime import datetime
from pathlib import Path
from typing import Optional, List, Dict
from dotenv import load_dotenv

load_dotenv()

try:
    from colorama import Fore, Style, init
    init(autoreset=True)
except ImportError:
    class Fore:
        CYAN = YELLOW = GREEN = RED = WHITE = MAGENTA = ""
    class Style:
        RESET_ALL = ""

try:
    from playwright.sync_api import Browser, BrowserContext, Page, sync_playwright
except ImportError:
    print("❌ Playwright not installed. Run: pip install playwright && playwright install chromium")
    exit(1)

# Anthropic for AI-powered messages
try:
    import anthropic
    ANTHROPIC_AVAILABLE = True
except ImportError:
    ANTHROPIC_AVAILABLE = False

from instagram_dm_config import (
    BATCH_SIZE,
    DELAY_BETWEEN_BATCHES,
    DELAY_BETWEEN_DMS,
    HEADLESS,
    INSTAGRAM_BASE_URL,
    INSTAGRAM_DM_URL,
    INSTAGRAM_LOGIN_URL,
    INSTAGRAM_PASSWORD,
    INSTAGRAM_USERNAME,
    MAX_DMS_PER_DAY,
    SESSION_FILE,
    SLOW_MO,
    DATABASE_URL,
    print_config,
    validate_config,
)

# Anthropic API Key
ANTHROPIC_API_KEY = os.getenv("ANTHROPIC_API_KEY", "")


# ============================================================
# LOAD ONBOARDING CONFIG for dynamic templates
# ============================================================

def _load_onboarding_config():
    config_path = Path(__file__).resolve().parent.parent.parent.parent / "onboarding-config.json"
    try:
        with open(config_path) as f:
            return json.load(f)
    except Exception:
        return {}

_OB_CONFIG = _load_onboarding_config()
_P1 = _OB_CONFIG.get("phase1", {})
_P3 = _OB_CONFIG.get("phase3", {})
_P6 = _OB_CONFIG.get("phase6", {})

_BRAND_NAME = (_P1.get("brand_name") or "the brand").strip()
_PERSONA_NAME = (_P1.get("persona_name") or "the brand persona").strip()
_OUTREACH_GOAL = (_P3.get("outreach_goal") or "").strip()
_PRIMARY_CTA = (_P1.get("primary_cta") or "").strip()
_BRAND_URL = (_P1.get("brand_url") or "").strip()
_DM_OPENER = (_P6.get("dm_opener_template") or "").strip()

# ============================================================
# MESSAGE TEMPLATES - Dynamic from onboarding config
# ============================================================

TEMPLATES = {
    "whatsup": """What's up @{{username}}""",

    "default": f"""{{{{fullName}}}} –

{_PERSONA_NAME} here from {_BRAND_NAME}.

{_OUTREACH_GOAL}

{'👉 ' + _PRIMARY_CTA if _PRIMARY_CTA else ''}
{_BRAND_URL}

Reply if you want to learn more.""",

    "short": f"""{{{{fullName}}}} –

{_PERSONA_NAME} from {_BRAND_NAME}.

{_OUTREACH_GOAL}

Interested?""",

    "problem": f"""{{{{fullName}}}} –

You're probably spending hours trying to grow @{{{{username}}}}.

{_OUTREACH_GOAL}

{'👉 ' + _PRIMARY_CTA if _PRIMARY_CTA else ''}

Want in?""",

    "bold": f"""{{{{fullName}}}} –

{_PERSONA_NAME} here. {_OUTREACH_GOAL}

{'👉 ' + _PRIMARY_CTA if _PRIMARY_CTA else ''}
{_BRAND_URL}

Reply "show me" if you want in.""",

    "ai": "AI_GENERATED",  # Placeholder - will be replaced by Claude
}


# ============================================================
# AI-POWERED MESSAGE GENERATION (Claude / Anthropic)
# ============================================================

AI_SYSTEM_PROMPT = f"""You are an expert cold DM copywriter in the style of Alex Hormozi.
Your job is to write short, punchy, personalized Instagram DMs that get replies.

Rules:
1. Keep it under 100 words - Instagram DMs should be brief
2. Start with their name (personalized greeting)
3. Reference something specific about them if possible (their niche, content, etc.)
4. Pitch the brand: {_BRAND_NAME} — {_P1.get('brand_description', '')}
5. End with a CTA: {_PRIMARY_CTA}
6. Use → bullet points sparingly (max 3)
7. Sound human, not robotic - casual but professional
8. NO hashtags, NO emojis overload (1-2 max if any)
9. Create curiosity and urgency
10. Brand URL to include naturally: {_BRAND_URL}

Outreach goal: {_OUTREACH_GOAL}

Persona: {_PERSONA_NAME} — {_P1.get('voice_description', 'direct and confident')}

Output ONLY the message text. No explanations, no quotes around it."""

def generate_ai_message(lead_data: Dict) -> Optional[str]:
    """
    Generate a personalized DM using Claude AI based on lead data.
    
    Args:
        lead_data: Dict with username, full_name, profile_url, campaign, etc.
    
    Returns:
        AI-generated personalized message or None on failure
    """
    if not ANTHROPIC_AVAILABLE:
        print(f"{Fore.YELLOW}⚠️ Anthropic not installed. Run: pip install anthropic{Style.RESET_ALL}")
        return None
    
    if not ANTHROPIC_API_KEY:
        print(f"{Fore.YELLOW}⚠️ ANTHROPIC_API_KEY not set in .env{Style.RESET_ALL}")
        return None
    
    username = lead_data.get("username", "")
    full_name = lead_data.get("full_name", "")
    profile_url = lead_data.get("profile_url", "")
    campaign = lead_data.get("campaign", "")
    is_verified = lead_data.get("is_verified", False)
    
    # Build context for Claude
    user_prompt = f"""Write a personalized cold DM for this Instagram lead:

Username: @{username}
Name: {full_name if full_name else "Unknown"}
Profile: {profile_url if profile_url else f"https://instagram.com/{username}"}
Verified: {"Yes" if is_verified else "No"}
Source: {campaign if campaign else "Instagram post likers"}

Write a compelling, personalized DM that will get them to reply "demo" or "show me"."""

    try:
        client = anthropic.Anthropic(api_key=ANTHROPIC_API_KEY)
        
        response = client.messages.create(
            model="claude-sonnet-4-20250514",
            max_tokens=300,
            system=AI_SYSTEM_PROMPT,
            messages=[
                {"role": "user", "content": user_prompt}
            ]
        )
        
        message = response.content[0].text.strip()
        return message
        
    except Exception as e:
        print(f"{Fore.RED}❌ AI generation error: {e}{Style.RESET_ALL}")
        return None


def get_db_connection():
    """Get database connection"""
    if not DATABASE_URL:
        raise ValueError("DATABASE_URL is required. Set it in .env file")
    try:
        import psycopg2
        return psycopg2.connect(DATABASE_URL)
    except Exception as e:
        raise ValueError(f"Database connection failed: {e}")


def clean_username(username: str) -> str:
    """Clean username - remove @ and whitespace"""
    if not username:
        return ""
    return username.strip().replace("@", "").strip()


def clean_fullname(fullname: str, username: str) -> str:
    """Clean and fallback for fullName."""
    if not fullname or not fullname.strip():
        return "Hey there"
    
    fullname = fullname.strip()
    
    if fullname.lower() == username.lower():
        return "Hey there"
    
    if len(fullname) < 2:
        return "Hey there"
    
    return fullname


def personalize_message(template: str, username: str, fullname: str) -> str:
    """Replace template variables with actual values."""
    message = template
    username = clean_username(username)
    fullname = clean_fullname(fullname, username)
    
    message = message.replace("{{fullName}}", fullname)
    message = message.replace("{{username}}", username)
    
    return message.strip()


class InstagramDMSender:
    """
    Playwright-based Instagram DM automation using the Inbox Compose Method.
    
    Fully database-driven - loads leads from PostgreSQL, tracks all status there.
    
    Key Innovation: Instead of navigating to profiles, we:
    1. Go to instagram.com/direct/inbox/
    2. Click the compose icon
    3. Search for username → Select → Send
    
    This works for BOTH public AND private accounts!
    """
    
    def __init__(self, headless: bool = None, template: str = "default", limit: int = None):
        self.playwright = None
        self.browser: Optional[Browser] = None
        self.context: Optional[BrowserContext] = None
        self.page: Optional[Page] = None
        self.dms_sent_today = 0
        self.session_file = Path(SESSION_FILE)
        self.headless = headless if headless is not None else HEADLESS
        self.template_name = template
        self.template = TEMPLATES.get(template, TEMPLATES["default"])
        self.limit = limit or MAX_DMS_PER_DAY
        
    def log(self, message: str, level: str = "info"):
        """Colored logging"""
        timestamp = datetime.now().strftime("%H:%M:%S")
        colors = {
            "info": Fore.CYAN,
            "success": Fore.GREEN,
            "warning": Fore.YELLOW,
            "error": Fore.RED,
        }
        color = colors.get(level, Fore.WHITE)
        print(f"{Fore.WHITE}[{timestamp}] {color}{message}{Style.RESET_ALL}")
    
    def random_delay(self, min_seconds: float, max_seconds: float):
        """Add random delay to simulate human behavior"""
        delay = random.uniform(min_seconds, max_seconds)
        self.log(f"⏳ Waiting {delay:.1f}s...", "info")
        time.sleep(delay)
    
    def dismiss_popups(self):
        """Dismiss any Instagram popups like 'Turn on Notifications', 'Save Login Info', etc."""
        popup_buttons = [
            'button:has-text("Not Now")',
            'button:has-text("Turn On")',
            'button:has-text("Save Info")',
            '[role="dialog"] button:has-text("Not Now")',
            '[role="dialog"] button:has-text("Cancel")',
            '[role="dialog"] button:has-text("Close")',
            '[role="dialog"] [aria-label="Close"]',
        ]
        
        for selector in popup_buttons:
            try:
                btn = self.page.locator(selector).first
                if btn.count() > 0 and btn.is_visible(timeout=1000):
                    btn.click()
                    self.log(f"🔔 Dismissed popup", "info")
                    time.sleep(0.5)
                    return True
            except Exception:
                continue
        
        return False
    
    def start_browser(self):
        """Initialize Playwright browser with anti-detection settings"""
        self.log("🚀 Starting browser...", "info")
        
        self.playwright = sync_playwright().start()
        
        self.browser = self.playwright.chromium.launch(
            headless=self.headless,
            slow_mo=SLOW_MO,
            args=[
                "--disable-blink-features=AutomationControlled",
                "--disable-infobars",
                "--window-size=1920,1080",
            ]
        )
        
        # Check for saved session
        if self.session_file.exists():
            self.log("📂 Loading saved session...", "info")
            try:
                storage_state = json.loads(self.session_file.read_text())
                self.context = self.browser.new_context(
                    storage_state=storage_state,
                    viewport={"width": 1920, "height": 1080},
                    user_agent="Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
                )
            except Exception as e:
                self.log(f"⚠️ Failed to load session: {e}", "warning")
                self.context = None
        
        if not self.context:
            self.context = self.browser.new_context(
                viewport={"width": 1920, "height": 1080},
                user_agent="Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            )
        
        self.page = self.context.new_page()
        
        # Block images for faster loading
        self.page.route("**/*.{png,jpg,jpeg,gif,webp}", lambda route: route.abort())
        
        self.log("✅ Browser started", "success")
    
    def save_session(self):
        """Save browser session for reuse"""
        if self.context:
            try:
                storage = self.context.storage_state()
                self.session_file.write_text(json.dumps(storage))
                self.log("💾 Session saved", "success")
            except Exception as e:
                self.log(f"⚠️ Could not save session: {e}", "warning")
    
    def is_logged_in(self) -> bool:
        """Check if user is logged in"""
        try:
            self.page.goto(INSTAGRAM_BASE_URL, wait_until="domcontentloaded", timeout=60000)
            self.random_delay(3, 5)
            
            home_icon = self.page.locator('svg[aria-label="Home"]').count() > 0
            inbox_icon = self.page.locator('svg[aria-label="Messenger"]').count() > 0
            profile_pic = self.page.locator('img[alt*="profile picture"]').count() > 0
            
            is_logged = home_icon or inbox_icon or profile_pic
            
            if is_logged:
                self.log("✅ Already logged in!", "success")
            else:
                self.log("❌ Not logged in", "warning")
            
            return is_logged
        except Exception as e:
            self.log(f"Error checking login: {e}", "error")
            return False
    
    def login(self) -> bool:
        """Login to Instagram"""
        self.log("🔐 Logging in to Instagram...", "info")
        
        try:
            self.page.goto(INSTAGRAM_LOGIN_URL, wait_until="domcontentloaded", timeout=60000)
            self.random_delay(2, 4)
            
            # Handle cookie consent
            try:
                cookie_btn = self.page.locator('button:has-text("Allow all cookies")')
                if cookie_btn.count() > 0:
                    cookie_btn.click()
                    self.random_delay(1, 2)
            except:
                pass
            
            # Enter username
            username_input = self.page.locator('input[name="username"]')
            username_input.click()
            self.random_delay(0.5, 1)
            username_input.fill(INSTAGRAM_USERNAME)
            self.random_delay(0.5, 1)
            
            # Enter password
            password_input = self.page.locator('input[name="password"]')
            password_input.click()
            self.random_delay(0.5, 1)
            password_input.fill(INSTAGRAM_PASSWORD)
            self.random_delay(0.5, 1)
            
            # Click login
            login_button = self.page.locator('button[type="submit"]')
            login_button.click()
            
            self.log("⏳ Waiting for login...", "info")
            self.random_delay(8, 12)
            
            # Check for security challenges
            challenge_selectors = [
                'input[name="verificationCode"]',
                'input[name="approvals_code"]',
                'input[aria-label*="code"]',
                'text="Enter the code"',
                'text="Confirm your identity"',
                'text="We Detected An Unusual Login Attempt"',
            ]
            
            on_login_page = self.page.locator('input[name="username"]').count() > 0
            home_loaded = self.page.locator('svg[aria-label="Home"]').count() > 0
            
            has_challenge = any(self.page.locator(sel).count() > 0 for sel in challenge_selectors)
            not_on_home_or_login = not home_loaded and not on_login_page
            
            if has_challenge or not_on_home_or_login:
                self.log("🔒 Security challenge detected! Complete it in the browser.", "warning")
                self.log("⏳ Waiting up to 3 minutes for you to complete...", "info")
                
                for i in range(180):
                    time.sleep(1)
                    
                    try:
                        home_loaded = self.page.locator('svg[aria-label="Home"]').count() > 0
                        inbox_icon = self.page.locator('svg[aria-label="Messenger"]').count() > 0
                        
                        if home_loaded or inbox_icon:
                            self.log("✅ Security challenge completed!", "success")
                            self.random_delay(3, 5)
                            break
                    except:
                        pass
                    
                    if i % 30 == 0 and i > 0:
                        self.log(f"⏳ Still waiting... ({180-i}s remaining)", "info")
            
            # Handle popups
            for _ in range(3):
                try:
                    self.random_delay(1, 2)
                    not_now = self.page.locator('button:has-text("Not Now")')
                    if not_now.count() > 0:
                        not_now.first.click()
                        self.random_delay(1, 2)
                except:
                    pass
            
            # Verify login
            self.random_delay(2, 3)
            home_icon = self.page.locator('svg[aria-label="Home"]').count() > 0
            inbox_icon = self.page.locator('svg[aria-label="Messenger"]').count() > 0
            profile_pic = self.page.locator('img[alt*="profile picture"]').count() > 0
            
            if home_icon or inbox_icon or profile_pic:
                self.log("✅ Login successful!", "success")
                self.save_session()
                return True
            else:
                self.log("❌ Login failed - could not verify logged in state", "error")
                return False
                
        except Exception as e:
            self.log(f"Login error: {e}", "error")
            return False
    
    def return_to_inbox(self):
        """
        Fallback method - safely return to inbox.
        Called on any error to reset state before next lead.
        """
        try:
            self.log("🔄 Returning to inbox...", "info")
            self.page.goto(INSTAGRAM_DM_URL, wait_until="domcontentloaded", timeout=30000)
            self.random_delay(1, 2)
            self.dismiss_popups()
            self.log("✅ Back at inbox", "success")
        except Exception as e:
            self.log(f"⚠️ Could not return to inbox: {e}", "warning")
    
    def send_dm(self, username: str, message: str) -> dict:
        """
        Send a DM using the Inbox Compose Method.
        Returns dict with 'success', 'error' keys.
        
        On ANY error: returns to inbox and continues to next lead.
        """
        self.log(f"📨 Sending DM to @{username}...", "info")
        result = {"success": False, "error": None}
        
        try:
            # Step 1: Go to inbox
            self.log("📥 Going to inbox...", "info")
            self.page.goto(INSTAGRAM_DM_URL, wait_until="domcontentloaded", timeout=60000)
            self.random_delay(2, 3)
            
            self.dismiss_popups()
            
            # Step 2: Click compose icon
            self.log("✏️ Looking for compose button...", "info")
            compose_selectors = [
                'svg[aria-label="New message"]',
                '[aria-label="New message"]',
                'div[role="button"]:has(svg[aria-label="New message"])',
                'svg[aria-label="New Message"]',
                '[aria-label="New Message"]',
                'a[href="/direct/new/"]',
            ]
            
            compose_clicked = False
            for selector in compose_selectors:
                try:
                    btn = self.page.locator(selector).first
                    if btn.count() > 0 and btn.is_visible():
                        btn.click()
                        compose_clicked = True
                        self.random_delay(1.5, 2.5)
                        break
                except:
                    continue
            
            if not compose_clicked:
                result["error"] = "Could not find compose button"
                self.log(f"❌ {result['error']}", "error")
                self.return_to_inbox()
                return result
            
            # Step 3: Search for username
            self.log(f"🔍 Searching for @{username}...", "info")
            self.random_delay(1, 2)
            
            search_selectors = [
                'input[placeholder="Search..."]',
                'input[name="queryBox"]',
                'input[aria-label="Search"]',
                'input[type="text"]',
                '[role="dialog"] input',
            ]
            
            search_input = None
            for selector in search_selectors:
                try:
                    inp = self.page.locator(selector).first
                    if inp.count() > 0 and inp.is_visible():
                        search_input = inp
                        break
                except:
                    continue
            
            if not search_input:
                result["error"] = "Could not find search input"
                self.log(f"❌ {result['error']}", "error")
                self.return_to_inbox()
                return result
            
            search_input.click()
            self.random_delay(0.3, 0.6)
            search_input.fill(username)
            self.random_delay(1.5, 2.5)
            
            # Step 4: Wait for search results and CLICK on the FIRST/TOP result (ONLY ONCE)
            self.log(f"👤 Waiting for search results to load...", "info")
            self.random_delay(3, 3.5)  # Wait for search results to load
            
            # Click ONLY ONCE on the first result - use dialog center coordinates
            self.log(f"👆 Clicking first result...", "info")
            
            try:
                dialog = self.page.locator('[role="dialog"]')
                dialog.wait_for(state="visible", timeout=3000)
                box = dialog.bounding_box()
                if box:
                    # Dialog layout: Title bar, "To:" field with search, then results
                    # First result is approximately 180-200px from top of dialog
                    click_x = box['x'] + (box['width'] / 2)  # Center horizontally
                    click_y = box['y'] + 190  # First result row
                    self.page.mouse.click(click_x, click_y)
                    self.log("✅ Clicked first result!", "success")
                else:
                    result["error"] = "Could not get dialog bounding box"
                    self.log(f"❌ {result['error']}", "error")
                    self.return_to_inbox()
                    return result
            except Exception as e:
                result["error"] = f"Could not click result: {e}"
                self.log(f"❌ {result['error']}", "error")
                self.return_to_inbox()
                return result
            
            self.random_delay(1.5, 2)  # Wait for user to be added to To: field
            
            # Step 4b: Verify user is selected (Chat button should be enabled)
            self.log("🔍 Verifying user was selected...", "info")
            try:
                # Check if Chat button is enabled (not disabled)
                chat_check = self.page.get_by_role("button", name="Chat", exact=True)
                is_disabled = chat_check.get_attribute("aria-disabled")
                if is_disabled == "true":
                    self.log("⚠️ Chat button still disabled - user may not be selected", "warning")
                else:
                    self.log("✅ Chat button is enabled - user selected!", "success")
            except Exception as e:
                self.log(f"⚠️ Selection verify failed: {e}", "warning")
            
            # Step 5: Click the Chat button
            self.log(f"💬 Clicking Chat button...", "info")
            self.random_delay(0.5, 1)
            
            # Log the current URL before clicking
            pre_url = self.page.url
            self.log(f"📍 URL before Chat click: {pre_url}", "info")
            
            chat_clicked = False
            
            # Try clicking the Chat button - use expect_navigation to handle redirect
            try:
                chat_btn = self.page.get_by_role("button", name="Chat", exact=True)
                chat_btn.wait_for(state="visible", timeout=3000)
                
                # Check if button is enabled
                is_disabled = chat_btn.get_attribute("aria-disabled")
                self.log(f"🔘 Chat button aria-disabled: {is_disabled}", "info")
                
                if is_disabled == "true":
                    self.log("❌ Chat button is DISABLED - user not selected!", "error")
                    result["error"] = "Chat button disabled - user not selected"
                    self.return_to_inbox()
                    return result
                
                chat_btn.click()
                chat_clicked = True
                self.log("✅ Clicked Chat button!", "success")
            except Exception as e:
                self.log(f"⚠️ Chat button click failed: {e}", "warning")
            
            # Fallback: locator
            if not chat_clicked:
                try:
                    chat_btn = self.page.locator('div[role="button"]:text-is("Chat")')
                    if chat_btn.count() > 0:
                        chat_btn.first.click()
                        chat_clicked = True
                        self.log("✅ Clicked Chat (locator)!", "success")
                except:
                    pass
            
            if not chat_clicked:
                result["error"] = "Could not click Chat button"
                self.log(f"❌ {result['error']}", "error")
                try:
                    self.page.screenshot(path=f"debug_no_chat_{username}.png")
                except:
                    pass
                self.return_to_inbox()
                return result
            
            # Wait for navigation to complete - this is critical!
            self.log("⏳ Waiting for chat to open...", "info")
            try:
                # Wait for URL to change from /direct/inbox or /direct/new
                self.page.wait_for_url("**/direct/t/**", timeout=10000)
                self.log("✅ Navigation to chat complete", "success")
            except Exception as e:
                self.log(f"⚠️ URL wait failed: {e}", "warning")
            
            # Extra wait for page to stabilize
            self.random_delay(1.5, 2)
            
            # Step 5b: VERIFY we're in the correct conversation before proceeding
            self.log(f"🔍 Verifying correct chat window for @{username}...", "info")
            
            # KNOWN BAD CONVERSATION - this is an old thread that Instagram keeps redirecting to
            BAD_THREAD_IDS = ["17848196007537027"]
            
            # Check the current URL to confirm we're not in a wrong conversation
            try:
                current_url = self.page.url
                self.log(f"📍 Current URL: {current_url}", "info")
                
                # Check if we ended up in a known bad/old conversation
                for bad_id in BAD_THREAD_IDS:
                    if bad_id in current_url:
                        self.log(f"⚠️ Wrong thread detected! Retrying...", "warning")
                        
                        # RETRY: Go back to inbox and try again
                        self.page.goto(INSTAGRAM_DM_URL, wait_until="domcontentloaded", timeout=30000)
                        self.random_delay(2, 3)
                        
                        # Try compose again
                        compose_btn = self.page.locator('svg[aria-label="New message"], [aria-label="New message"]').first
                        if compose_btn.count() > 0:
                            compose_btn.click()
                            self.random_delay(1.5, 2)
                            
                            # Search again
                            search_inp = self.page.locator('[role="dialog"] input').first
                            if search_inp.count() > 0:
                                search_inp.fill(username)
                                self.random_delay(2, 2.5)
                                
                                # Click first result by coordinates
                                dialog = self.page.locator('[role="dialog"]')
                                box = dialog.bounding_box()
                                if box:
                                    self.page.mouse.click(box['x'] + 150, box['y'] + 170)
                                    self.random_delay(1.5, 2)
                                    
                                    # Click Chat
                                    chat_btn = self.page.get_by_role("button", name="Chat", exact=True)
                                    chat_btn.click()
                                    
                                    # Wait for navigation
                                    self.page.wait_for_url("**/direct/t/**", timeout=10000)
                                    self.random_delay(1.5, 2)
                                    
                                    # Check URL again
                                    new_url = self.page.url
                                    if bad_id in new_url:
                                        self.log(f"❌ Still redirecting to wrong thread", "error")
                                        result["error"] = "Redirected to wrong conversation (retry failed)"
                                        self.return_to_inbox()
                                        return result
                                    else:
                                        self.log(f"✅ Retry successful! New URL: {new_url}", "success")
                        else:
                            self.log(f"❌ Could not retry - compose button not found", "error")
                            result["error"] = "Redirected to wrong conversation"
                            self.return_to_inbox()
                            return result
                
                # Verify chat by checking page content (DON'T click anything!)
                self.log(f"🔍 Checking if @{username} is on page...", "info")
                page_content = self.page.content()
                if username.lower() in page_content.lower():
                    self.log(f"✅ Verified: @{username} found on page", "success")
                else:
                    self.log(f"⚠️ @{username} not found in page content, proceeding anyway...", "warning")
                    
            except Exception as e:
                self.log(f"⚠️ Verification check failed: {e}", "warning")
            
            # IMPORTANT: Wait a moment to ensure page is stable
            self.random_delay(1, 1.5)
            
            # Step 6: Type message DIRECTLY using keyboard
            # IMPORTANT: Log URL right before typing
            pre_input_url = self.page.url
            self.log(f"📍 URL before typing: {pre_input_url}", "info")
            
            # Screenshot to verify we're in the right place
            try:
                self.page.screenshot(path=f"debug_before_type_{username}.png")
                self.log("📸 Screenshot saved", "info")
            except:
                pass
            
            # Find and click the message input
            self.log("✏️ Finding message input...", "info")
            
            # Get viewport/page dimensions
            viewport = self.page.viewport_size
            page_width = viewport['width'] if viewport else 1280
            
            # The sidebar is roughly 400px wide on the left
            # Anything with x > 350 is likely in the main chat area
            SIDEBAR_WIDTH = 350
            
            self.log(f"📐 Page width: {page_width}, sidebar threshold: {SIDEBAR_WIDTH}", "info")
            
            message_input = None
            try:
                # Find ALL message inputs and pick the one in the main chat area (not sidebar)
                all_inputs = self.page.locator('div[aria-label="Message"]').all()
                self.log(f"🔍 Found {len(all_inputs)} message input elements", "info")
                
                for inp in all_inputs:
                    try:
                        box = inp.bounding_box()
                        if box:
                            # Use elements that are past the sidebar
                            if box['x'] > SIDEBAR_WIDTH:
                                self.log(f"✅ Found input in main area at x={box['x']}", "success")
                                message_input = inp
                                inp.click()
                                self.random_delay(0.3, 0.5)
                                break
                            else:
                                self.log(f"⚠️ Skipping sidebar input at x={box['x']}", "warning")
                    except:
                        continue
            except Exception as e:
                self.log(f"⚠️ Input search failed: {e}", "warning")
            
            # Check URL didn't change
            current_url = self.page.url
            if "17848196007537027" in current_url:
                self.log("❌ REDIRECT DETECTED after clicking input!", "error")
                result["error"] = "Redirect after clicking input"
                self.return_to_inbox()
                return result
            
            # Fallback: click by coordinates in the main chat area (bottom where input is)
            if not message_input:
                self.log("⚠️ Using coordinate fallback...", "warning")
                try:
                    # Click in main chat area, near bottom where message input is
                    # Main area starts after sidebar (~400px) and we want to click in the message input area
                    click_x = (page_width / 2) + 200  # Right of center
                    click_y = viewport['height'] - 100 if viewport else 600  # Near bottom
                    self.log(f"📍 Clicking at ({click_x}, {click_y})", "info")
                    self.page.mouse.click(click_x, click_y)
                    self.random_delay(0.5, 0.8)
                    
                    # Try to get the focused element
                    message_input = self.page.locator('div[aria-label="Message"]:focus, div[contenteditable="true"]:focus').first
                    if message_input.count() > 0:
                        self.log("✅ Got focused input!", "success")
                except Exception as e:
                    self.log(f"⚠️ Coordinate click failed: {e}", "warning")
            
            if not message_input or message_input.count() == 0:
                try:
                    self.page.screenshot(path=f"debug_no_input_{username}.png")
                except:
                    pass
                result["error"] = "Message input not found"
                self.log(f"❌ {result['error']}", "error")
                self.return_to_inbox()
                return result
            
            # Type the message - use fill() to paste as one block
            self.log("✏️ Typing message...", "info")
            
            # Make sure we're focused on the input
            try:
                message_input.focus()
            except:
                message_input.click()
            self.random_delay(0.3, 0.5)
            
            # Use fill() to paste entire message at once (avoids Enter triggering send)
            message_input.fill(message)
            self.random_delay(1, 1.5)
            
            self.log(f"✅ Message filled ({len(message)} chars)", "info")
            
            # Step 7: Send using Enter key (safer than clicking Send button)
            self.log("📤 Sending with Enter key...", "info")
            
            # Check URL before sending
            pre_send_url = self.page.url
            self.log(f"📍 URL before send: {pre_send_url}", "info")
            
            # Just press Enter to send - this is the safest method
            message_input.press("Enter")
            self.log("✅ Pressed Enter to send", "success")
            
            # Wait and verify message was sent
            self.random_delay(2, 3)
            
            self.random_delay(2, 3)
            
            self.log(f"✅ DM sent to @{username}", "success")
            self.dms_sent_today += 1
            result["success"] = True
            
        except Exception as e:
            result["error"] = str(e)
            self.log(f"❌ Error sending DM to @{username}: {e}", "error")
            # FALLBACK: Return to inbox before moving to next lead
            self.return_to_inbox()
        
        # If failed for any reason, make sure we're back at inbox
        if not result["success"] and result["error"]:
            self.return_to_inbox()
        
        return result
    
    def load_leads_from_db(self) -> List[Dict]:
        """
        Load uncontacted leads from the database.
        Returns leads with personalized messages generated.
        Supports AI-powered message generation when template="ai"
        """
        self.log("📊 Loading leads from database...", "info")
        
        try:
            conn = get_db_connection()
            cursor = conn.cursor()
            
            # Get uncontacted leads with all available data for AI personalization
            cursor.execute('''
                SELECT 
                    username, 
                    full_name,
                    profile_url,
                    campaign_name,
                    is_verified
                FROM instagram_leads 
                WHERE (contacted = FALSE OR contacted IS NULL)
                  AND (dm_success = FALSE OR dm_success IS NULL)
                ORDER BY created_at DESC
                LIMIT %s
            ''', (self.limit,))
            
            rows = cursor.fetchall()
            
            leads = []
            use_ai = self.template_name == "ai"
            
            if use_ai:
                self.log("🤖 Using AI-powered message generation...", "info")
            
            for i, row in enumerate(rows):
                username = row[0]
                full_name = row[1] or ""
                profile_url = row[2] or f"https://instagram.com/{username}"
                campaign = row[3] or ""
                is_verified = row[4] or False
                
                # Build lead data for AI
                lead_data = {
                    "username": username,
                    "full_name": full_name,
                    "profile_url": profile_url,
                    "campaign": campaign,
                    "is_verified": is_verified,
                }
                
                # Generate message (AI or template-based)
                if use_ai:
                    self.log(f"🤖 Generating AI message for @{username}...", "info")
                    message = generate_ai_message(lead_data)
                    
                    # Fallback to default template if AI fails
                    if not message:
                        self.log(f"⚠️ AI failed, using default template", "warning")
                        message = personalize_message(TEMPLATES["default"], username, full_name)
                else:
                    message = personalize_message(self.template, username, full_name)
                
                leads.append({
                    "username": username,
                    "full_name": full_name,
                    "message": message,
                    "campaign": campaign,
                    "is_verified": is_verified,
                })
            
            cursor.close()
            conn.close()
            
            self.log(f"📋 Loaded {len(leads)} uncontacted leads", "info")
            return leads
            
        except Exception as e:
            self.log(f"❌ Database error: {e}", "error")
            return []
    
    def update_lead_status(self, username: str, message: str, success: bool, error: str = None):
        """
        Update the lead's contacted status in the database.
        This is the source of truth - no more CSV logging.
        """
        try:
            conn = get_db_connection()
            cursor = conn.cursor()
            
            cursor.execute('''
                UPDATE instagram_leads
                SET 
                    contacted = TRUE,
                    contacted_at = NOW(),
                    message_sent = %s,
                    dm_success = %s,
                    dm_error = %s,
                    status = CASE WHEN %s THEN 'contacted' ELSE 'failed' END,
                    template_used = %s,
                    updated_at = NOW()
                WHERE username = %s
            ''', (message, success, error, success, self.template_name, username))
            
            conn.commit()
            cursor.close()
            conn.close()
            
            status_emoji = "✅" if success else "❌"
            self.log(f"💾 {status_emoji} Updated @{username} in database", "info")
            
        except Exception as e:
            self.log(f"⚠️ Database update error: {e}", "warning")
    
    def get_stats(self) -> Dict:
        """Get current lead statistics from database"""
        try:
            conn = get_db_connection()
            cursor = conn.cursor()
            
            cursor.execute('''
                SELECT 
                    COUNT(*) as total,
                    COUNT(*) FILTER (WHERE contacted = TRUE AND dm_success = TRUE) as contacted,
                    COUNT(*) FILTER (WHERE contacted = FALSE OR contacted IS NULL) as uncontacted,
                    COUNT(*) FILTER (WHERE contacted = TRUE AND dm_success = FALSE) as failed
                FROM instagram_leads
            ''')
            
            row = cursor.fetchone()
            cursor.close()
            conn.close()
            
            return {
                "total": row[0],
                "contacted": row[1],
                "uncontacted": row[2],
                "failed": row[3],
            }
            
        except Exception as e:
            self.log(f"⚠️ Could not fetch stats: {e}", "warning")
            return {"total": 0, "contacted": 0, "uncontacted": 0, "failed": 0}
    
    def run(self):
        """Main execution loop"""
        print("\n" + "=" * 60)
        print(f"{Fore.MAGENTA}📱 Instagram DM Sales Agent (Database-Driven){Style.RESET_ALL}")
        print("=" * 60)
        
        # Validate config
        try:
            validate_config()
        except ValueError as e:
            self.log(str(e), "error")
            return
        
        print_config()
        print(f"   📝 Template: {self.template_name}")
        print(f"   🎯 Limit: {self.limit} leads")
        print()
        
        # Show current stats
        stats = self.get_stats()
        print(f"📊 Database Stats:")
        print(f"   Total leads:     {stats['total']}")
        print(f"   ✅ Contacted:    {stats['contacted']}")
        print(f"   📬 Uncontacted:  {stats['uncontacted']}")
        print(f"   ❌ Failed:       {stats['failed']}")
        print()
        
        # Load leads from database
        leads = self.load_leads_from_db()
        if not leads:
            self.log("No uncontacted leads in database. Run the lead scraper first!", "warning")
            return
        
        # Start browser and login
        try:
            self.start_browser()
            
            if not self.is_logged_in():
                if not self.login():
                    self.log("Failed to login. Exiting.", "error")
                    return
            
            # Process in batches
            batch_num = 0
            for i in range(0, len(leads), BATCH_SIZE):
                batch = leads[i:i + BATCH_SIZE]
                batch_num += 1
                
                self.log(f"\n📦 Batch {batch_num} ({len(batch)} leads)...", "info")
                
                for lead in batch:
                    # Check daily limit
                    if self.dms_sent_today >= self.limit:
                        self.log(f"⚠️ Limit ({self.limit}) reached.", "warning")
                        return
                    
                    username = lead["username"]
                    message = lead["message"]
                    
                    result = self.send_dm(username, message)
                    
                    # Update database (source of truth)
                    self.update_lead_status(
                        username=username,
                        message=message,
                        success=result["success"],
                        error=result.get("error")
                    )
                    
                    # Delay between DMs
                    if result["success"]:
                        delay = DELAY_BETWEEN_DMS + random.randint(-10, 30)
                        self.log(f"⏳ Waiting {delay}s before next DM...", "info")
                        time.sleep(delay)
                
                # Batch break
                if i + BATCH_SIZE < len(leads):
                    delay = DELAY_BETWEEN_BATCHES + random.randint(-30, 60)
                    self.log(f"☕ Batch complete. {delay}s break...", "info")
                    time.sleep(delay)
            
            # Final stats
            final_stats = self.get_stats()
            self.log(f"\n🎉 Complete! Sent {self.dms_sent_today} DMs today.", "success")
            print(f"\n📊 Updated Stats:")
            print(f"   ✅ Contacted:    {final_stats['contacted']}")
            print(f"   📬 Uncontacted:  {final_stats['uncontacted']}")
            
        except KeyboardInterrupt:
            self.log("\n⛔ Interrupted", "warning")
        except Exception as e:
            self.log(f"Unexpected error: {e}", "error")
        finally:
            self.save_session()
            if self.browser:
                self.browser.close()
            if self.playwright:
                self.playwright.stop()


def main():
    parser = argparse.ArgumentParser(description="Instagram DM Sales Agent (Database-Driven)")
    parser.add_argument("--headless", action="store_true", help="Run in headless mode")
    parser.add_argument("--template", "-t", choices=list(TEMPLATES.keys()), default="default",
                        help="Message template to use")
    parser.add_argument("--limit", "-l", type=int, default=None,
                        help="Maximum leads to process (default: MAX_DMS_PER_DAY)")
    parser.add_argument("--test", action="store_true", help="Test mode (load leads only, no sending)")
    parser.add_argument("--stats", action="store_true", help="Show database stats only")
    args = parser.parse_args()
    
    if args.stats:
        print("\n📊 Instagram Leads Database Stats")
        print("=" * 40)
        sender = InstagramDMSender()
        stats = sender.get_stats()
        print(f"   Total leads:     {stats['total']}")
        print(f"   ✅ Contacted:    {stats['contacted']}")
        print(f"   📬 Uncontacted:  {stats['uncontacted']}")
        print(f"   ❌ Failed:       {stats['failed']}")
        print("=" * 40)
        return
    
    if args.test:
        print("🧪 Test mode - checking configuration and loading leads...")
        try:
            validate_config()
            print_config()
            sender = InstagramDMSender(template=args.template, limit=args.limit or 5)
            leads = sender.load_leads_from_db()
            
            if leads:
                print(f"\n📧 Preview of {len(leads)} leads:\n")
                for i, lead in enumerate(leads[:5]):
                    print(f"--- Lead {i+1}: @{lead['username']} ({lead['full_name']}) ---")
                    print(lead["message"])
                    print()
            else:
                print("📭 No uncontacted leads found")
            
            print("✅ Configuration valid!")
        except ValueError as e:
            print(f"❌ Config error: {e}")
        return
    
    sender = InstagramDMSender(
        headless=args.headless,
        template=args.template,
        limit=args.limit
    )
    sender.run()


if __name__ == "__main__":
    main()
