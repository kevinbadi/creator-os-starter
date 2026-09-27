#!/usr/bin/env node
/**
 * gen-reaction-clips — build persona reaction clip banks for reaction-ugc.
 *
 * Two stages (run images first, eyeball them, then videos):
 *   node --env-file=.env.local scripts/gen-reaction-clips.mjs images [slug…]
 *   node --env-file=.env.local scripts/gen-reaction-clips.mjs videos [slug…]
 *
 * Images: fal nano-banana-2/edit seeded with the persona reference face
 * (same identity flow as carousel-gen). Videos: fal Kling 2.5-turbo-pro
 * image-to-video via the fal queue API, 5s, driven by the reaction beat-arc.
 *
 * Output: .claude/assets/reaction-clips/<persona>/<slug>.png + .mp4
 */
import fs from "node:fs";
import { createRequire as __cr } from "node:module";
const { assertFal } = __cr(import.meta.url)("../.claude/lib/fal-gate.js");
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
assertFal("reaction-clips");
const FAL_KEY = process.env.FAL_KEY;
if (!FAL_KEY) throw new Error("FAL_KEY not set");

const REFS = {
  megan: path.join(ROOT, ".claude/assets/brand/megan/reference-hero.png"),
  danny: path.join(ROOT, ".claude/assets/brand/danny/reference-hero.png"),
};
const OUT_BASE = path.join(ROOT, ".claude/assets/reaction-clips");

// UGC selfie aesthetic tails — per reaction-clip-prompts skill: amateur iPhone
// front-camera language in, cinematic/editorial language out.
// POV rule (Kevin 2026-07-09): the phone they react to IS the camera — the
// shot is FROM its front camera, so a physical phone must never appear.
// Earlier banks kept rendering a phone in hand because arcs said "squints at
// the phone" — all phone references below are phrased as camera/screen/lens.
const POV_RULE =
  "The camera IS the phone the person is reacting to, filming from its front camera. No physical phone is visible anywhere in the frame — no phone in their hands, no second phone, no phone on the table, no phone reflection. Their reaction is aimed straight into the lens.";
const IMG_TAIL =
  `Shot on an iPhone front camera with mild wide-angle selfie distortion, flat soft indoor lighting, slightly grainy with faint sensor noise in the shadows, natural unretouched skin with visible pores and texture, casual imperfect handheld framing, candid UGC TikTok selfie look, snapshot quality, NOT a professional portrait. ${POV_RULE}`;
const VID_TAIL =
  `Shot on an iPhone front camera with mild wide-angle selfie distortion, flat soft indoor lighting, subtle handheld shake and natural micro-movements, slightly grainy with faint compression, natural unretouched skin, casual UGC TikTok selfie look, 30fps, NOT a professional or cinematic shot. The person keeps eye contact with the lens as if reading the screen just below it, and their face stays clearly visible the whole time. ${POV_RULE} The person NEVER smiles or laughs — the emotion stays shocked, stunned, mad or embarrassed from first frame to last. No on-screen text, no captions.`;

const FRAME =
  "Amateur front-facing iPhone selfie, vertical 9:16, held at arm's length slightly below eye level, close-up from the chest up, shot FROM the phone's own front camera so the phone itself is never in frame.";
const VFRAME =
  "Amateur front-facing iPhone selfie video, vertical 9:16, held at arm's length slightly below eye level, close-up from the chest up, shot FROM the phone's own front camera so the phone itself is never in frame.";

