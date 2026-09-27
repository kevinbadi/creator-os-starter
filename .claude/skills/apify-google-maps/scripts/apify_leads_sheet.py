import os
import argparse
import time
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

# Actor IDs
GOOGLE_MAPS_ACTOR_ID = "nwua9Gu5YrADL7ZDj"  # compass/google-maps-scraper
CONTACT_DETAILS_ACTOR_ID = "QAKrfXwAcbmcWYnSo" # apify/contact-info-scraper (assuming this ID matches user request)

if not APIFY_API_KEY:
    raise ValueError("APIFY_API_KEY not found in .env")
if not SPREADSHEET_ID:
    raise ValueError("SPREADSHEET_ID not found in .env")

# Initialize Clients
apify_client = ApifyClient(APIFY_API_KEY)

def get_sheet(sheet_name="Sheet1"):
    scopes = ['https://www.googleapis.com/auth/spreadsheets']
    creds = Credentials.from_service_account_file(SERVICE_ACCOUNT_FILE, scopes=scopes)
    client = gspread.authorize(creds)
    sheet = client.open_by_key(SPREADSHEET_ID)
    try:
        worksheet = sheet.worksheet(sheet_name)
    except gspread.WorksheetNotFound:
        worksheet = sheet.add_worksheet(title=sheet_name, rows=1000, cols=20)
    return worksheet

def scrape_google_maps(search_terms, location, max_places):
    print(f"--- Starting Google Maps Scraper ---")
    print(f"Terms: {search_terms}, Location: {location}, Max: {max_places}")
    
    run_input = {
        "searchStringsArray": [search_terms],
        "locationQuery": location,
        "maxCrawledPlacesPerSearch": max_places,
        "language": "en",
    }
    
    run = apify_client.actor(GOOGLE_MAPS_ACTOR_ID).call(run_input=run_input)
    print(f"Google Maps Scraper finished. Dataset ID: {run['defaultDatasetId']}")
    
    # Fetch results
    results = []
    for item in apify_client.dataset(run['defaultDatasetId']).iterate_items():
        results.append({
            "name": item.get("title"),
            "address": item.get("address"),
            "website": item.get("website"),
            "phone": item.get("phone"),
            "rating": item.get("totalScore"),
            "reviews": item.get("reviewsCount")
        })
    
    print(f"Found {len(results)} businesses.")
    return results

def scrape_contact_details(websites):
    print(f"--- Starting Contact Details Scraper ---")
    print(f"Scraping {len(websites)} websites...")
    
    # Validate URLs
    valid_urls = []
    for url in websites:
        if not url: continue
        url = url.strip()
        if not url.startswith('http'):
            url = 'https://' + url
        try:
            result = urlparse(url)
            if all([result.scheme, result.netloc]):
                valid_urls.append({"url": url})
        except:
            continue
            
    if not valid_urls:
        print("No valid websites to scrape.")
        return {}

    run_input = {
        "startUrls": valid_urls,
        "maxCrawlingDepth": 3, # Crawl up to 3 links deep to find contacts
        "proxyConfiguration": {"useApifyProxy": True}
    }
    
    run = apify_client.actor(CONTACT_DETAILS_ACTOR_ID).call(run_input=run_input)
    print(f"Contact Scraper finished. Dataset ID: {run['defaultDatasetId']}")
    
    # Map results by Original Start URL (to aggregate data from multiple pages of the same site)
    contact_map = {}
    for item in apify_client.dataset(run['defaultDatasetId']).iterate_items():
        # Use originalStartUrl to group pages back to the business
        start_url = item.get("originalStartUrl") or item.get("url")
        if not start_url:
            continue
            
        if start_url not in contact_map:
            contact_map[start_url] = {
                "emails": set(),
                "linkedin": set(),
                "twitter": set(),
                "facebook": set(),
                "instagram": set(),
                "youtube": set(),
                "tiktok": set()
            }
            
        # Aggregate Emails
        for email in item.get("emails", []):
            contact_map[start_url]["emails"].add(email)
            
        # Aggregate Socials (using plural keys from dataset)
        for link in item.get("linkedins", []): contact_map[start_url]["linkedin"].add(link)
        for link in item.get("twitters", []): contact_map[start_url]["twitter"].add(link)
        for link in item.get("facebooks", []): contact_map[start_url]["facebook"].add(link)
        for link in item.get("instagrams", []): contact_map[start_url]["instagram"].add(link)
        for link in item.get("youtubes", []): contact_map[start_url]["youtube"].add(link)
        for link in item.get("tiktoks", []): contact_map[start_url]["tiktok"].add(link)

    # Convert sets to strings for the sheet
    final_map = {}
    for url, data in contact_map.items():
        final_map[url] = {
            "emails": "\n".join(sorted(list(data["emails"]))),
            "linkedin": "\n".join(sorted(list(data["linkedin"]))),
            "twitter": "\n".join(sorted(list(data["twitter"]))),
            "facebook": "\n".join(sorted(list(data["facebook"]))),
            "instagram": "\n".join(sorted(list(data["instagram"]))),
            "youtube": "\n".join(sorted(list(data["youtube"]))),
            "tiktok": "\n".join(sorted(list(data["tiktok"])))
        }
    
    return final_map

