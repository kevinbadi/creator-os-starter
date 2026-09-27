#!/usr/bin/env node
/**
 * linkedin-post.js — Post text + optional image to LinkedIn via CDP browser automation.
 *
 * Usage:
 *   node linkedin-post.js --text "Your post text" [--image /path/to/image.png] [--cdp-port 18800]
 *
 * Automatically starts the Clawdbot browser if not already running.
 *
 * Requirements:
 *   - Clawdbot installed (uses its browser control server)
 *   - Logged into LinkedIn in the browser session
 *   - ws (WebSocket) package available
 *
 * Exit codes:
 *   0 = success (prints post URL to stdout)
 *   1 = error
 */

const WebSocket = require("ws");
const { execSync } = require("child_process");

// --- Arg parsing ---
const args = process.argv.slice(2);
function getArg(name) {
  const i = args.indexOf(name);
  return i !== -1 && i + 1 < args.length ? args[i + 1] : null;
}

const postText = getArg("--text");
const imagePath = getArg("--image");
const cdpPort = getArg("--cdp-port") || "18800";

if (!postText) {
  console.error("Error: --text is required");
  process.exit(1);
}

const CDP_BASE = `http://127.0.0.1:${cdpPort}`;
const LINKEDIN_FEED = "https://www.linkedin.com/feed/";

// --- Helpers ---
function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function fetchJSON(url) {
  const res = await fetch(url);
  return res.json();
}

