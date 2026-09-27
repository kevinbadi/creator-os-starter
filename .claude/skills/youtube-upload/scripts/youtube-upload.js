#!/usr/bin/env node
/**
 * youtube-upload.js — Upload a video to YouTube via Studio browser automation.
 *
 * Usage:
 *   node youtube-upload.js --video /path/to/video.mp4 --title "My Video" --description "About this video"
 *   node youtube-upload.js --video /path/to/video.mp4 --title "My Video" --description "..." --visibility public
 *   node youtube-upload.js --video /path/to/video.mp4 --title "My Video" --visibility unlisted --cdp-port 18800
 *
 * Automatically starts the Clawdbot browser if not running.
 *
 * Options:
 *   --video        Path to video file (required)
 *   --title        Video title (required, max 100 chars)
 *   --description  Video description (optional)
 *   --visibility   public | unlisted | private (default: public)
 *   --cdp-port     Chrome CDP port (default: 18800)
 *
 * Exit codes:
 *   0 = success (prints YouTube URL to stdout)
 *   1 = error
 */

const WebSocket = require("ws");
const { execSync } = require("child_process");

const args = process.argv.slice(2);
function getArg(name) {
  const i = args.indexOf(name);
  return i !== -1 && i + 1 < args.length ? args[i + 1] : null;
}

const videoPath = getArg("--video");
const title = getArg("--title");
const description = getArg("--description") || "";
const visibility = (getArg("--visibility") || "public").toLowerCase();
const cdpPort = getArg("--cdp-port") || "18800";

if (!videoPath) { console.error("Error: --video is required"); process.exit(1); }
if (!title) { console.error("Error: --title is required"); process.exit(1); }
if (!["public", "unlisted", "private"].includes(visibility)) {
  console.error("Error: --visibility must be public, unlisted, or private");
  process.exit(1);
}

const CDP_BASE = `http://127.0.0.1:${cdpPort}`;
const STUDIO_URL = "https://studio.youtube.com/";

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function cdpSend(ws, method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = Math.floor(Math.random() * 1e9);
    const handler = raw => {
      const msg = JSON.parse(raw.toString());
      if (msg.id === id) {
        ws.removeListener("message", handler);
        if (msg.error) reject(new Error(JSON.stringify(msg.error)));
        else resolve(msg.result);
      }
    };
    ws.on("message", handler);
    ws.send(JSON.stringify({ id, method, params }));
  });
}

async function evaluate(ws, expression) {
  const result = await cdpSend(ws, "Runtime.evaluate", {
    expression, returnByValue: true, awaitPromise: true
  });
  if (result.exceptionDetails) throw new Error(`JS error: ${JSON.stringify(result.exceptionDetails.exception)}`);
  return result.result ? result.result.value : undefined;
}

async function waitForText(ws, text, timeout = 30000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const found = await evaluate(ws, `document.body?.innerText?.includes('${text.replace(/'/g, "\\'")}')`);
    if (found) return true;
    await sleep(1000);
  }
  return false;
}

async function clickButtonByText(ws, text) {
  return evaluate(ws, `(() => {
    const btns = Array.from(document.querySelectorAll('button, ytcp-button, tp-yt-paper-radio-button, [role="radio"], [role="button"]'));
    const btn = btns.find(b => b.textContent.trim() === '${text.replace(/'/g, "\\'")}');
    if (btn) { btn.click(); return true; }
    return false;
  })()`);
}

async function ensureBrowser() {
  try {
    const res = await fetch(`${CDP_BASE}/json/version`);
    if (res.ok) { console.error("Browser already running."); return; }
  } catch {}

  console.error("Browser not running. Starting...");
  try {
    execSync("clawdbot browser start --profile clawd --headless", { timeout: 15000, stdio: "pipe" });
  } catch {
    try { await fetch("http://127.0.0.1:18791/start", { method: "POST" }); } catch {
      console.error("Could not start browser."); process.exit(1);
    }
  }
  for (let i = 0; i < 20; i++) {
    try { const res = await fetch(`${CDP_BASE}/json/version`); if (res.ok) { console.error("Browser started."); return; } } catch {}
    await sleep(500);
  }
  console.error("Error: CDP not reachable."); process.exit(1);
}

