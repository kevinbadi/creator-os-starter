"""
Configuration for Instagram DM Sales Agent
Environment variables with sensible defaults
"""
import os
from pathlib import Path
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

# Base paths
BASE_DIR = Path(__file__).parent

# Instagram Credentials (REQUIRED)
INSTAGRAM_USERNAME = os.getenv("INSTAGRAM_USERNAME", "")
INSTAGRAM_PASSWORD = os.getenv("INSTAGRAM_PASSWORD", "")

# Rate Limiting (seconds) - Keep HIGH to avoid bans
DELAY_BETWEEN_DMS = int(os.getenv("DELAY_BETWEEN_DMS", "60"))
DELAY_BETWEEN_BATCHES = int(os.getenv("DELAY_BETWEEN_BATCHES", "300"))

# Batch Settings
BATCH_SIZE = int(os.getenv("BATCH_SIZE", "10"))
MAX_DMS_PER_DAY = int(os.getenv("MAX_DMS_PER_DAY", "50"))

# Browser Settings
HEADLESS = os.getenv("HEADLESS", "false").lower() == "true"
SLOW_MO = int(os.getenv("SLOW_MO", "100"))

# File paths
LEADS_FILE = os.getenv("INSTAGRAM_LEADS_FILE", str(BASE_DIR / "instagram_leads.csv"))
SENT_LOG_FILE = os.getenv("INSTAGRAM_SENT_LOG", str(BASE_DIR / "instagram_sent_log.csv"))
SESSION_FILE = os.getenv("INSTAGRAM_SESSION_FILE", str(BASE_DIR / "instagram_session.json"))

# Instagram URLs
INSTAGRAM_BASE_URL = "https://www.instagram.com"
INSTAGRAM_LOGIN_URL = f"{INSTAGRAM_BASE_URL}/accounts/login/"
INSTAGRAM_DM_URL = f"{INSTAGRAM_BASE_URL}/direct/inbox/"

# Database (optional)
DATABASE_URL = os.getenv("DATABASE_URL", "")


def validate_config():
    """Validate required configuration"""
    errors = []
    
    if not INSTAGRAM_USERNAME:
        errors.append("INSTAGRAM_USERNAME is required. Set it in .env file")
    if not INSTAGRAM_PASSWORD:
        errors.append("INSTAGRAM_PASSWORD is required. Set it in .env file")
    
    if errors:
        raise ValueError("\n".join(errors))
    
    return True


def print_config():
    """Print current configuration (without sensitive data)"""
    print("\n📋 Instagram DM Agent Configuration:")
    print(f"   Username: {INSTAGRAM_USERNAME[:3]}***" if INSTAGRAM_USERNAME else "   Username: NOT SET")
    print(f"   Delay between DMs: {DELAY_BETWEEN_DMS}s")
    print(f"   Delay between batches: {DELAY_BETWEEN_BATCHES}s")
    print(f"   Batch size: {BATCH_SIZE}")
    print(f"   Max DMs per day: {MAX_DMS_PER_DAY}")
    print(f"   Headless mode: {HEADLESS}")
    print(f"   Leads file: {LEADS_FILE}")
    print(f"   Sent log: {SENT_LOG_FILE}")
    print()











