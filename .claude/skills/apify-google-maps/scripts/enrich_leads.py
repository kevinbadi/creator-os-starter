import os
import argparse
from urllib.parse import urlparse
from dotenv import load_dotenv
from apify_client import ApifyClient
import gspread
from google.oauth2.service_account import Credentials

# Load environment variables
load_dotenv()
APIFY_API_KEY = os.getenv('APIFY_API_KEY')
SPREADSHEET_ID = os.getenv('SPREADSHEET_ID')
SERVICE_ACCOUNT_FILE = 'service_account.json'
CONTACT_DETAILS_ACTOR_ID = "QAKrfXwAcbmcWYnSo"

if not APIFY_API_KEY or not SPREADSHEET_ID:
    raise ValueError("Missing API Keys in .env")

apify_client = ApifyClient(APIFY_API_KEY)

def get_sheet(sheet_name):
    scopes = ['https://www.googleapis.com/auth/spreadsheets']
    creds = Credentials.from_service_account_file(SERVICE_ACCOUNT_FILE, scopes=scopes)
    client = gspread.authorize(creds)
    return client.open_by_key(SPREADSHEET_ID).worksheet(sheet_name)

def normalize_url(url):
    """Extract domain for loose matching"""
    if not url: return ""
    try:
        parsed = urlparse(url)
        return parsed.netloc.replace("www.", "")
    except:
        return url

def scrape_contact_details(websites):
    print(f"--- Starting Contact Details Scraper for {len(websites)} sites ---")
    
    start_urls = [{"url": url} for url in websites if url]
    if not start_urls: return {}

    run_input = {
        "startUrls": start_urls,
        "maxCrawlingDepth": 0,
        "proxyConfiguration": {"useApifyProxy": True}
    }
    
    run = apify_client.actor(CONTACT_DETAILS_ACTOR_ID).call(run_input=run_input)
    print(f"Scraper finished. Dataset ID: {run['defaultDatasetId']}")
    
    results = {}
    for item in apify_client.dataset(run['defaultDatasetId']).iterate_items():
        # Store by normalized domain
        orig_url = item.get("originalStartUrl") or item.get("url")
        domain = normalize_url(orig_url)
        
        results[domain] = {
            "emails": ", ".join(item.get("emails", [])),
            "linkedin": item.get("socialMedia", {}).get("linkedin", ""),
            "twitter": item.get("socialMedia", {}).get("twitter", ""),
            "facebook": item.get("socialMedia", {}).get("facebook", "")
        }
    return results

def main():
    sheet_name = "testosterone leads"
    print(f"Reading from sheet: {sheet_name}")
    
    sheet = get_sheet(sheet_name)
    data = sheet.get_all_records()
    
    # Extract websites (assuming column name "Website")
    websites = [row.get("Website") for row in data if row.get("Website")]
    print(f"Found {len(websites)} websites to process.")
    
    # Scrape
    contact_map = scrape_contact_details(websites)
    print(f"Found data for {len(contact_map)} domains.")
    
    # Update Sheet
    print("Updating sheet...")
    # We need to map back to row numbers. 
    # gspread is 1-indexed, header is row 1, so data starts at row 2.
    
    updates = []
    for i, row in enumerate(data):
        website = row.get("Website")
        domain = normalize_url(website)
        
        info = contact_map.get(domain)
        if info:
            row_num = i + 2 # +2 because enumerate starts at 0 and header is row 1
            
            # Update columns F, G, H, I (Emails, LinkedIn, Twitter, Facebook)
            # Assuming standard layout from previous script
            updates.append({
                "range": f"F{row_num}",
                "values": [[info['emails']]]
            })
            updates.append({
                "range": f"G{row_num}",
                "values": [[info['linkedin']]]
            })
            updates.append({
                "range": f"H{row_num}",
                "values": [[info['twitter']]]
            })
            updates.append({
                "range": f"I{row_num}",
                "values": [[info['facebook']]]
            })
            
    if updates:
        sheet.batch_update(updates)
        print(f"Updated {len(updates)//4} rows with new contact info.")
    else:
        print("No updates found.")

if __name__ == "__main__":
    main()
