"""
Modal Cron Job: LinkedIn Connection Agent

Fetches LinkedIn connection request results from PhantomBuster agent
Correctly tracks:
- total_sent: Profiles with invitationDate (we sent them an invite)
- total_accepted: Profiles with status = "Request accepted"
- pending: Profiles with status = "Invitation sent"

Runs every day at 6:00 PM EST (11:00 PM UTC)

Deploy: modal deploy modal_linkedin_connections.py
Test:   modal run modal_linkedin_connections.py
"""

import modal

# Create Modal app
app = modal.App("linkedin-connection-agent")

# Create image with dependencies
image = modal.Image.debian_slim(python_version="3.11").pip_install(
    "requests",
    "psycopg2-binary",
)

@app.function(
    image=image,
    secrets=[modal.Secret.from_name("agenticos-secrets")],
    schedule=modal.Cron("0 23 * * *"),  # 11 PM UTC = 6 PM EST daily
    timeout=600,  # 10 minute timeout
)
def run_linkedin_connections():
    """Fetch LinkedIn connection results and store in database"""
    import os
    import json
    import requests
    import psycopg2
    from datetime import datetime

    print("🚀 LinkedIn Connection Agent - Modal Cron Job")
    print("=" * 60)
    print("⏰ Schedule: 6:00 PM EST daily (11:00 PM UTC)")

    # Get credentials
    phantombuster_key = os.environ['PHANTOMBUSTER_API_KEY']
    database_url = os.environ['DATABASE_URL']
    agent_id = os.environ.get('PHANTOMBUSTER_AGENT_ID', '685897070795556')

    # API setup
    api_base = "https://api.phantombuster.com/api/v2"
    headers = {
        'X-Phantombuster-Key-1': phantombuster_key,
        'Content-Type': 'application/json'
    }

    print(f"🔗 Agent ID: {agent_id}")

    try:
        # Step 1: Fetch agent output
        print("\n🔍 Fetching agent output from PhantomBuster...")
        response = requests.get(
            f"{api_base}/agents/fetch-output",
            params={'id': agent_id},
            headers=headers
        )

        if response.status_code != 200:
            print(f"❌ API Error: {response.status_code}")
            return {"status": "error", "error": f"API returned {response.status_code}"}

        data = response.json()
        output = data.get('output', '')
        agent_status = data.get('status', 'unknown')
        is_running = data.get('isAgentRunning', False)

        print(f"✅ Agent Status: {agent_status}")
        print(f"   Is Running: {is_running}")

        # Step 2: Get structured JSON data URL
        result_json_url = None
        for line in output.split('\n'):
            if 'JSON saved at' in line and 'https://' in line:
                start = line.find('https://')
                end = line.find(' ', start) if line.find(' ', start) != -1 else len(line)
                result_json_url = line[start:end].strip()
                break

        # Fallback to known S3 URL pattern if not found in output
        if not result_json_url:
            agent_info = requests.get(
                f"{api_base}/agents/fetch",
                params={'id': agent_id},
                headers=headers
            )
            if agent_info.status_code == 200:
                agent_data = agent_info.json()
                org_folder = agent_data.get('orgS3Folder', '')
                s3_folder = agent_data.get('s3Folder', '')
                if org_folder and s3_folder:
                    result_json_url = f"https://phantombuster.s3.amazonaws.com/{org_folder}/{s3_folder}/result.json"
                    print(f"📄 Using S3 URL fallback: {result_json_url}")

        if not result_json_url:
            print("❌ No result JSON URL found in output")
            return {"status": "error", "error": "No JSON URL found"}

        # Step 3: Fetch structured profile data
        print(f"\n📄 Fetching profile data...")
        json_response = requests.get(result_json_url)

        if json_response.status_code != 200:
            print(f"❌ Failed to fetch JSON: {json_response.status_code}")
            return {"status": "error", "error": f"JSON fetch failed: {json_response.status_code}"}

        profiles = json_response.json()
        print(f"✅ Retrieved {len(profiles)} profiles")

        # Step 4: CORRECT PARSING - Calculate metrics based on invitationDate and status
        # - total_sent = profiles with invitationDate (we sent them an invite)
        # - total_accepted = profiles with status = "Request accepted"
        # - pending = profiles with status = "Invitation sent"
        
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

        # Calculate metrics
        total_sent = len(invites_sent)
        total_accepted = len(requests_accepted)
        pending = len(pending_invites)
        acceptance_rate = (total_accepted / total_sent * 100) if total_sent > 0 else 0

        print("\n📊 CORRECT METRICS:")
        print("=" * 50)
        print(f"   ✅ TOTAL SENT: {total_sent}")
        print(f"   🎉 TOTAL ACCEPTED: {total_accepted}")
        print(f"   ⏳ PENDING: {pending}")
        print(f"   📈 ACCEPTANCE RATE: {acceptance_rate:.1f}%")

        # Step 5: Store aggregate stats in database
        print("\n💾 Storing analytics in database...")
        conn = psycopg2.connect(database_url)
        cursor = conn.cursor()

        # Store daily aggregate stats
        cursor.execute('''
            INSERT INTO linkedin_agent_data 
            (day_sent, day_accepted, total_sent, total_accepted, status, links_json, process_timestamp, created_at, updated_at)
            VALUES (%s, %s, %s, %s, %s, %s, NOW(), NOW(), NOW())
        ''', (
            total_sent,           # day_sent (invitations sent)
            total_accepted,       # day_accepted (requests accepted)
            total_sent,           # total_sent
            total_accepted,       # total_accepted
            'completed',          # status
            result_json_url       # links_json (URL to full data)
        ))
        
        print(f"   ✅ Stored aggregate stats")

        # Step 6: Store/update individual profiles for accepted connections
        stored_count = 0
        updated_count = 0

        for profile in requests_accepted:
            linkedin_url = profile.get('linkedinProfileUrl', '')
            profile_name = profile.get('name', 'Unknown')
            status = profile.get('status', '')
            company = profile.get('companyName', '')
            invitation_date = profile.get('invitationDate', '')

            try:
                # Check if profile already exists
                cursor.execute(
                    'SELECT id, status FROM linkedin_agent_data WHERE linkedin_url = %s',
                    (linkedin_url,)
                )
                existing = cursor.fetchone()

                if existing:
                    # Update existing record
                    cursor.execute('''
                        UPDATE linkedin_agent_data 
                        SET status = %s,
                            profile_name = %s,
                            connected_date = NOW(),
                            raw_data = %s,
                            updated_at = NOW()
                        WHERE linkedin_url = %s
                    ''', (status, profile_name, json.dumps(profile), linkedin_url))
                    updated_count += 1
                    print(f"   🤝 Accepted: {profile_name} ({company})")
                else:
                    # Insert new record for accepted connection
                    cursor.execute('''
                        INSERT INTO linkedin_agent_data 
                        (linkedin_url, profile_name, status, connection, invitation_date, connected_date, raw_data, created_at, updated_at)
                        VALUES (%s, %s, %s, %s, NOW(), NOW(), %s, NOW(), NOW())
                    ''', (linkedin_url, profile_name, status, company, json.dumps(profile)))
                    stored_count += 1
                    print(f"   🎉 NEW Accepted: {profile_name} ({company})")

            except Exception as e:
                print(f"   ❌ Error storing {profile_name}: {e}")

        # Step 7: Store/update pending invitations
        for profile in pending_invites:
            linkedin_url = profile.get('linkedinProfileUrl', '')
            profile_name = profile.get('name', 'Unknown')
            status = profile.get('status', '')
            company = profile.get('companyName', '')

            try:
                # Check if profile already exists
                cursor.execute(
                    'SELECT id FROM linkedin_agent_data WHERE linkedin_url = %s',
                    (linkedin_url,)
                )
                existing = cursor.fetchone()

                if not existing:
                    # Insert new pending invitation
                    cursor.execute('''
                        INSERT INTO linkedin_agent_data 
                        (linkedin_url, profile_name, status, connection, invitation_date, raw_data, created_at, updated_at)
                        VALUES (%s, %s, %s, %s, NOW(), %s, NOW(), NOW())
                    ''', (linkedin_url, profile_name, status, company, json.dumps(profile)))
                    stored_count += 1

            except Exception as e:
                pass  # Skip duplicates silently

        conn.commit()
        cursor.close()
        conn.close()

        print(f"\n✅ WORKFLOW COMPLETE")
        print(f"   • Total Sent: {total_sent}")
        print(f"   • Total Accepted: {total_accepted}")
        print(f"   • Pending: {pending}")
        print(f"   • Acceptance Rate: {acceptance_rate:.1f}%")
        print(f"   • New records stored: {stored_count}")
        print(f"   • Records updated: {updated_count}")
        print(f"   • Next run: Tomorrow at 6:00 PM EST")

        return {
            "status": "success",
            "total_sent": total_sent,
            "total_accepted": total_accepted,
            "pending": pending,
            "acceptance_rate": f"{acceptance_rate:.1f}%",
            "new_stored": stored_count,
            "updated": updated_count
        }

    except Exception as e:
        print(f"❌ Error: {str(e)}")
        return {"status": "error", "error": str(e)}


@app.local_entrypoint()
def main():
    result = run_linkedin_connections.remote()
    print(f"\n🎉 Complete! Result: {result}")
