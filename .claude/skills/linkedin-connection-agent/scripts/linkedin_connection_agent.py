#!/usr/bin/env python3
"""
LinkedIn Connection Agent - Fetch analytics and track connection requests via PhantomBuster

CORRECT METRICS PARSING:
- total_sent: Profiles with invitationDate (we sent them an invite)
- total_accepted: Profiles with status = "Request accepted"
- pending: Profiles with status = "Invitation sent"

Usage:
    ./venv/bin/python3 implementation/linkedin_connection_agent.py --analytics
    ./venv/bin/python3 implementation/linkedin_connection_agent.py --store  # Store results in DB
"""

import os
import sys
import json
import time
import requests
import psycopg2
from datetime import datetime
from dotenv import load_dotenv
import argparse

# Load environment variables
load_dotenv()

# Configuration
PHANTOMBUSTER_API_KEY = os.getenv('PHANTOMBUSTER_API_KEY')
AGENT_ID = os.getenv('PHANTOMBUSTER_AGENT_ID', '685897070795556')
API_BASE_URL = "https://api.phantombuster.com/api/v2"
DATABASE_URL = os.getenv('DATABASE_URL')

if not PHANTOMBUSTER_API_KEY:
    raise ValueError("PHANTOMBUSTER_API_KEY not found in environment variables")

def get_phantombuster_headers():
    """Get headers for PhantomBuster API requests"""
    return {
        'X-Phantombuster-Key-1': PHANTOMBUSTER_API_KEY,
        'Content-Type': 'application/json'
    }

def fetch_agent_results():
    """
    Fetch results from PhantomBuster agent
    
    Returns:
        tuple: (profiles list, result_json_url)
    """
    url = f"{API_BASE_URL}/agents/fetch-output"
    params = {'id': AGENT_ID}
    headers = get_phantombuster_headers()

    print(f"🔍 Fetching results for agent {AGENT_ID}...")

    response = requests.get(url, params=params, headers=headers)

    if response.status_code != 200:
        print(f"❌ API Error {response.status_code}: {response.text}")
        return None, None

    data = response.json()
    output = data.get('output', '')

    # Extract JSON URL from output
    result_json_url = None
    for line in output.split('\n'):
        if 'JSON saved at' in line and 'https://' in line:
            start = line.find('https://')
            end = line.find(' ', start) if line.find(' ', start) != -1 else len(line)
            result_json_url = line[start:end].strip()
            break

    # Fallback to known S3 URL pattern if not found in output
    if not result_json_url:
        # Get agent info to find S3 folder
        agent_info = requests.get(
            f"{API_BASE_URL}/agents/fetch",
            params={'id': AGENT_ID},
            headers=headers
        )
        if agent_info.status_code == 200:
            agent_data = agent_info.json()
            org_folder = agent_data.get('orgS3Folder', '')
            s3_folder = agent_data.get('s3Folder', '')
            if org_folder and s3_folder:
                result_json_url = f"https://phantombuster.s3.amazonaws.com/{org_folder}/{s3_folder}/result.json"
                print(f"📄 Using S3 URL: {result_json_url}")

    if not result_json_url:
        print("❌ No result JSON URL found")
        return None, None

    # Fetch profiles
    json_response = requests.get(result_json_url)
    if json_response.status_code != 200:
        print(f"❌ Failed to fetch JSON: {json_response.status_code}")
        return None, None

    profiles = json_response.json()
    print(f"✅ Retrieved {len(profiles)} profiles")
    
    return profiles, result_json_url

def parse_metrics(profiles):
    """
    CORRECT PARSING of LinkedIn agent metrics
    
    - total_sent: Profiles with invitationDate (we sent them an invite)
    - total_accepted: Profiles with status = "Request accepted"
    - pending: Profiles with status = "Invitation sent"
    
    Returns:
        dict: Parsed metrics
    """
    invites_sent = []
    requests_accepted = []
    pending_invites = []
    
    for profile in profiles:
        invitation_date = profile.get('invitationDate', '')
        status = profile.get('status', '')
        
        # Only count profiles where WE sent an invitation
        if invitation_date:
            invites_sent.append(profile)
            
            if status == 'Request accepted':
                requests_accepted.append(profile)
            elif status == 'Invitation sent':
                pending_invites.append(profile)

    total_sent = len(invites_sent)
    total_accepted = len(requests_accepted)
    pending = len(pending_invites)
    acceptance_rate = (total_accepted / total_sent * 100) if total_sent > 0 else 0

    return {
        'total_sent': total_sent,
        'total_accepted': total_accepted,
        'pending': pending,
        'acceptance_rate': acceptance_rate,
        'invites_sent': invites_sent,
        'requests_accepted': requests_accepted,
        'pending_invites': pending_invites
    }