// GAG REDESIGN (2026-07-10, after reviewing the v1 bank frame-by-frame):
// v1 failed because beat1 froze the impact mid-air ("droplets frozen in the
// air") — nano-banana rendered a static splash sculpture, Kling inherited it
// as a rigid object it could never animate, so the hit never actually
// happens on screen and the substance lingers like a sticker (paint), reads
// as a prop (glitter "envelope" → pillow), or under-delivers to near-nothing
// (water trickle, six confetti specks). With no calm beat there was also no
// contrast, and "comedic" phrasing pulled smiles through the negative prompt.
// v2 rules, applied to every gag below:
//   1. beat1 is PRE-impact: she talks casually to the lens, unaware, while
//      the substance is entering the frame edge IN MOTION, not yet touching
//      her — gives Kling a motion vector + material reference, not a freeze.
//   2. The arc is a second-marked 3-act: ~1s calm talking → one continuous
//      impact with real physics verbs → aftermath HOLD to the last frame.
//   3. Over-specify mass, coverage and the persistent state change (dry →
//      soaked, clean → coated) and say the mess STAYS for every frame.
//   4. Never the word "comedic"; endings anchored to a scowl (brows down,
//      jaw set, corners of the mouth pulled DOWN).
//   5. Off-frame attackers are "a second person's forearm in a <color>
//      sleeve" — a bare "hand from off-frame" morphs into her own hand.
// NOTE: "dripping" is NOT in the shared rules on purpose — on dry-particle
// gags (glitter, flour, confetti) it makes Kling melt the particles into a
// liquid that drips off her chin. Liquids state their own dripping in the
// arc; per-clip `neg` bans the failure modes of that clip's material.
const GAG_RULES =
  " The impact is one single continuous physical event with real momentum and true-to-material physics — nothing hangs frozen in mid-air, nothing fades or vanishes. After the impact the mess stays visibly on her for every remaining frame. Her reaction palette is strictly shocked, furious or humiliated: brows pressed down or raised in horror, jaw tight or hanging open, corners of her mouth pulled DOWN. Absolutely no smile, smirk or laugh in any frame, especially the last one.";

// [CHARACTER] comes from the reference image; prompts describe wardrobe,
// scene and the reaction only. Beat 1 of each arc seeds the starting image.
const MEGAN_WHO = "The same young blonde woman from the reference photo, long blonde hair";
const DANNY_WHO = "The same young Black man from the reference photo, short cropped hair with a fade";