(async () => {
  try {
    await ensureBrowser();

    // 1. Find or open YouTube Studio tab
    const targets = await (await fetch(`${CDP_BASE}/json`)).json();
    let target = targets.find(t => t.type === "page" && t.url.includes("studio.youtube.com"));
    if (!target) {
      target = await (await fetch(`${CDP_BASE}/json/new?${encodeURIComponent(STUDIO_URL)}`)).json();
      await sleep(4000);
    }

    const ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => { ws.on("open", resolve); ws.on("error", reject); });

    await cdpSend(ws, "DOM.enable");
    await cdpSend(ws, "Page.enable");

    // 2. Navigate to Studio
    await cdpSend(ws, "Page.navigate", { url: STUDIO_URL });
    await sleep(4000);

    // 3. Click "Upload videos"
    console.error("Opening upload dialog...");
    let clicked = await clickButtonByText(ws, "Upload videos");
    if (!clicked) {
      // Try the Create button in navbar
      clicked = await clickButtonByText(ws, "Create");
      await sleep(1000);
      await clickButtonByText(ws, "Upload videos");
    }
    await sleep(2000);

    // 4. Upload video file via CDP
    console.error(`Uploading: ${videoPath}`);
    const doc = await cdpSend(ws, "DOM.getDocument");
    const inputNode = await cdpSend(ws, "DOM.querySelector", {
      nodeId: doc.root.nodeId, selector: 'input[type="file"]'
    });
    if (!inputNode.nodeId) { console.error("Error: No file input found"); process.exit(1); }

    await cdpSend(ws, "DOM.setFileInputFiles", {
      nodeId: inputNode.nodeId, files: [videoPath]
    });
    console.error("Video file submitted. Waiting for processing...");
    await sleep(5000);

    // 5. Set title
    console.error(`Setting title: ${title}`);
    const titleSet = await evaluate(ws, `(() => {
      const input = document.querySelector('[aria-label*="title that describes"]') || document.querySelector('#textbox[aria-label*="title"]');
      if (!input) return false;
      input.focus();
      input.textContent = '';
      return true;
    })()`);
    if (titleSet) {
      await cdpSend(ws, "Input.insertText", { text: title });
    }
    await sleep(500);

    // 6. Set description
    if (description) {
      console.error("Setting description...");
      const descFocused = await evaluate(ws, `(() => {
        const el = document.querySelector('[aria-label*="Tell viewers"]');
        if (el) { el.focus(); return true; }
        return false;
      })()`);
      if (descFocused) {
        await cdpSend(ws, "Input.insertText", { text: description });
      }
      await sleep(500);
    }

    // 7. Set "Not made for kids"
    console.error("Setting audience...");
    await evaluate(ws, `(() => {
      const radios = document.querySelectorAll('[role="radio"], tp-yt-paper-radio-button');
      for (const r of radios) {
        if (r.textContent.includes('not made for kids')) { r.click(); return true; }
      }
      return false;
    })()`);
    await sleep(500);

    // 8. Click Next 3 times (Details → Video elements → Checks → Visibility)
    console.error("Navigating to visibility...");
    for (let i = 0; i < 3; i++) {
      await clickButtonByText(ws, "Next");
      await sleep(1500);
    }

    // 9. Set visibility
    console.error(`Setting visibility: ${visibility}`);
    const visLabel = visibility.charAt(0).toUpperCase() + visibility.slice(1);
    await evaluate(ws, `(() => {
      const radios = document.querySelectorAll('[role="radio"], tp-yt-paper-radio-button');
      for (const r of radios) {
        if (r.textContent.includes('${visLabel}')) { r.click(); return true; }
      }
      return false;
    })()`);
    await sleep(1000);

    // 10. Grab the video URL before publishing
    const videoUrl = await evaluate(ws, `(() => {
      const links = Array.from(document.querySelectorAll('a'));
      const yt = links.find(a => a.href && a.href.includes('youtu.be'));
      return yt ? yt.href : null;
    })()`);

    // 11. Click Publish/Save
    const pubButton = visibility === "private" ? "Save" : "Publish";
    console.error(`Clicking ${pubButton}...`);
    await clickButtonByText(ws, pubButton);
    await sleep(4000);

    // 12. Confirm published
    const published = await waitForText(ws, "Video published", 10000) ||
                      await waitForText(ws, "video has been", 5000);

    if (videoUrl) {
      console.log(videoUrl);
      console.error(`Published: ${videoUrl}`);
    } else {
      // Try to extract from the published dialog
      const dialogUrl = await evaluate(ws, `(() => {
        const links = Array.from(document.querySelectorAll('a'));
        const yt = links.find(a => a.href && a.href.includes('youtu.be'));
        return yt ? yt.href : null;
      })()`);
      if (dialogUrl) {
        console.log(dialogUrl);
        console.error(`Published: ${dialogUrl}`);
      } else {
        console.log("UPLOAD_SUCCESS_NO_URL");
        console.error("Video uploaded but could not extract URL.");
      }
    }

    ws.close();
    process.exit(0);
  } catch (err) {
    console.error(`Error: ${err.message}`);
    process.exit(1);
  }
})();
