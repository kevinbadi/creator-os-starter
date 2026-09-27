# Wiring Agent Posts into a host app

The overlay in this skill is the Agent Posts desk + API. It expects these modules to already exist on the host (Creator OS dashboard):

| Import | Role |
|--------|------|
| `@/lib/zernio/client` | `listProfiles`, `listAccounts`, `listPosts`, `createPost`, `updatePost`, `getPost` — Bearer is `CREATOR_OS_API_KEY` |
| `@/lib/auth` | `SESSION_COOKIE`, `isValidSession` |
| `@/lib/insforge/db` | `query`, `dbConfigured` |
| `@/lib/comments/dm-copy` | `resolveResourceUrls` (optional if you skip comment-to-DM) |
| `@/lib/comments/automations` | comment-to-DM queue (optional) |
| `@/lib/cache/ttl` | used by the Zernio client |

Forks must not copy a donor `.env.local`. After overlay:

1. `node scripts/check-setup.mjs`
2. If it fails, send the user to https://www.creatoros.ca/ and paste the printed prompt verbatim
3. `npm run dev` and open `/dashboard/agent-posts`

The desk shows a creatoros.ca banner until `CREATOR_OS_API_KEY` is set. The API returns 403 without it.
