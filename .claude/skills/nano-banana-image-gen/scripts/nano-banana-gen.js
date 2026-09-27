const fs = require('fs');
const path = require('path');
const { assertFal } = require("../../../lib/fal-gate.js");

assertFal("nano-banana");
const FAL_KEY = process.env.FAL_KEY;
const DEFAULT_REF = path.resolve(__dirname, '../../../brand-content/persona/reference.png');
const OUTPUT_DIR = path.resolve(__dirname, '../../../brand-content/persona');

function parseArgs(args) {
  const opts = {
    prompt: null,
    name: null,
    ref: DEFAULT_REF,
    textOnly: false,
    resolution: '1K',
    aspectRatio: '1:1',
    num: 1,
    format: 'png',
  };
  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--prompt': opts.prompt = args[++i]; break;
      case '--name': opts.name = args[++i]; break;
      case '--ref': opts.ref = path.resolve(args[++i]); break;
      case '--text-only': opts.textOnly = true; break;
      case '--resolution': opts.resolution = args[++i]; break;
      case '--aspect-ratio': opts.aspectRatio = args[++i]; break;
      case '--num': opts.num = parseInt(args[++i]); break;
      case '--format': opts.format = args[++i]; break;
    }
  }
  return opts;
}

async function uploadToFal(filePath) {
  const fileData = fs.readFileSync(filePath);
  const base64 = fileData.toString('base64');
  const ext = path.extname(filePath).slice(1) || 'png';
  return `data:image/${ext};base64,${base64}`;
}

async function generate(opts) {
  const endpoint = opts.textOnly
    ? 'https://fal.run/fal-ai/nano-banana-2'
    : 'https://fal.run/fal-ai/nano-banana-2/edit';

  const body = {
    prompt: opts.prompt,
    num_images: opts.num,
    resolution: opts.resolution,
    aspect_ratio: opts.aspectRatio,
    output_format: opts.format,
    safety_tolerance: '5',
  };

  if (!opts.textOnly) {
    const dataUri = await uploadToFal(opts.ref);
    body.image_urls = [dataUri];
  }

  console.error(`[nano-banana-2] Generating: ${opts.name}`);
  console.error(`[nano-banana-2] Endpoint: ${opts.textOnly ? 'text-to-image' : 'image-to-image (edit)'}`);
  console.error(`[nano-banana-2] Resolution: ${opts.resolution}, Aspect: ${opts.aspectRatio}`);

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Authorization': `Key ${FAL_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`FAL API error ${response.status}: ${err}`);
  }

  const result = await response.json();
  const images = result.images || [];

  // Download images locally
  const outputs = [];
  for (let i = 0; i < images.length; i++) {
    const img = images[i];
    const suffix = images.length > 1 ? `-${i + 1}` : '';
    const filename = `${opts.name}${suffix}.${opts.format}`;
    const localPath = path.join(OUTPUT_DIR, filename);

    const imgResponse = await fetch(img.url);
    const buffer = Buffer.from(await imgResponse.arrayBuffer());
    fs.writeFileSync(localPath, buffer);

    outputs.push({
      name: opts.name,
      url: img.url,
      localPath: `brand-content/persona/${filename}`,
      width: img.width,
      height: img.height,
    });
    console.error(`[nano-banana-2] Saved: ${localPath}`);
  }

  // Output JSON to stdout for piping
  console.log(JSON.stringify(outputs, null, 2));
  return outputs;
}

// Main
const opts = parseArgs(process.argv.slice(2));

if (!opts.prompt || !opts.name) {
  console.error('Usage: node nano-banana-gen.js --prompt "..." --name "output-name" [--ref image.png] [--text-only] [--resolution 1K] [--aspect-ratio 1:1]');
  process.exit(1);
}

// Ensure output dir exists
fs.mkdirSync(OUTPUT_DIR, { recursive: true });

generate(opts).catch(e => {
  console.error(`[nano-banana-2] Error: ${e.message}`);
  process.exit(1);
});
