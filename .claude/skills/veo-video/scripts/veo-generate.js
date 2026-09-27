#!/usr/bin/env node
/**
 * veo-generate.js — Generate video from text prompt + optional reference image using Google Veo 3.
 *
 * Usage:
 *   node veo-generate.js --prompt "A person coding at a desk" --output video.mp4
 *   node veo-generate.js --prompt "..." --image /path/to/ref.png --output video.mp4
 *   node veo-generate.js --prompt "..." --image-prompt "Kev's Assistant at a coffee shop with laptop" --output video.mp4
 *   node veo-generate.js --prompt "..." --image-prompt "..." --imagen-model imagen-4.0-generate-001 --output video.mp4
 *
 * --image-prompt generates a reference image via Imagen 4 first, then uses it for Veo.
 * --image and --image-prompt are mutually exclusive; --image-prompt takes priority.
 *
 * Env: GEMINI_API_KEY (required)
 *
 * Exit codes:
 *   0 = success (video saved to --output path)
 *   1 = error
 */

const fs = require("fs");
const path = require("path");

const args = process.argv.slice(2);
function getArg(name) {
  const i = args.indexOf(name);
  return i !== -1 && i + 1 < args.length ? args[i + 1] : null;
}

const prompt = getArg("--prompt");
let imagePath = getArg("--image");
const imagePrompt = getArg("--image-prompt");
const outputPath = getArg("--output") || "veo-output.mp4";
const model = getArg("--model") || "veo-3.0-generate-001";
const imagenModel = getArg("--imagen-model") || "imagen-4.0-generate-001";
const apiKey = process.env.GEMINI_API_KEY;

if (!prompt) {
  console.error("Error: --prompt is required");
  process.exit(1);
}
if (!apiKey) {
  console.error("Error: GEMINI_API_KEY env var is required");
  process.exit(1);
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

const API_BASE = "https://generativelanguage.googleapis.com/v1beta";

// --- Imagen: generate a reference image from text ---
async function generateReferenceImage(imgPrompt) {
  console.error(`Generating reference image with ${imagenModel}...`);
  console.error(`Image prompt: "${imgPrompt}"`);

  const res = await fetch(
    `${API_BASE}/models/${imagenModel}:predict?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        instances: [{ prompt: imgPrompt }],
        parameters: {
          sampleCount: 1,
          outputOptions: { mimeType: "image/png" },
        },
      }),
    }
  );
  const data = await res.json();

  if (data.error) {
    throw new Error(`Imagen error: ${JSON.stringify(data.error)}`);
  }

  const b64 = data.predictions?.[0]?.bytesBase64Encoded;
  if (!b64) {
    throw new Error(
      `No image in Imagen response: ${JSON.stringify(Object.keys(data))}`
    );
  }

  // Save the generated reference image alongside the video
  const refPath = outputPath.replace(/\.[^.]+$/, "-ref.png");
  const imgBuffer = Buffer.from(b64, "base64");
  fs.writeFileSync(refPath, imgBuffer);
  console.error(
    `Reference image saved: ${refPath} (${(imgBuffer.length / 1024).toFixed(0)}KB)`
  );

  return refPath;
}

(async () => {
  try {
    // 0. Generate reference image if --image-prompt provided
    if (imagePrompt) {
      imagePath = await generateReferenceImage(imagePrompt);
    }

    // 1. Build request body
    const instance = { prompt };

    if (imagePath) {
      if (!fs.existsSync(imagePath)) {
        console.error(`Error: Image not found: ${imagePath}`);
        process.exit(1);
      }
      const ext = path.extname(imagePath).toLowerCase();
      const mimeMap = {
        ".png": "image/png",
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".webp": "image/webp",
      };
      const mimeType = mimeMap[ext] || "image/png";
      const imgBase64 = fs.readFileSync(imagePath).toString("base64");
      instance.image = { bytesBase64Encoded: imgBase64, mimeType };
      console.error(`Reference image: ${imagePath} (${mimeType})`);
    }

    const body = JSON.stringify({
      instances: [instance],
      parameters: { sampleCount: 1 },
    });

    // 2. Start generation
    console.error(`Starting Veo generation (model: ${model})...`);
    const startRes = await fetch(
      `${API_BASE}/models/${model}:predictLongRunning?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
      }
    );
    const startData = await startRes.json();

    if (startData.error) {
      console.error(`API error: ${JSON.stringify(startData.error)}`);
      process.exit(1);
    }

    const opName = startData.name;
    if (!opName) {
      console.error(`Unexpected response: ${JSON.stringify(startData)}`);
      process.exit(1);
    }
    console.error(`Operation: ${opName}`);

    // 3. Poll until done
    let result;
    const maxWait = 300000; // 5 minutes
    const start = Date.now();

    while (Date.now() - start < maxWait) {
      await sleep(10000); // poll every 10s
      const pollRes = await fetch(
        `${API_BASE}/${opName}?key=${apiKey}`
      );
      result = await pollRes.json();

      if (result.done) {
        console.error("Generation complete!");
        break;
      }
      const elapsed = Math.round((Date.now() - start) / 1000);
      console.error(`Still generating... (${elapsed}s elapsed)`);
    }

    if (!result || !result.done) {
      console.error("Error: Generation timed out after 5 minutes");
      process.exit(1);
    }

    if (result.error) {
      console.error(`Generation error: ${JSON.stringify(result.error)}`);
      process.exit(1);
    }

    // 4. Download video
    const videoUri =
      result.response?.generateVideoResponse?.generatedSamples?.[0]?.video
        ?.uri;
    if (!videoUri) {
      console.error(
        `No video URI in response: ${JSON.stringify(result.response)}`
      );
      process.exit(1);
    }

    console.error(`Downloading video...`);
    const dlRes = await fetch(`${videoUri}&key=${apiKey}`);
    if (!dlRes.ok) {
      console.error(`Download failed: ${dlRes.status}`);
      process.exit(1);
    }

    const buffer = Buffer.from(await dlRes.arrayBuffer());
    fs.writeFileSync(outputPath, buffer);
    console.error(
      `Saved: ${outputPath} (${(buffer.length / 1024 / 1024).toFixed(1)}MB)`
    );

    // Print output path to stdout for piping
    console.log(path.resolve(outputPath));
    process.exit(0);
  } catch (err) {
    console.error(`Error: ${err.message}`);
    process.exit(1);
  }
})();
