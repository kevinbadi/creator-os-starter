#!/usr/bin/env python3
"""
Instagram DM Multi-Account Runner

Run the DM agent with different Instagram accounts simultaneously.
Each account gets its own session, logs, and can run in parallel.

Usage:
    # Run with account 1
    python instagram_dm_multi_account.py --account 1

    # Run with account 2
    python instagram_dm_multi_account.py --account 2

    # Run both simultaneously (in separate terminals)
    python instagram_dm_multi_account.py --account 1 &
    python instagram_dm_multi_account.py --account 2 &

Setup:
    Add to .env:
        # Account 1
        IG_ACCOUNT_1_USERNAME=account1_username
        IG_ACCOUNT_1_PASSWORD=account1_password
        
        # Account 2
        IG_ACCOUNT_2_USERNAME=account2_username
        IG_ACCOUNT_2_PASSWORD=account2_password
"""

import os
import sys
import argparse
from pathlib import Path
from dotenv import load_dotenv

# Add parent to path for imports
sys.path.insert(0, str(Path(__file__).parent))

load_dotenv()

def get_account_config(account_num: int) -> dict:
    """Get credentials and paths for a specific account."""
    
    username = os.getenv(f'IG_ACCOUNT_{account_num}_USERNAME')
    password = os.getenv(f'IG_ACCOUNT_{account_num}_PASSWORD')
    
    if not username or not password:
        # Fallback to default credentials for account 1
        if account_num == 1:
            username = os.getenv('INSTAGRAM_USERNAME')
            password = os.getenv('INSTAGRAM_PASSWORD')
    
    if not username or not password:
        raise ValueError(f"Missing credentials for account {account_num}. "
                        f"Set IG_ACCOUNT_{account_num}_USERNAME and IG_ACCOUNT_{account_num}_PASSWORD in .env")
    
    base_dir = Path(__file__).parent
    
    return {
        'username': username,
        'password': password,
        'session_file': str(base_dir / f'instagram_session_account{account_num}.json'),
        'sent_log_file': str(base_dir / f'instagram_sent_log_account{account_num}.csv'),
        'leads_file': str(base_dir / 'instagram_leads.csv'),  # Shared leads file
        'account_num': account_num,
    }


