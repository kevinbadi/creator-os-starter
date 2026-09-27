/**
 * Cover entity resolver (Kevin 2026-09-18: "cover photo generation needs to be
 * greatly improved so it actually uses icons and logos correlated to what I am
 * saying in the video").
 *
 * The old path was a 15-name regex list; anything else the speaker named (Jev,
 * TypeSafe, Subway Surfers, n8n...) was dropped, the prompt fell back to
 * "abstract orbs", and the image model filled the space with random app icons
 * (TikTok / Chrome on a Jev video).
 *
 * New path:
 *   1. KNOWN_MARKS: ~80 products / models / companies / apps / games with the
 *      ways they get SPOKEN (incl. Whisper mishears) and a precise VISUAL
 *      description the image model can draw without inventing a wordmark.
 *   2. An LLM pass (same Ollama gateway) that names the subjects the video is
 *      ABOUT plus 3 concrete physical props for the topic.
 *   3. Only entities actually spoken in the transcript survive. Known marks
 *      map to their visual; an unknown-but-spoken product gets one abstract
 *      emblem slot at most. If nothing is named, the cover gets topic PROPS
 *      and an explicit ban on brand / app icons.
 *
 * Exports: resolveCoverEntities({ transcript, hintLogos }) -> { logos, props,
 * prompt, source }. `prompt` is the text generate.mjs drops into the scene
 * prompt's "Floating 3D logos:" slot. CLI: node cover-entities.mjs --transcript
 * file.txt [--no-llm] prints the resolution (no fal, no side effects).
 */
import fs from "node:fs";

