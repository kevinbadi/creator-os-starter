/**
 * persona.js — brand-pack loader shared by all content skills.
 *
 * Source of truth is the `personas` Insforge table (seeded by
 * scripts/setup-personas.mjs, edited by the dashboard questionnaire UI).
 *
 * ROOT_DIR passed by callers is `creator-os/.claude`; the repo root is one up,
 * and `.env.local` + stored relative paths resolve from there.
 */
const path = require("path");
const fs = require("fs");
const { Pool } = require("pg");

function repoRoot(rootDir) {
  return path.join(rootDir, "..");
}

function ensureEnv(rootDir) {
  if (process.env.DATABASE_URL) return;
  const candidates = [
    path.join(repoRoot(rootDir), ".env.local"),
    path.join(repoRoot(rootDir), ".env"),
    path.join(process.cwd(), ".env.local"),
  ];
  const envPath = candidates.find((p) => fs.existsSync(p));
  if (envPath && typeof process.loadEnvFile === "function") {
    try {
      process.loadEnvFile(envPath);
    } catch {
      /* ignore */
    }
  }
}

let _pool = null;
function pool(rootDir) {
  ensureEnv(rootDir);
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL not set — expected creator-os/.env.local");
  }
  if (!_pool) {
    _pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false },
      max: 3,
    });
  }
  return _pool;
}

/**
 * Load a persona brand pack from the DB.
 * @param {string} rootDir  creator-os/.claude
 * @param {string} [slug]   persona slug (defaults to $PERSONA_SLUG or "megan")
 */
async function loadPersona(rootDir, slug) {
  slug = slug || process.env.PERSONA_SLUG || "megan";
  const { rows } = await pool(rootDir).query(
    "select * from personas where slug = $1 limit 1",
    [slug],
  );
  if (!rows.length) throw new Error(`Persona '${slug}' not found in personas table`);
  const p = rows[0];
  const abs = (rel) => (rel ? path.resolve(repoRoot(rootDir), rel) : null);
  return {
    slug: p.slug,
    name: p.name,
    brand: p.brand,
    niche: p.niche,
    bio: p.persona_bio,
    voice: p.voice,
    profileId: p.zernio_profile_id,
    accounts: p.accounts || {},
    carouselPlatforms: p.carousel_platforms || ["instagram", "tiktok"],
    visualPillars: p.visual_pillars || [],
    contentPillars: p.content_pillars || [],
    topicBank: p.topic_bank || [],
    hashtagBank: p.hashtag_bank || [],
    location: p.location || {},
    referenceImagePath: abs(p.reference_image_path),
    libraryDir: abs(p.library_dir),
    raw: p,
  };
}

/**
 * Back-compat alias for template skills that call loadPersonaContext(ROOT_DIR).
 * Returns a promise — callers must await.
 */
function loadPersonaContext(rootDir, slug) {
  return loadPersona(rootDir, slug);
}

/**
 * Output directory for a content type, namespaced per persona.
 * e.g. getOutputDir("carousels", ROOT_DIR) → creator-os/.claude/brand-content/megan/carousels
 */
function getOutputDir(type, rootDir, slug) {
  slug = slug || process.env.PERSONA_SLUG || "megan";
  const dir = path.join(rootDir, "brand-content", slug, type);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

async function closePersonaPool() {
  if (_pool) {
    await _pool.end();
    _pool = null;
  }
}

module.exports = {
  loadPersona,
  loadPersonaContext,
  getOutputDir,
  closePersonaPool,
};