def run_agent_with_account(account_num: int, headless: bool = False):
    """Run the DM agent with a specific account configuration."""
    
    config = get_account_config(account_num)
    
    print(f"\n{'='*60}")
    print(f"📱 Instagram DM Agent - ACCOUNT {account_num}")
    print(f"{'='*60}")
    print(f"   Username: {config['username'][:3]}***")
    print(f"   Session:  {config['session_file']}")
    print(f"   Sent Log: {config['sent_log_file']}")
    print(f"{'='*60}\n")
    
    # Override environment variables for this run
    os.environ['INSTAGRAM_USERNAME'] = config['username']
    os.environ['INSTAGRAM_PASSWORD'] = config['password']
    os.environ['INSTAGRAM_SESSION_FILE'] = config['session_file']
    os.environ['INSTAGRAM_SENT_LOG'] = config['sent_log_file']
    
    # Now import and run the agent (it will pick up the env vars)
    from instagram_dm_config import (
        INSTAGRAM_USERNAME,
        INSTAGRAM_PASSWORD,
        DELAY_BETWEEN_DMS,
        DELAY_BETWEEN_BATCHES,
        BATCH_SIZE,
        MAX_DMS_PER_DAY,
        INSTAGRAM_BASE_URL,
        INSTAGRAM_LOGIN_URL,
        INSTAGRAM_DM_URL,
        SLOW_MO,
        DATABASE_URL,
    )
    
    # Import the sender class
    from instagram_dm_sales_agent import InstagramDMSender
    
    # Create custom sender with account-specific paths
    class MultiAccountDMSender(InstagramDMSender):
        def __init__(self, account_config, headless=False):
            super().__init__(headless=headless)
            self.account_config = account_config
            self.session_file = Path(account_config['session_file'])
            
        def load_leads(self):
            """Load leads from the configured file."""
            import csv
            leads = []
            leads_path = Path(self.account_config['leads_file'])
            
            if not leads_path.exists():
                self.log(f"❌ Leads file not found: {leads_path}", "error")
                return []
            
            with open(leads_path, "r", encoding="utf-8") as f:
                reader = csv.DictReader(f)
                for row in reader:
                    username = row.get("username", "").strip().replace("@", "")
                    message = row.get("message", "").strip()
                    if username and message:
                        leads.append({"username": username, "message": message})
            
            self.log(f"📋 Loaded {len(leads)} leads from {leads_path}", "info")
            return leads
        
        def load_sent_log(self):
            """Load already-contacted usernames from DATABASE (source of truth) + CSVs."""
            import csv
            sent = set()
            
            # PRIMARY: Load from database where dm_success = TRUE
            if DATABASE_URL:
                try:
                    import psycopg2
                    conn = psycopg2.connect(DATABASE_URL)
                    cursor = conn.cursor()
                    cursor.execute('SELECT username FROM instagram_leads WHERE dm_success = TRUE')
                    for row in cursor.fetchall():
                        if row[0]:
                            sent.add(row[0].strip())
                    cursor.close()
                    conn.close()
                    self.log(f"📊 Database: {len(sent)} already contacted", "info")
                except Exception as e:
                    self.log(f"⚠️ DB error: {e}", "warning")
            
            # ALSO check all CSV logs for safety
            impl_dir = Path(__file__).parent
            for log_name in ["instagram_sent_log.csv", "instagram_sent_log_account1.csv", "instagram_sent_log_account2.csv"]:
                log_path = impl_dir / log_name
                if log_path.exists():
                    try:
                        with open(log_path, "r", encoding="utf-8") as f:
                            reader = csv.DictReader(f)
                            for row in reader:
                                if row.get("success", "").lower() == "true":
                                    sent.add(row.get("username", "").strip())
                    except Exception:
                        pass
            
            return sent
        
        def log_sent(self, username: str, success: bool, error: str = None):
            """Log sent DM to account-specific CSV."""
            import csv
            from datetime import datetime
            
            sent_path = Path(self.account_config['sent_log_file'])
            is_new = not sent_path.exists()
            
            with open(sent_path, "a", encoding="utf-8", newline="") as f:
                writer = csv.writer(f)
                if is_new:
                    writer.writerow(["username", "timestamp", "success", "error", "account"])
                writer.writerow([
                    username, 
                    datetime.now().isoformat(), 
                    success, 
                    error or "",
                    self.account_config['account_num']
                ])
    
    # Run the agent
    sender = MultiAccountDMSender(config, headless=headless)
    sender.run()


def main():
    parser = argparse.ArgumentParser(description="Instagram DM Multi-Account Runner")
    parser.add_argument(
        "--account", "-a",
        type=int,
        choices=[1, 2, 3, 4, 5],
        help="Account number to use (1-5)"
    )
    parser.add_argument(
        "--headless",
        action="store_true",
        help="Run in headless mode"
    )
    parser.add_argument(
        "--list",
        action="store_true",
        help="List configured accounts"
    )
    
    args = parser.parse_args()
    
    if args.list:
        print("\n📱 Configured Instagram Accounts:")
        print("-" * 40)
        for i in range(1, 6):
            username = os.getenv(f'IG_ACCOUNT_{i}_USERNAME')
            if username:
                print(f"   Account {i}: {username}")
            elif i == 1:
                # Check default
                username = os.getenv('INSTAGRAM_USERNAME')
                if username:
                    print(f"   Account 1: {username} (default)")
        return
    
    if not args.account:
        parser.error("--account is required when not using --list")
    
    run_agent_with_account(args.account, args.headless)


if __name__ == "__main__":
    main()