// name, spoken aliases (regex on lowercased transcript), visual description.
export const KNOWN_MARKS = [
  ["Claude", /\bclaude\b|\bcloud code\b|\bclod\b|anthropic|\bopus\b|\bsonnet\b|\bhaiku\b|\bfable\b/, "the Claude AI mark: a terracotta-orange rounded starburst asterisk on a cream rounded square"],
  ["Claude Code", /claude code|cloud code|clod code/, "a black terminal window tile with the terracotta Claude starburst in the corner"],
  ["OpenAI", /open ?ai|chat ?gpt|\bgpt\b|\bgbt\b|\bastra\b|\bcodex\b|\bsora\b|sam altman/, "the OpenAI blossom icon: a black interlocking hexagonal knot on white"],
  ["Jev", /\bjev\b|\bjeff\b(?=.{0,60}(model|ai|agent|typesafe))|\bjeb\b|\bjef\b|typesafe|type safe/, "the Jev icon by TypeSafe AI: a hot-pink circle with a black interlocking hexagonal chain-link emblem"],
  ["Gemini", /\bgemini\b|\bnano banana\b|\bveo\b/, "the Google Gemini four-point sparkle star in a blue-to-purple gradient"],
  ["Google", /\bgoogle\b|\bgoogle sheets\b|\bgoogle drive\b/, "the Google G icon in red, yellow, green, blue"],
  ["GitHub", /git ?hub|git nexus|git repo|\brepo\b/, "the GitHub Octocat silhouette in a black circle"],
  ["Cursor", /\bcursor\b/, "the Cursor editor icon: a black isometric cube with a white pointer facet"],
  ["Docker", /\bdocker\b/, "the Docker blue whale carrying stacked containers"],
  ["n8n", /\bn8n\b|\bn eight n\b|\bnaden\b/, "the n8n icon: a coral-red three-node link glyph on a dark rounded square"],
  ["Zapier", /\bzapier\b/, "the Zapier orange asterisk on white"],
  ["Make", /\bmake\.com\b|\bmake dot com\b|\bintegromat\b/, "the Make.com purple circle icon with white geometric brackets"],
  ["Ollama", /\bollama\b|\bo llama\b/, "the Ollama icon: a line-art llama face in a white rounded square"],
  ["DeepSeek", /deep ?seek/, "the DeepSeek blue whale icon"],
  ["Meta", /\bmeta\b|\bllama\b(?!.{0,10}face)/, "the Meta blue infinity loop icon"],
  ["NVIDIA", /nvidia|\bjensen\b/, "the NVIDIA green eye-swirl icon on black"],
  ["Apple", /\bapple\b|\bmac ?book\b|\bmac\b|\bios\b|\bxcode\b|\bswift\b/, "the Apple logo silhouette in silver"],
  ["iPhone", /i ?phone|phone farm|\bphones\b/, "a 3D iPhone in titanium with a triple camera, screen glowing"],
  ["Subway Surfers", /subway surf/, "the Subway Surfers app icon: a graffiti surfer boy on a yellow-orange square"],
  ["TikTok", /tik ?tok/, "the TikTok black musical-note icon with cyan and red edges"],
  ["Instagram", /instagram|\binsta\b|\breels?\b/, "the Instagram gradient camera icon"],
  ["YouTube", /you ?tube|\bshorts\b/, "the YouTube red rounded play button"],
  ["LinkedIn", /linked ?in/, "the LinkedIn blue rounded-square icon"],
  ["X", /\btwitter\b|\bx post\b|\bon x\b|\btweet/, "the X app black rounded-square icon"],
  ["Threads", /\bthreads\b/, "the Threads black at-loop icon"],
  ["Facebook", /facebook|\bmeta ads\b/, "the Facebook blue circle icon"],
  ["WhatsApp", /whats ?app/, "the WhatsApp green speech-bubble phone icon"],
  ["Telegram", /telegram/, "the Telegram blue paper-plane icon"],
  ["Reddit", /\breddit\b/, "the Reddit orange alien icon"],
  ["Discord", /\bdiscord\b/, "the Discord blurple game-controller face icon"],
  ["Slack", /\bslack\b/, "the Slack four-color hash icon"],
  ["Notion", /\bnotion\b/, "the Notion black-and-white page icon"],
  ["Obsidian", /obsidian/, "the Obsidian purple crystal gem icon"],
  ["Gmail", /\bgmail\b|\bemails?\b/, "the Gmail red-and-white M envelope icon"],
  ["Stripe", /\bstripe\b/, "the Stripe purple rounded-square icon"],
  ["Shopify", /shopify/, "the Shopify green shopping-bag icon"],
  ["Supabase", /supabase/, "the Supabase green lightning-bolt icon"],
  ["Postgres", /postgres|\bsql\b|\bdatabase\b/, "the PostgreSQL blue elephant icon"],
  ["Vercel", /\bvercel\b|next ?js/, "the Vercel black triangle icon"],
  ["Railway", /\brailway\b/, "the Railway purple rail icon"],
  ["Cloudflare", /cloudflare/, "the Cloudflare orange cloud icon"],
  ["AWS", /\baws\b|amazon web/, "the AWS orange smile-arrow icon"],
  ["Perplexity", /perplexity/, "the Perplexity teal geometric star icon"],
  ["Grok", /\bgrok\b|\bx ?ai\b/, "the Grok black circle with a white diagonal slash"],
  ["Mistral", /mistral/, "the Mistral orange-to-red pixel M icon"],
  ["Hugging Face", /hugging ?face/, "the Hugging Face yellow smiling emoji face icon"],
  ["Replit", /replit/, "the Replit orange rounded-square icon"],
  ["Lovable", /\blovable\b/, "the Lovable pink gradient heart icon"],
  ["Bolt", /\bbolt\b/, "the Bolt.new white lightning icon on black"],
  ["Windsurf", /windsurf/, "the Windsurf teal wave icon"],
  ["Copilot", /copilot/, "the GitHub Copilot goggles icon"],
  ["VS Code", /vs ?code|visual studio/, "the VS Code blue ribbon icon"],
  ["Chrome", /\bchrome\b|\bbrowser\b/, "the Google Chrome red-yellow-green ring icon"],
  ["Manychat", /many ?chat/, "the Manychat blue chat-bubble icon"],
  ["GoHighLevel", /go ?high ?level|\bghl\b/, "the GoHighLevel blue rounded-square icon"],
  ["Hootsuite", /hootsuite/, "the Hootsuite black owl icon"],
  ["ElevenLabs", /eleven ?labs/, "the ElevenLabs black double-bar icon"],
  ["HeyGen", /hey ?gen/, "the HeyGen purple rounded-square icon"],
  ["Midjourney", /mid ?journey/, "the Midjourney white sailboat icon on black"],
  ["Runway", /\brunway\b/, "the Runway black-and-white striped icon"],
  ["Kling", /\bkling\b/, "the Kling AI black rounded icon"],
  ["Whisper", /\bwhisper\b/, "a glowing white sound-wave icon (speech to text)"],
  ["FFmpeg", /ff ?mpeg/, "a green film-reel icon (FFmpeg)"],
  ["Giphy", /giphy|giffy/, "the Giphy rainbow-gradient rounded-square icon"],
  ["Python", /\bpython\b/, "the Python blue-and-yellow twin-snake icon"],
  ["Figma", /\bfigma\b/, "the Figma multicolor stacked-shapes icon"],
  ["Canva", /\bcanva\b/, "the Canva teal circle icon"],
  ["CapCut", /cap ?cut/, "the CapCut black-and-white scissors icon"],
  ["Premiere", /premiere/, "the Adobe Premiere purple rounded-square icon"],
  ["Remotion", /remotion/, "the Remotion blue rounded-square icon"],
  ["HyperFrames", /hyper ?frames?|hyper[\s-]?edit/, "a glowing white film-frame icon (HyperFrames)"],
  ["Creator OS", /creator ?os|creator claw/, "the Creator OS teal rounded-square tile"],
  ["Tesla", /\btesla\b|robotaxi|\bcybercab\b/, "the Tesla red T shield icon"],
  ["SpaceX", /space ?x|\bstarship\b/, "the SpaceX stylized X rocket icon"],
  ["Android", /\bandroid\b/, "the Android green robot icon"],
  ["Klap", /\bklap\b/, "the Klap black K rounded icon"],
  ["Apify", /\bapify\b/, "the Apify green-and-white A icon"],
  ["Zernio", /zernio/, "the Zernio rounded-square icon"],
  ["Screen Studio", /screen studio/, "the Screen Studio purple rounded-square icon"],
  ["Cline", /\bcline\b/, "the Cline robot icon"],
  ["Manus", /\bmanus\b/, "the Manus black hand icon"],
];