def display_analytics(metrics):
    """Display formatted analytics"""
    print("\n" + "=" * 60)
    print("📊 LINKEDIN CONNECTION AGENT ANALYTICS")
    print("=" * 60)
    
    print(f"\n✅ TOTAL SENT: {metrics['total_sent']}")
    print(f"🎉 TOTAL ACCEPTED: {metrics['total_accepted']}")
    print(f"⏳ PENDING: {metrics['pending']}")
    print(f"📈 ACCEPTANCE RATE: {metrics['acceptance_rate']:.1f}%")
    
    if metrics['requests_accepted']:
        print("\n🎉 ACCEPTED CONNECTIONS:")
        print("-" * 50)
        for p in metrics['requests_accepted']:
            print(f"   🤝 {p.get('name', 'Unknown')}")
            print(f"      Company: {p.get('companyName', 'N/A')}")
            print(f"      Invitation Sent: {p.get('invitationDate', 'N/A')}")
            print()
    
    if metrics['pending_invites']:
        print("\n⏳ PENDING INVITATIONS:")
        print("-" * 50)
        for p in metrics['pending_invites']:
            print(f"   📤 {p.get('name', 'Unknown')} - {p.get('companyName', 'N/A')}")
    
    print("\n" + "=" * 60)

def store_results_in_db(metrics, result_json_url):
    """Store metrics and results in database"""
    if not DATABASE_URL:
        print("❌ DATABASE_URL not set")
        return False

    print("\n💾 Storing results in database...")
    
    try:
        conn = psycopg2.connect(DATABASE_URL)
        cursor = conn.cursor()

        # Store aggregate stats
        cursor.execute('''
            INSERT INTO linkedin_agent_data 
            (day_sent, day_accepted, total_sent, total_accepted, status, links_json, process_timestamp, created_at, updated_at)
            VALUES (%s, %s, %s, %s, %s, %s, NOW(), NOW(), NOW())
        ''', (
            metrics['total_sent'],
            metrics['total_accepted'],
            metrics['total_sent'],
            metrics['total_accepted'],
            'completed',
            result_json_url
        ))
        
        print(f"   ✅ Stored aggregate stats")

        # Store individual accepted connections
        stored_count = 0
        for profile in metrics['requests_accepted']:
            linkedin_url = profile.get('linkedinProfileUrl', '')
            profile_name = profile.get('name', 'Unknown')
            status = profile.get('status', '')
            company = profile.get('companyName', '')

            # Check if exists
            cursor.execute(
                'SELECT id FROM linkedin_agent_data WHERE linkedin_url = %s',
                (linkedin_url,)
            )
            existing = cursor.fetchone()

            if not existing:
                cursor.execute('''
                    INSERT INTO linkedin_agent_data 
                    (linkedin_url, profile_name, status, connection, connected_date, raw_data, created_at, updated_at)
                    VALUES (%s, %s, %s, %s, NOW(), %s, NOW(), NOW())
                ''', (linkedin_url, profile_name, status, company, json.dumps(profile)))
                stored_count += 1
                print(f"   🎉 Stored accepted: {profile_name}")

        # Store individual pending invitations
        for profile in metrics['pending_invites']:
            linkedin_url = profile.get('linkedinProfileUrl', '')
            profile_name = profile.get('name', 'Unknown')
            status = profile.get('status', '')
            company = profile.get('companyName', '')

            # Check if exists
            cursor.execute(
                'SELECT id FROM linkedin_agent_data WHERE linkedin_url = %s',
                (linkedin_url,)
            )
            existing = cursor.fetchone()

            if not existing:
                cursor.execute('''
                    INSERT INTO linkedin_agent_data 
                    (linkedin_url, profile_name, status, connection, invitation_date, raw_data, created_at, updated_at)
                    VALUES (%s, %s, %s, %s, NOW(), %s, NOW(), NOW())
                ''', (linkedin_url, profile_name, status, company, json.dumps(profile)))
                stored_count += 1

        conn.commit()
        cursor.close()
        conn.close()

        print(f"   ✅ Stored {stored_count} new records")
        return True

    except Exception as e:
        print(f"❌ Database error: {e}")
        return False

def main():
    parser = argparse.ArgumentParser(description='LinkedIn Connection Agent Analytics')
    parser.add_argument('--analytics', action='store_true', help='Fetch and display analytics')
    parser.add_argument('--store', action='store_true', help='Store results in database')

    args = parser.parse_args()

    print("🚀 LinkedIn Connection Agent")
    print("=" * 50)
    print(f"Agent ID: {AGENT_ID}")

    # Fetch results
    profiles, result_json_url = fetch_agent_results()
    
    if not profiles:
        print("❌ Failed to fetch results")
        return

    # Parse metrics correctly
    metrics = parse_metrics(profiles)

    # Display analytics
    display_analytics(metrics)

    # Store in database if requested
    if args.store:
        store_results_in_db(metrics, result_json_url)

    print("\n✅ Done!")

if __name__ == "__main__":
    main()