const CLIPS = [
  // ── MEGAN ──────────────────────────────────────────────────────────────
  {
    persona: "megan", slug: "megan-jawdrop-cheeks",
    scene: "in a bright cream-toned bedroom, unmade white bedding behind her, soft morning light from a window",
    wardrobe: "wearing a white ribbed tank top, dainty gold necklace and small gold hoops",
    beat1: "her jaw just dropped wide open, both hands flying up to press against her cheeks, eyes enormous",
    arc: "Over 5 seconds: she stares at the screen neutrally for a beat, then her jaw drops wide open as both hands fly up and press against her cheeks, eyes enormous, and finally she leans in closer with the jaw-drop frozen even wider, pressing her cheeks harder and shaking her head slowly in stunned disbelief.",
  },
  {
    persona: "megan", slug: "megan-skeptic-squint",
    scene: "at a white kitchen counter, a glass of iced matcha and a fruit bowl behind her, bright daylight",
    wardrobe: "wearing an oversized cream knit cardigan over a white top, thin gold necklace",
    beat1: "eyes narrowed in a skeptical squint, head tilted, lips pressed together unconvinced",
    arc: "Over 5 seconds: she squints at the screen skeptically with her head tilted and lips pressed together unconvinced, then both eyebrows suddenly shoot up as her eyes go wide, and her jaw slowly falls open into a stunned stare while she shakes her head like she can't believe she didn't know this.",
  },
  {
    persona: "megan", slug: "megan-double-take",
    scene: "sitting on a light-grey pilates mat in a tidy living room corner, water bottle beside her, hair in a claw clip",
    wardrobe: "wearing a matching beige workout set",
    beat1: "caught mid double-take, head whipping back toward the camera, eyes just starting to widen",
    arc: "Over 5 seconds: she glances away from the camera casually, then whips her head back in a hard double-take leaning in close to the camera, eyes going huge, and holds the lean silently mouthing the words 'no way' with her jaw dropped. Both of her hands stay completely out of frame for the entire video.",
  },
  {
    persona: "megan", slug: "megan-peek-fingers",
    scene: "at a café window seat, blurred street light behind her, an oat latte on the table",
    wardrobe: "wearing a black blazer over a white tee, gold hoops",
    beat1: "both hands covering her whole face, only her forehead and hairline visible",
    arc: "Over 5 seconds: she starts with both hands covering her whole face, then slowly spreads her fingers to peek through them with one wide eye, and finally drops both hands revealing a full wide-eyed jaw-drop, staring dead into the camera like she can't cope.",
  },
  {
    persona: "megan", slug: "megan-frozen-blink",
    scene: "in the passenger seat of a parked car in daylight, seatbelt off, soft window light on her face",
    wardrobe: "wearing a zip-up cream fleece, hair down",
    beat1: "completely frozen, dead-still wide-eyed thousand-yard stare straight past the camera, mouth slightly open",
    arc: "Over 5 seconds: she holds a completely frozen wide-eyed thousand-yard stare with her mouth slightly open, blinks twice very slowly, then presses a hand flat against her chest and exhales hard, the shellshocked stare holding as her mouth falls further open.",
  },
  // ── MEGAN OUTRAGEOUS GAGS (Kevin 2026-07-09: "scroll-stopping" physical
  // gags hitting from off-frame. v2 prompts 2026-07-10 — see GAG REDESIGN
  // note above. fire + cake gags removed per reaction-format-learnings:
  // fire always renders smiles, force-fed cake trips the content filter;
  // SLAP removed 2026-07-10, Kevin: "remove the hitting in the face
  // reaction ugc its bad" — no person-on-person impact gags.) ─────────────
  // FLOUR STANDARD (Kevin 2026-07-10): flour is the benchmark gag — dense
  // opaque material, huge clean→coated state change, powder/cloud physics
  // Kling renders reliably, full-face coverage that persists. Prefer dense
  // materials; sparse-particle gags must be written as a frame-filling
  // blizzard (Kling under-renders particle counts) or not made at all.
  {
    persona: "megan", slug: "megan-gag-paint", gag: true,
    neg: "paint frozen in the air, paint hanging motionless, dry clean face, thin splatter",
    scene: "standing in a bare white studio corner with a drop cloth visible behind her, flat even daylight",
    wardrobe: "wearing a plain white crewneck tee, hair down",
    beat1: "talking casually to the camera, relaxed and completely unaware, while a thick jet of hot-pink paint streaks in fast from the left edge of frame, elongated with motion blur, its leading edge still a hand's width from her face",
    arc: "For the first second she talks casually to the camera, totally unaware. Then the heavy jet of hot-pink paint slams into the side of her face and shoulder with real liquid physics — it splatters on impact, coats her cheek, eye and hair on that side, and immediately starts running downward in thick drips onto the white tee. The paint stays on her for every remaining frame, dripping off her jaw. She freezes wide-eyed with her mouth open, blinks slowly through the paint, then hardens into a furious dead-still glare into the lens, brows pressed down, corners of her mouth pulled down, a pink drop rolling off her chin on the last frame.",
  },
  // WATER gag RETIRED 2026-07-10: Kling renders Megan's wet blonde hair as
  // auburn/brown stripes (2 takes, negatives + arc language didn't help) —
  // wet-blonde is a model weakness, don't re-attempt on this persona.
  // SLIME gag RETIRED 2026-07-10: the slime sensation drags Kling into
  // smiling/laughing end frames (2 takes: grin + full smile) — same failure
  // family as fire. No slime/tickle-type gags.
  {
    persona: "megan", slug: "megan-gag-flour", gag: true,
    scene: "in a bright kitchen leaning over a mixing bowl on the counter, window daylight",
    wardrobe: "wearing a black tank top and a small gold necklace",
    beat1: "talking casually to the camera over the mixing bowl, face completely clean, while a dense cloud of white flour bursts toward her from the right edge of frame, billowing with fast motion, its leading edge just short of her face",
    arc: "For the first second she talks casually over the mixing bowl, face clean and unaware. Then the flour burst hits her full in the face — a thick white cloud explodes around her head, coating her skin, eyelashes and hair in white powder that hangs in the air. She coughs once with her eyes squeezed shut, then opens them so two clear eye-shapes cut through her white-powdered face and holds a humiliated frozen stare into the lens, brows knit, mouth pressed flat with the corners turned down, powder still drifting off her hair on the last frame.",
  },
  // CONFETTI + GLITTER gags RETIRED 2026-07-10 (Kevin: "no confetti anymore
  // no glitter anymore, unrealistic") — even dense/technically-clean renders
  // read as staged/fake in a candid selfie POV. Gags must be PLAUSIBLE
  // real-world accidents: kitchen/studio matter (flour, paint, powder).
  {
    persona: "megan", slug: "megan-gag-powder", gag: true,
    neg: "liquid paint, wet paint, paint dripping, clean face",
    scene: "in a bright minimal living room, plain white wall behind her, flat even daylight",
    wardrobe: "wearing a plain white tee, hair down",
    beat1: "talking casually to the camera, face completely clean, while a dense cloud of vivid pink holi color powder bursts toward her from the right edge of frame, billowing with fast motion, its leading edge just short of her cheek",
    arc: "For the first second she talks casually to the camera, clean and unaware. Then the pink powder burst hits her full in the face — a thick vivid pink cloud explodes around her head, coating her cheek, eyelashes and hair in bright pink pigment that hangs in the air around her. She coughs once with her eyes squeezed shut, then opens them so two clear eye-shapes cut through the pink-dusted face, and holds a furious frozen stare into the lens, brows pressed down, mouth flat with the corners turned down, pink powder still drifting off her hair on the last frame.",
  },
  {
    persona: "megan", slug: "megan-gag-wind", gag: true,
    scene: "sitting at a cafe table by a window with an iced latte, soft daylight",
    wardrobe: "wearing a sage-green oversized button-up, hair down and neat",
    beat1: "talking casually to the camera with neat hair, while the first violent gust from the left edge of frame is just starting to lift the ends of her hair sideways, a paper napkin lifting off the table",
    arc: "For the first second she talks casually to the camera, hair neat and unaware. Then a violent leaf-blower gust from off-frame blasts her hair fully horizontal across her face — a napkin whips past her head as she squints hard and grips the table, leaning into the wind. Near the end the gust cuts out and her hair collapses into a wrecked tangle covering her face; she parts the curtain of hair with two fingers to reveal one wide furious eye glaring into the lens, and holds it to the last frame.",
  },
  // ── DANNY ──────────────────────────────────────────────────────────────
  {
    persona: "danny", slug: "danny-slow-nod-smirk",
    scene: "on a leather couch in a sage-green loft living room, warm lamp glow, framed art behind him",
    wardrobe: "wearing a plain black fitted tee and a thin silver cuban-link chain",
    beat1: "completely stone-faced, flat unimpressed expression, eyes locked on the screen",
    arc: "Over 5 seconds: he stares at the screen completely stone-faced and unimpressed, then one eyebrow rises slowly while the rest of his face stays still, and then his head suddenly pulls back as both eyes blow wide and his mouth falls open in stunned disbelief.",
  },
  {
    persona: "danny", slug: "danny-shaker-choke",
    scene: "in a gym between sets, blurred rack of dumbbells behind him, holding a black protein shaker",
    wardrobe: "wearing a grey sleeveless hoodie, light sweat sheen",
    beat1: "mid-sip from the protein shaker, eyes glued to the screen, relaxed",
    arc: "Over 5 seconds: he takes a casual sip from the protein shaker while scrolling, then freezes mid-sip as his eyes snap wide, slowly lowers the shaker away from his mouth and stares dead into the camera in pure disbelief, a tiny stunned head shake at the end.",
  },
  {
    persona: "danny", slug: "danny-lean-back",
    scene: "at a desk at night, the soft blue glow of an ultrawide monitor lighting his face, dark room behind",
    wardrobe: "wearing a black hoodie, hood down, silver chain visible",
    beat1: "recoiling backwards away from the camera, chin tucked, eyebrows knitted in shocked disbelief",
    arc: "Over 5 seconds: he physically leans back away from the camera with his chin tucked and eyebrows knitted in disbelief, then claps a hand over his mouth, and finally rocks forward with the hand still clamped over his mouth, eyes even wider, shaking his head in shocked disbelief.",
  },
  {
    persona: "danny", slug: "danny-hold-up",
    scene: "in a modern kitchen with glass meal-prep containers lined up on the counter behind him, bright daylight",
    wardrobe: "wearing a fitted white tee and a black apron loosely tied",
    beat1: "frowning in genuine confusion at the screen, head pulled back slightly, one eye narrowed",
    arc: "Over 5 seconds: he frowns at the screen in genuine confusion with one eye narrowed, freezes completely for a beat, then leans way in toward the camera until his face fills more of the frame and silently mouths the words 'hold up' with his brow still furrowed.",
  },
  {
    persona: "danny", slug: "danny-head-in-hand",
    scene: "in the driver's seat of a parked black sports car, tan leather interior, daylight through the side window",
    wardrobe: "wearing a charcoal quarter-zip, silver chain just visible at the collar",
    beat1: "forehead resting heavily in one hand, eyes closed, utterly exasperated",
    arc: "Over 5 seconds: he starts with his forehead resting heavily in one hand and eyes closed in exasperation, then lifts his head and gives the camera a long dead-eyed stare, and finally his eyes go wide and his jaw drops in mad disbelief with his brow furrowed hard, staring straight into the camera. No phone is visible at any point; his face stays fully unobstructed through the last frame.",
  },
  // ── CREATOROS (brand bank — fresh identity-free people, no reference
  // image; each clip describes its own person. Kevin 2026-07-08: "tons of
  // facial expressions" — every arc packs 3+ distinct expressions.) ────────
  {
    persona: "creatoros", slug: "curly-redhead-gasp-laugh", pron: "She",
    who: "A young white woman in her early 20s with big curly copper-red hair and light freckles",
    scene: "sitting cross-legged on a bed in a dorm-style room, fairy lights and a corkboard behind her, warm evening lamp light",
    wardrobe: "wearing an oversized graphite hoodie with the sleeves pulled over her palms",
    beat1: "gasping hard, mouth wide open, both sleeve-covered hands flying toward her mouth, eyes huge",
    arc: "Over 5 seconds: she watches the screen with a flat unimpressed face, then gasps hard as both sleeve-covered hands fly up to her mouth and her eyes go huge, and finally she claps both hands on top of her head with her jaw dropped and her eyebrows knitted together in distressed disbelief, like she just found out something upsetting, holding that anguished open-mouthed stare through the last frame. She looks upset, never happy.",
  },
  {
    persona: "creatoros", slug: "asian-guy-glasses-lean-in", pron: "He",
    who: "A young East Asian man in his mid 20s with round wire-frame glasses and slightly messy black hair",
    scene: "at a cluttered desk in a dim room lit by a monitor's cool glow, a shelf of figurines out of focus behind him",
    wardrobe: "wearing a washed-out navy crewneck tee",
    beat1: "leaning in very close to the camera lens, squinting hard through his glasses, nose slightly scrunched",
    arc: "Over 5 seconds: he squints hard at the screen and pushes his glasses up with one finger, then leans in so close his face nearly fills the frame with one eye narrowed, and suddenly recoils backward with both eyebrows shooting up and his mouth falling open, silently mouthing the word 'what'.",
  },
  {
    persona: "creatoros", slug: "latino-beard-brow-grin", pron: "He",
    who: "A Latino man around 30 with a short dark beard and thick expressive eyebrows",
    scene: "in a parked car in the driver's seat, seatbelt off, daylight through the windshield behind him",
    wardrobe: "wearing a heather-grey henley with the top button open",
    beat1: "one thick eyebrow cocked way up in deep skepticism, mouth twisted to one side",
    arc: "Over 5 seconds: he stares at the screen with one eyebrow cocked way up and his mouth twisted in deep skepticism, does a quick hard double-take, and then his face hardens into angry disbelief — jaw clenched, nostrils flared, eyes locked on the screen — as he shakes his head slowly like he's furious he didn't know this sooner.",
  },
  {
    persona: "creatoros", slug: "black-woman-braids-scream", pron: "She",
    who: "A young Black woman in her mid 20s with long box braids pulled half-up",
    scene: "in a bright kitchen leaning on the counter, a colorful mug and plant beside her, big window daylight",
    wardrobe: "wearing a mustard-yellow ribbed long-sleeve top and small gold hoops",
    beat1: "jaw dropped open in pure shock, one hand pressed flat against her chest, eyes wide and offended",
    arc: "Over 5 seconds: she reads the screen deadpan with pursed lips, then her eyes pop wide and her jaw drops open in pure shock, and finally she presses one hand flat against her chest and leans back offended, mouth still open, silently mouthing the words 'excuse me?' with wide disbelieving eyes.",
  },
  {
    persona: "creatoros", slug: "south-asian-slow-realize", pron: "He",
    who: "A South Asian man in his late 20s with short wavy black hair and light stubble",
    scene: "on a couch at night, a warm floor lamp and blurred TV glow behind him",
    wardrobe: "wearing a plain black tee and a thin steel watch",
    beat1: "frowning in genuine confusion, head pulled back, one eyebrow dipped low",
    arc: "Over 5 seconds: he frowns at the screen in genuine confusion with one eyebrow dipped low, then his face slowly transforms as the realization lands — eyes widening bit by bit, eyebrows climbing — and it finishes with his jaw literally dropping open as the camera drifts in closer to his face.",
  },
  {
    persona: "creatoros", slug: "messy-bun-cry-laugh", pron: "She",
    who: "A white woman in her late 20s with dark blonde hair in a messy bun and a tiny nose stud",
    scene: "at a small round cafe table by a window, an iced coffee sweating next to her, soft overcast daylight",
    wardrobe: "wearing a sage-green oversized button-up over a white tank",
    beat1: "mid-flinch pulling the straw away from her lips, eyes huge in shock, brows raised, caught off guard",
    arc: "Over 5 seconds: she sips her drink looking bored at the screen, then does a sharp spit-take-style flinch pulling the straw away with her eyes going huge, and finally lowers the drink out of frame, claps a hand over her mouth embarrassed like someone saw her, and holds a wide-eyed frozen stare at the screen through the last frame.",
  },
  {
    persona: "creatoros", slug: "dad-squint-impressed", pron: "He",
    who: "A white man in his mid 40s with salt-and-pepper stubble and short greying hair",
    scene: "in a home office with a bookshelf and a desk lamp behind him, warm indoor light",
    wardrobe: "wearing a navy quarter-zip pullover over a plaid collar",
    beat1: "leaning back from the camera with his chin pulled back, squinting at the screen like he can't read it",
    arc: "Over 5 seconds: he leans back from the camera squinting at the screen like he can't read it, then pulls his reading glasses down from his head and leans in as his eyebrows shoot way up, and finishes frozen in stunned disbelief — staring over the glasses into the lens, mouth slightly open, slowly shaking his head like the number can't be real.",
  },
  {
    persona: "creatoros", slug: "korean-girl-bolt-upright", pron: "She",
    who: "A young Korean woman in her early 20s with straight black hair with curtain bangs",
    scene: "lying on her stomach on a bed propped on her elbows, pastel bedding and a plushie blurred behind her",
    wardrobe: "wearing a baby-pink cropped sweatshirt",
    beat1: "bored expression with her chin resting in one palm, heavy-lidded eyes, cheek squished",
    arc: "Over 5 seconds: she watches with her chin squished into one palm and heavy bored eyes, then freezes completely mid-blink, and suddenly bolts upright out of frame and back in with her eyes enormous and both hands slapped onto the top of her head, mouth hanging open.",
  },
  {
    persona: "creatoros", slug: "locs-side-eye-noway", pron: "He",
    who: "A Black man in his mid 20s with shoulder-length locs and a chipped-tooth grin",
    scene: "walking paused on a city sidewalk, blurred storefronts and parked cars behind him, bright afternoon",
    wardrobe: "wearing an open flannel shirt over a white tee and small black earbuds",
    beat1: "giving the camera a hard sideways side-eye, lips pressed flat, head tilted away",
    arc: "Over 5 seconds: he gives the camera a long hard side-eye with his head tilted away and lips pressed flat, looks off into the distance like he's done with it, then whips back to the camera with his eyes blown wide and his brow furrowed hard in angry disbelief, jaw hanging open in a stunned frown that holds through the last frame.",
  },
  {
    persona: "creatoros", slug: "blonde-guy-cap-facepalm", pron: "He",
    who: "A young white man in his early 20s with a backwards black cap and short blonde hair poking out",
    scene: "in a garage gym between sets, a barbell rack and gym bag blurred behind him, cool bright LED light",
    wardrobe: "wearing a sleeveless grey pump-cover tee, a towel over one shoulder",
    beat1: "full facepalm, hand dragging down over his eyes and nose, mouth open in exasperation",
    arc: "Over 5 seconds: he does a full facepalm dragging his hand slowly down his face in exasperation, then peeks at the screen through spread fingers with one huge eye, and finally drops the hand fully down out of frame to reveal a wide-eyed angry jaw-drop, staring straight into the camera in betrayed disbelief and mouthing 'bro' while shaking his head. He is not holding anything.",
  },
];