// Topic props: when the video names no product, or to fill a light lineup.
const TOPIC_PROPS = [
  [/agent|orchestrat|composer|workflow|automation/, "a glowing 3D robot head icon"],
  [/video ?game|subway|controller|gamer|gaming|plays? /, "a 3D game controller"],
  [/money|revenue|dollar|\$|paid|profit|sales|income/, "a stack of gold coins"],
  [/fast|speed|latency|millisecond|instant|real[- ]time/, "a 3D stopwatch"],
  [/brain|think|reason|smart|intellig/, "a glowing 3D brain"],
  [/token|cost|cheap|price/, "a pile of glowing token chips"],
  [/code|coding|program|developer|repo/, "a floating code window with curly braces"],
  [/email|inbox|newsletter/, "a 3D envelope with a notification badge"],
  [/lead|client|customer|outreach|dm/, "a 3D magnet pulling in profile cards"],
  [/video|reel|short|edit|clip/, "a 3D clapperboard"],
  [/voice|talk|speak|mic/, "a 3D studio microphone"],
  [/phone|mobile|app store/, "a 3D smartphone"],
  [/reinforcement|learning|train|loop/, "glowing circular loop arrows"],
  [/cloud|server|deploy|host/, "a glowing 3D cloud icon"],
  [/data|database|table|sheet/, "a 3D database cylinder"],
  [/graph|network|node|connect/, "a glowing node-graph network"],
  [/security|hack|lock|password/, "a 3D padlock"],
  [/rocket|launch|ship|release/, "a 3D rocket"],
];

const BAN_LINE =
  "Draw ONLY the icons listed. BANNED: any other brand, social, or app icon (no TikTok, Instagram, YouTube, Chrome, Google, LinkedIn, Facebook, X, Apple, Microsoft, Slack, Discord, Notion, or generic app-store tiles unless listed above). Icon marks only, no letters, no wordmarks.";

