/**
 * Our own handles across every profile (Kevin, personas, brand). A comment
 * whose author is one of these, or the account the post belongs to, is stamped
 * `is_own` at ingest so feeds and Jev tools can exclude our replies
 * (Kevin 2026-09-18: "clean up get_comments to not show comments from
 * kevbuildsapps ourselves"; 178 of 412 comments that day were our replies).
 */
export const OWN_HANDLES = new Set(
  [
    "kevbuildsapps", "kevbuildsapps2", "kev builds apps", "kevbuildsagencies",
    "kev.creatoros", "kev_creatoros", "kevinbadi", "kevin bahrabadi",
    "creator os", "creator_oss", "creatoros", "megan.creatoros", "danny.creatoros",
  ].map((h) => h.toLowerCase()),
);

function norm(h: string | null | undefined): string {
  return String(h ?? "").trim().replace(/^@/, "").toLowerCase();
}
/** Letters and digits only: "Kev Builds Apps" and "kev-builds-apps-09b4a3189" both start with "kevbuildsapps". */
function alnum(h: string | null | undefined): string {
  return norm(h).replace(/[^a-z0-9]/g, "");
}
const OWN_ALNUM = [...OWN_HANDLES].map(alnum).filter((h) => h.length >= 5);

/**
 * Our own automated reply bodies. YouTube hands our keyword reply back through
 * the Zernio webhook with no author at all, so handle checks can't catch it
 * (Kevin 2026-09-19: "thats obviously us responding"). Match on the template.
 */
const OWN_REPLY_PATTERNS: RegExp[] = [
  /^you commented \S+ so here you go: the link is in this video'?s description/i,
];
export function isOwnReplyText(text: string | null | undefined): boolean {
  const t = String(text ?? "").trim();
  return t.length > 0 && OWN_REPLY_PATTERNS.some((re) => re.test(t));
}
/** SQL predicate (for backfills) matching the same templates as isOwnReplyText. */
export const OWN_REPLY_TEXT_SQL = "comment_text ~* '^you commented \\S+ so here you go: the link is in this video''?s description'";

export function isOwnComment(
  author: { id?: string | null; username?: string | null } | null | undefined,
  account: { id?: string | null; username?: string | null } | null | undefined,
  text?: string | null,
): boolean {
  if (isOwnReplyText(text)) return true;
  if (author?.id && account?.id && author.id === account.id) return true;
  const au = norm(author?.username);
  if (!au) return false;
  if (account?.username && au === norm(account.username)) return true;
  if (OWN_HANDLES.has(au)) return true;
  // LinkedIn / Facebook hand back display-name slugs ("kev-builds-apps-09b4a3189"):
  // compare on letters+digits and accept a prefix match against the post's
  // account or any of our handles.
  const aa = alnum(au);
  const acct = alnum(account?.username);
  if (acct.length >= 5 && aa.startsWith(acct)) return true;
  return OWN_ALNUM.some((h) => aa.startsWith(h));
}

/** SQL for backfills / ad-hoc filters (lowercased handles). */
export const OWN_HANDLES_SQL_ARRAY = [...OWN_HANDLES];

let ensured: Promise<void> | null = null;
/** Idempotent: adds comment_events.is_own on installs whose table predates it. */
export function ensureOwnColumn(query: (sql: string) => Promise<unknown>): Promise<void> {
  if (!ensured) {
    ensured = query(
      "alter table comment_events add column if not exists is_own boolean not null default false",
    )
      .then(() => undefined)
      .catch((e) => {
        ensured = null;
        throw e;
      });
  }
  return ensured;
}