const imgPrompt = (c) => {
  const who = c.who ?? (c.persona === "megan" ? MEGAN_WHO : DANNY_WHO);
  const pron = c.pron ?? (c.persona === "megan" ? "She" : "He");
  // Gag start frames must not smile — a grinning act-1 image fights the
  // video prompt's never-smiles rule and pulls Kling toward laughter.
  const gagFace = c.gag ? " Her expression is relaxed and neutral mid-sentence, lips just parted as if mid-word — NOT smiling, no grin, teeth not showing." : "";
  return `${FRAME} ${who}, ${c.wardrobe}, ${c.scene}. ${pron} is mid-reaction: ${c.beat1}.${gagFace} ${IMG_TAIL}`;
};
const vidPrompt = (c) => {
  const pron = c.pron ?? (c.persona === "megan" ? "She" : "He");
  const who = pron === "She" ? "The woman" : "The man";
  return `${VFRAME} ${who} ${c.scene}, ${c.wardrobe}. ${c.arc}${c.gag ? GAG_RULES : ""} ${VID_TAIL}`;
};

const toDataURI = (p) =>
  `data:image/png;base64,${fs.readFileSync(p).toString("base64")}`;

async function genImage(c) {
  const out = path.join(OUT_BASE, c.persona, `${c.slug}.png`);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  if (fs.existsSync(out)) { console.log(`· ${c.slug}.png exists — skip`); return; }
  // Persona clips seed identity from a reference (edit endpoint); brand
  // (creatoros) clips are fresh people — plain text-to-image.
  const ref = REFS[c.persona];
  const res = await fetch(`https://fal.run/fal-ai/nano-banana-2${ref ? "/edit" : ""}`, {
    method: "POST",
    headers: { Authorization: `Key ${FAL_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      prompt: imgPrompt(c),
      ...(ref ? { image_urls: [toDataURI(ref)] } : {}),
      num_images: 1,
      resolution: "1K",
      aspect_ratio: "9:16",
      output_format: "png",
      safety_tolerance: "5",
    }),
  });
  if (!res.ok) throw new Error(`FAL image ${res.status} (${c.slug}): ${(await res.text()).slice(0, 200)}`);
  const img = ((await res.json()).images || [])[0];
  if (!img) throw new Error(`no image for ${c.slug}`);
  fs.writeFileSync(out, Buffer.from(await (await fetch(img.url)).arrayBuffer()));
  console.log(`✓ image ${c.persona}/${c.slug}.png`);
}

// Kling 2.5 turbo pro i2v via the fal queue (sync fal.run times out on video).
const VIDEO_MODEL = "fal-ai/kling-video/v2.5-turbo/pro/image-to-video";
async function genVideo(c) {
  const img = path.join(OUT_BASE, c.persona, `${c.slug}.png`);
  const out = path.join(OUT_BASE, c.persona, `${c.slug}.mp4`);
  if (!fs.existsSync(img)) throw new Error(`missing starting image: ${img}`);
  if (fs.existsSync(out)) { console.log(`· ${c.slug}.mp4 exists — skip`); return; }
  const submit = await fetch(`https://queue.fal.run/${VIDEO_MODEL}`, {
    method: "POST",
    headers: { Authorization: `Key ${FAL_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      prompt: vidPrompt(c),
      image_url: toDataURI(img),
      duration: "5",
      // Palette rule: gags pull Kling toward laughter — ban it at the model
      // level, not just in the prompt text. Also ban the v1 failure modes:
      // frozen/vanishing splashes and static hanging liquid.
      negative_prompt: [
        "smiling, laughing, grinning, smirking, happy expression, joyful, amused, giggling, frozen splash, liquid hanging motionless in the air, static particles, paint vanishing, substance disappearing, mess fading away, cartoon physics, phone in hand, holding a phone, visible smartphone, second phone, phone on table, extra fingers, deformed hands, blur, distort, low quality",
        c.neg,
      ].filter(Boolean).join(", "),
    }),
  });
  if (!submit.ok) throw new Error(`FAL video submit ${submit.status} (${c.slug}): ${(await submit.text()).slice(0, 300)}`);
  const { request_id } = await submit.json();
  const base = `https://queue.fal.run/fal-ai/kling-video/requests/${request_id}`;
  for (let i = 0; i < 120; i++) {
    await new Promise((r) => setTimeout(r, 5000));
    const st = await (await fetch(`${base}/status`, { headers: { Authorization: `Key ${FAL_KEY}` } })).json();
    if (st.status === "COMPLETED") break;
    if (st.status === "FAILED" || st.error) throw new Error(`FAL video failed (${c.slug}): ${JSON.stringify(st).slice(0, 200)}`);
    if (i === 119) throw new Error(`FAL video timeout (${c.slug})`);
  }
  const result = await (await fetch(base, { headers: { Authorization: `Key ${FAL_KEY}` } })).json();
  const url = result.video?.url;
  if (!url) throw new Error(`no video url for ${c.slug}: ${JSON.stringify(result).slice(0, 200)}`);
  fs.writeFileSync(out, Buffer.from(await (await fetch(url)).arrayBuffer()));
  console.log(`✓ video ${c.persona}/${c.slug}.mp4`);
}

const [mode, ...only] = process.argv.slice(2);
const targets = CLIPS.filter((c) => !only.length || only.some((o) => c.slug.includes(o)));
if (mode === "images") {
  const results = await Promise.allSettled(targets.map(genImage));
  results.forEach((r, i) => r.status === "rejected" && console.error(`✗ ${targets[i].slug}: ${r.reason.message}`));
  process.exit(results.some((r) => r.status === "rejected") ? 1 : 0);
} else if (mode === "videos") {
  const results = await Promise.allSettled(targets.map(genVideo));
  results.forEach((r, i) => r.status === "rejected" && console.error(`✗ ${targets[i].slug}: ${r.reason.message}`));
  process.exit(results.some((r) => r.status === "rejected") ? 1 : 0);
} else if (mode === "prompts") {
  for (const c of targets) console.log(`\n── ${c.slug}\nIMG: ${imgPrompt(c)}\nVID: ${vidPrompt(c)}`);
} else {
  console.log("usage: gen-reaction-clips.mjs images|videos|prompts [slug…]");
}