function norm(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/[“”"']/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Known marks the speaker actually said, ranked by mentions then first mention. */
export function spokenMarks(transcript) {
  const t = norm(transcript);
  const hits = [];
  for (const [name, re, visual] of KNOWN_MARKS) {
    const g = new RegExp(re.source, "gi");
    const all = [...t.matchAll(g)];
    if (!all.length) continue;
    hits.push({ name, visual, count: all.length, first: all[0].index, source: "regex" });
  }
  hits.sort((a, b) => b.count - a.count || a.first - b.first);
  return hits;
}

export function topicProps(transcript, max = 3) {
  const t = norm(transcript);
  const out = [];
  for (const [re, prop] of TOPIC_PROPS) {
    if (re.test(t) && !out.includes(prop)) out.push(prop);
    if (out.length >= max) break;
  }
  return out;
}

function extractJson(raw) {
  let s = String(raw || "").trim();
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) s = fence[1].trim();
  const a = s.indexOf("{");
  const b = s.lastIndexOf("}");
  if (a < 0 || b < 0) throw new Error("no JSON in model reply");
  return JSON.parse(s.slice(a, b + 1));
}

async function llmSubjects(transcript) {
  const key = process.env.OLLAMA_API_KEY || process.env.OLLAMA_KEY;
  if (!key) return null;
  const base = (process.env.OLLAMA_BASE_URL || "https://ollama.com").replace(/\/$/, "");
  const preferred = process.env.OLLAMA_TEXT_MODEL || "deepseek-v4-flash:0731";
  const models = [...new Set([preferred, "deepseek-v4-flash:0731", "glm-5.1"])];
  const system = [
    "You pick the visual subjects for a 9:16 video thumbnail from a spoken transcript.",
    "Return ONLY JSON: {\"subjects\":[{\"name\":\"\",\"spoken_as\":\"\",\"kind\":\"product|model|company|app|game|person\"}],\"props\":[\"\",\"\",\"\"]}",
    "subjects: up to 4 named products, AI models, companies, apps, or games the video is ABOUT, most important first. Only names the speaker actually says. spoken_as = the exact words in the transcript (Whisper may misspell: 'Jeff model' means Jev, 'cloud code' means Claude Code; give the corrected name in name and the transcript spelling in spoken_as).",
    "Never add tools the speaker did not mention. Platforms the video will be posted on (TikTok, Instagram, YouTube) are NOT subjects unless the video is about them.",
    "props: 3 concrete physical objects a 3D artist could render that visualize the topic (a stopwatch, a game controller, a stack of coins, a brain). No text, no logos.",
  ].join(" ");
  let lastErr;
  for (const model of models) {
    try {
      const res = await fetch(`${base}/api/chat`, {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        signal: AbortSignal.timeout(30000),
        body: JSON.stringify({
          model,
          stream: false,
          think: false,
          messages: [
            { role: "system", content: system },
            { role: "user", content: `TRANSCRIPT:\n${String(transcript).slice(0, 6000)}` },
          ],
        }),
      });
      const text = await res.text();
      if (!res.ok) throw new Error(`ollama ${res.status}: ${text.slice(0, 200)}`);
      const data = JSON.parse(text);
      const raw = data.message?.content || text;
      const j = typeof raw === "object" ? raw : extractJson(raw);
      return {
        subjects: Array.isArray(j.subjects) ? j.subjects : [],
        props: Array.isArray(j.props) ? j.props.map((p) => String(p)).filter(Boolean) : [],
        model,
      };
    } catch (e) {
      lastErr = e;
      if (!/410|404|retired/i.test(String(e.message))) break;
    }
  }
  if (lastErr) console.warn(`cover-entities llm failed (${lastErr.message})`);
  return null;
}

function spoken(name, transcript) {
  const t = norm(transcript);
  const low = norm(name);
  if (!low) return false;
  return t.includes(low) || t.includes(low.replace(/[\s.-]+/g, ""));
}

function findKnown(name) {
  const low = norm(name);
  return KNOWN_MARKS.find(([n, re]) => norm(n) === low || re.test(low));
}

/**
 * Resolve the cover lineup. `hintLogos` = the caption model's comma list (may
 * be empty). Returns { logos:[{name,visual,source}], props:[], prompt, source }.
 */
export async function resolveCoverEntities({ transcript, hintLogos = "", title = "", useLlm = true, max = 4 }) {
  // Kevin's typed title is the strongest signal of what the video is about
  // (the AGI video never says "Claude" out loud, the title does).
  const t = [title ? `TITLE: ${title}.` : "", String(transcript || "")].filter(Boolean).join(" ");
  const regexHits = spokenMarks(t);
  const llm = useLlm ? await llmSubjects(t) : null;

  const picked = [];
  const push = (name, visual, source) => {
    if (!name || picked.some((p) => p.name.toLowerCase() === name.toLowerCase())) return;
    if (picked.length >= max) return;
    picked.push({ name, visual, source });
  };

  // 1. LLM subjects, validated against the transcript, most important first.
  for (const s of llm?.subjects ?? []) {
    const name = String(s?.name || "").trim();
    const spokenAs = String(s?.spoken_as || "").trim();
    if (!name) continue;
    const known = findKnown(name) || findKnown(spokenAs);
    const said = spoken(name, t) || spoken(spokenAs, t) || (known && known[1].test(norm(t)));
    if (!said) continue;
    if (known) push(known[0], known[2], `llm:${llm.model}`);
    else if (!picked.some((p) => p.source.startsWith("llm-unknown"))) {
      push(name, `an abstract 3D emblem icon representing ${name} (no letters, no wordmark)`, "llm-unknown");
    }
  }
  // 2. Caption-model hint list (already gated by logosFromTranscript upstream).
  for (const raw of String(hintLogos || "").split(",")) {
    const name = raw.trim();
    if (!name) continue;
    const known = findKnown(name);
    if (known && known[1].test(norm(t))) push(known[0], known[2], "hint");
  }
  // 3. Regex hits by frequency.
  for (const h of regexHits) push(h.name, h.visual, "regex");

  // Platforms the video is posted on are noise unless the video is about them
  // (they were only mentioned once, in passing).
  const platformish = new Set(["TikTok", "Instagram", "YouTube", "LinkedIn", "X", "Threads", "Facebook"]);
  let logos = picked.filter((p) => {
    if (!platformish.has(p.name)) return true;
    const hit = regexHits.find((h) => h.name === p.name);
    return (hit?.count ?? 0) >= 2 || p.source.startsWith("llm");
  });
  // Claude Code already carries the Claude mark; do not draw both.
  if (logos.some((p) => p.name === "Claude Code")) logos = logos.filter((p) => p.name !== "Claude");

  const props = (llm?.props?.length ? llm.props : topicProps(t)).slice(0, 3);
  let prompt;
  if (logos.length) {
    const list = logos.map((l, i) => `(${i + 1}) ${l.visual}`).join("; ");
    const filler = logos.length < 3 && props.length ? ` Plus ${props.slice(0, 3 - logos.length).join(" and ")}.` : "";
    prompt = `${list}.${filler} ${BAN_LINE}`;
  } else {
    prompt = `NO brand or app icons at all. Floating 3D props instead: ${props.join(", ") || "abstract glowing tech orbs"}. ${BAN_LINE}`;
  }
  return { logos, props, prompt, source: llm ? `llm:${llm.model}+regex` : "regex" };
}

// CLI: node cover-entities.mjs --transcript file.txt [--no-llm]
if (process.argv[1] && /cover-entities\.mjs$/.test(process.argv[1])) {
  const i = process.argv.indexOf("--transcript");
  const file = i >= 0 ? process.argv[i + 1] : null;
  if (!file) {
    console.error("usage: node cover-entities.mjs --transcript file.txt [--no-llm]");
    process.exit(1);
  }
  const transcript = fs.readFileSync(file, "utf8");
  const ti = process.argv.indexOf("--title");
  const title = ti >= 0 ? process.argv[ti + 1] : "";
  resolveCoverEntities({ transcript, title, useLlm: !process.argv.includes("--no-llm") }).then((r) => {
    console.log(JSON.stringify(r, null, 2));
  });
}