function cdpSend(ws, method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = Math.floor(Math.random() * 1e9);
    const handler = (raw) => {
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

async function waitForSelector(ws, selector, timeout = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const result = await cdpSend(ws, "Runtime.evaluate", {
      expression: `!!document.querySelector('${selector.replace(/'/g, "\\'")}')`,
      returnByValue: true,
    });
    if (result.result && result.result.value === true) return true;
    await sleep(500);
  }
  throw new Error(`Timeout waiting for selector: ${selector}`);
}

async function evaluate(ws, expression) {
  const result = await cdpSend(ws, "Runtime.evaluate", {
    expression,
    returnByValue: true,
    awaitPromise: true,
  });
  if (result.exceptionDetails) {
    throw new Error(
      `JS error: ${JSON.stringify(result.exceptionDetails.exception)}`
    );
  }
  return result.result ? result.result.value : undefined;
}

async function clickSelector(ws, selector) {
  // Get element center and click via Input.dispatchMouseEvent
  const box = await evaluate(
    ws,
    `(() => {
    const el = document.querySelector('${selector.replace(/'/g, "\\'")}');
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.x + r.width/2, y: r.y + r.height/2 };
  })()`
  );
  if (!box) throw new Error(`Element not found: ${selector}`);

  await cdpSend(ws, "Input.dispatchMouseEvent", {
    type: "mousePressed",
    x: box.x,
    y: box.y,
    button: "left",
    clickCount: 1,
  });
  await cdpSend(ws, "Input.dispatchMouseEvent", {
    type: "mouseReleased",
    x: box.x,
    y: box.y,
    button: "left",
    clickCount: 1,
  });
}

// --- Browser bootstrap ---
async function ensureBrowser() {
  // Check if CDP is reachable
  try {
    const res = await fetch(`${CDP_BASE}/json/version`);
    if (res.ok) {
      console.error("Browser already running.");
      return;
    }
  } catch {
    // Not running — start it
  }

  console.error("Browser not running. Starting Clawdbot browser...");
  try {
    execSync("clawdbot browser start --profile clawd --headless", {
      timeout: 15000,
      stdio: "pipe",
    });
  } catch {
    // clawdbot CLI might not be in PATH, try the control server directly
    try {
      await fetch("http://127.0.0.1:18791/start", { method: "POST" });
    } catch {
      console.error(
        "Could not start browser via CLI or control server. Start it manually."
      );
      process.exit(1);
    }
  }

  // Wait for CDP to become available
  for (let i = 0; i < 20; i++) {
    try {
      const res = await fetch(`${CDP_BASE}/json/version`);
      if (res.ok) {
        console.error("Browser started successfully.");
        return;
      }
    } catch {
      // not ready yet
    }
    await sleep(500);
  }
  console.error("Error: Browser started but CDP not reachable after 10s.");
  process.exit(1);
}

// --- Main ---
(async () => {
  try {
    // 0. Ensure browser is running
    await ensureBrowser();

    // 1. Find or open a LinkedIn tab
    const targets = await fetchJSON(`${CDP_BASE}/json`);
    let target = targets.find(
      (t) => t.type === "page" && t.url.includes("linkedin.com")
    );

    if (!target) {
      // Open new tab
      target = await fetchJSON(
        `${CDP_BASE}/json/new?${encodeURIComponent(LINKEDIN_FEED)}`
      );
      await sleep(3000);
    }

    const wsUrl = target.webSocketDebuggerUrl;
    if (!wsUrl) {
      console.error("Error: No WebSocket URL for target. Is CDP enabled?");
      process.exit(1);
    }

    const ws = new WebSocket(wsUrl);
    await new Promise((resolve, reject) => {
      ws.on("open", resolve);
      ws.on("error", reject);
    });

    // Enable DOM
    await cdpSend(ws, "DOM.enable");
    await cdpSend(ws, "Page.enable");

    // 2. Navigate to LinkedIn feed
    await cdpSend(ws, "Page.navigate", { url: LINKEDIN_FEED });
    await sleep(3000);

    // 3. Click "Start a post" button
    await waitForSelector(ws, 'button.share-box-feed-entry__trigger');
    await clickSelector(ws, 'button.share-box-feed-entry__trigger');
    await sleep(1500);

    // 4. Wait for the post editor and inject text
    await waitForSelector(ws, ".ql-editor");
    const escapedText = postText
      .replace(/\\/g, "\\\\")
      .replace(/`/g, "\\`")
      .replace(/\$/g, "\\$");

    // Convert newlines to <p> tags for LinkedIn's editor
    const paragraphs = postText
      .split("\n\n")
      .map((p) => {
        if (p.trim() === "") return "<p><br></p>";
        // Escape HTML
        const safe = p
          .replace(/&/g, "&amp;")
          .replace(/</g, "&lt;")
          .replace(/>/g, "&gt;")
          .replace(/"/g, "&quot;")
          .replace(/'/g, "&#039;");
        return `<p>${safe}</p>`;
      })
      .join("");

    await evaluate(
      ws,
      `(() => {
      const editor = document.querySelector('.ql-editor');
      editor.focus();
      editor.innerHTML = '${paragraphs.replace(/'/g, "\\'")}';
      editor.dispatchEvent(new Event('input', { bubbles: true }));
    })()`
    );
    await sleep(500);

    // 5. Upload image if provided
    if (imagePath) {
      // Click "Add media" button
      const addMediaClicked = await evaluate(
        ws,
        `(() => {
        // Find the "Add media" or photo button in the post dialog
        const buttons = Array.from(document.querySelectorAll('button'));
        const mediaBtn = buttons.find(b => 
          b.textContent.includes('Add media') || 
          b.getAttribute('aria-label')?.includes('Add media') ||
          b.querySelector('[data-test-icon="image-medium"]')
        );
        if (mediaBtn) { mediaBtn.click(); return true; }
        return false;
      })()`
      );

      if (!addMediaClicked) {
        console.error("Warning: Could not find Add media button, trying toolbar");
        // Try clicking from toolbar
        await evaluate(
          ws,
          `(() => {
          const btns = document.querySelectorAll('.share-creation-state__additional-toolbar button');
          for (const b of btns) {
            if (b.textContent.includes('media') || b.querySelector('li-icon[type="image"]')) {
              b.click(); return true;
            }
          }
          return false;
        })()`
        );
      }

      await sleep(1500);

      // Upload file via CDP DOM.setFileInputFiles
      const doc = await cdpSend(ws, "DOM.getDocument");
      const inputNode = await cdpSend(ws, "DOM.querySelector", {
        nodeId: doc.root.nodeId,
        selector: '#media-editor-file-selector__file-input, input[type="file"]',
      });

      if (inputNode.nodeId) {
        await cdpSend(ws, "DOM.setFileInputFiles", {
          nodeId: inputNode.nodeId,
          files: [imagePath],
        });
        console.error(`Image uploaded: ${imagePath}`);
        await sleep(2000);

        // Click "Next" button
        await waitForSelector(
          ws,
          'button[data-test-modal-action-btn="NEXT"], button.share-box-footer__primary-btn'
        );
        const nextClicked = await evaluate(
          ws,
          `(() => {
          const buttons = Array.from(document.querySelectorAll('button'));
          const next = buttons.find(b => b.textContent.trim() === 'Next' && !b.disabled);
          if (next) { next.click(); return true; }
          return false;
        })()`
        );
        if (!nextClicked) {
          console.error("Warning: Could not click Next button");
        }
        await sleep(2000);
      } else {
        console.error("Warning: Could not find file input element");
      }
    }

    // 6. Click "Post" button
    await sleep(1000);
    const posted = await evaluate(
      ws,
      `(() => {
      const buttons = Array.from(document.querySelectorAll('button'));
      const postBtn = buttons.find(b => {
        const text = b.textContent.trim();
        return (text === 'Post' || text === 'Post') && !b.disabled;
      });
      if (postBtn) { postBtn.click(); return true; }
      return false;
    })()`
    );

    if (!posted) {
      console.error("Error: Could not find Post button");
      ws.close();
      process.exit(1);
    }

    // 7. Wait for success dialog and extract post URL
    await sleep(5000);
    const postUrl = await evaluate(
      ws,
      `(() => {
      // Look for "View post" link in success dialog
      const links = Array.from(document.querySelectorAll('a'));
      const viewPost = links.find(a => a.textContent.includes('View post'));
      if (viewPost) return viewPost.href;
      
      // Fallback: look for share URN in any link
      const shareLink = links.find(a => a.href && a.href.includes('urn:li:share:'));
      if (shareLink) return shareLink.href;
      
      return null;
    })()`
    );

    if (postUrl) {
      console.log(postUrl);
    } else {
      console.log("POST_SUCCESS_NO_URL");
      console.error(
        "Post submitted but could not extract URL. Check LinkedIn manually."
      );
    }

    ws.close();
    process.exit(0);
  } catch (err) {
    console.error(`Error: ${err.message}`);
    process.exit(1);
  }
})();