def update_sheet(businesses, contact_map, sheet_name="Sheet1"):
    print(f"--- Updating Google Sheet: {sheet_name} ---")
    sheet = get_sheet(sheet_name)
    
    # Prepare headers
    headers = ["Business Name", "Address", "Website", "Phone", "Rating", "Emails", "LinkedIn", "Twitter", "Facebook", "Instagram", "YouTube", "TikTok"]
    
    # Prepare rows
    rows = [headers]
    for b in businesses:
        website = b.get("website")
        # Direct lookup should work now that we use originalStartUrl
        contacts = contact_map.get(website, {}) if website else {}
        
        row = [
            b.get("name"),
            b.get("address"),
            website,
            b.get("phone"),
            b.get("rating"),
            contacts.get("emails", ""),
            contacts.get("linkedin", ""),
            contacts.get("twitter", ""),
            contacts.get("facebook", ""),
            contacts.get("instagram", ""),
            contacts.get("youtube", ""),
            contacts.get("tiktok", "")
        ]
        rows.append(row)
    
    # Clear and update
    sheet.clear()
    sheet.update(range_name="A1", values=rows)
    print("Google Sheet updated successfully.")

def main():
    parser = argparse.ArgumentParser(description="Apify Lead Gen to Google Sheets")
    parser.add_argument("--terms", required=True, help="Search terms (e.g. 'Marketing Agency')")
    parser.add_argument("--location", required=True, help="Location (e.g. 'Austin, TX')")
    parser.add_argument("--max", type=int, default=1000, help="Max places to scrape (default: 1000)")
    parser.add_argument("--sheet", default="Sheet1", help="Google Sheet Name (default: Sheet1)")
    
    args = parser.parse_args()
    
    try:
        # 1. Scrape Maps
        businesses = scrape_google_maps(args.terms, args.location, args.max)
        
        if not businesses:
            print("No businesses found.")
            return

        # 2. Save Intermediate Results (Maps Data)
        print(f"Saving Google Maps data to Sheet '{args.sheet}'...")
        update_sheet(businesses, {}, args.sheet)

        # 3. Extract Websites
        websites = [b.get("website") for b in businesses if b.get("website")]
        
        # 4. Scrape Contacts
        contact_map = scrape_contact_details(websites)
        
        print(f"DEBUG: Found contacts for {len(contact_map)} websites.")
        # print(f"DEBUG: Contact Map Keys: {list(contact_map.keys())}")
        
        # 5. Update Sheet with Enriched Data
        print(f"Updating Sheet '{args.sheet}' with Contact Details...")
        update_sheet(businesses, contact_map, args.sheet)
        
    except Exception as e:
        print(f"An error occurred: {e}")

if __name__ == "__main__":
    main()
