# Apify to Google Sheets: Lead Generation Workflow

This workflow automates lead generation by chaining two Apify actors and storing the results in Google Sheets.

## Workflow Overview

1.  **Google Maps Scraper** (`compass/google-maps-scraper` - `nwua9Gu5YrADL7ZDj`)
    -   **Input**: Search terms (e.g., "Marketing Agency") and Location (e.g., "Austin, USA").
        -   *Note*: For best results, use "City, Country" format (e.g., "Austin, USA" instead of "Austin, TX").
    -   **Action**: Scrapes business details (Name, Address, Website, Phone, etc.).
    -   **Output**: List of businesses.
    -   **Storage**: Saves initial business data to Google Sheets.

2.  **Contact Details Scraper** (`apify/contact-info-scraper` - `QAKrfXwAcbmcWYnSo`)
    -   **Input**: Website URLs extracted from the Google Maps results.
    -   **Action**: Crawls the websites (up to 3 links deep) to find email addresses, social links, and team members.
    -   **Output**: Contact information for each business.
    -   **Storage**: Updates the Google Sheet with found emails and contact info.

## Polling & Long-Running Tasks

Since scraping can take time, the implementation uses the Apify Client's `.call()` method, which by default waits for the run to finish. However, for more robust handling or async execution, you can:

1.  **Start the Run**: `client.actor(ID).call(..., wait_secs=0)` returns a `run` object immediately.
2.  **Poll Status**: Check `client.run(run_id).get()['status']` until it is `SUCCEEDED`.
3.  **Fetch Results**:
    -   **Google Maps**: `GET https://api.apify.com/v2/datasets/{defaultDatasetId}/items`
    -   **Contact Scraper**: `GET https://api.apify.com/v2/datasets/{defaultDatasetId}/items`

This ensures the workflow doesn't timeout and can handle large scraping jobs gracefully.

-   **Apify API Key**: Set in `.env` as `APIFY_API_KEY`.
-   **Google Sheets**:
    -   Service Account JSON: `service_account.json`
    -   Spreadsheet ID: Set in `.env` as `SPREADSHEET_ID`.

## Usage

Run the script with search terms and location:

```bash
./venv/bin/python3 implementation/apify_leads_sheet.py --terms "Marketing Agency" --location "Austin, USA" --max 100
```

*Note: If `--max` is not specified, it defaults to 1000 leads. This controls `maxCrawledPlacesPerSearch`.*

## Output Schema (Google Sheets)

The script will create/update columns in the following order:
1.  Business Name
2.  Address
3.  Website
4.  Phone
5.  Rating
6.  **Emails** (Enriched)
7.  **LinkedIn** (Enriched)
8.  **Twitter** (Enriched)
9.  **Facebook** (Enriched)
