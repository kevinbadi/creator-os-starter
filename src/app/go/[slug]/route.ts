import { NextResponse, type NextRequest } from "next/server";
import { dbConfigured, query } from "@/lib/insforge/db";

// Public tracked redirect: /go/<slug> logs a click and 302s to the product.
// Slug convention is <who>-<platform> (megan-tt, danny-ig, brand-x, …) but ANY
// slug works — unknown sources still land on the store and still get counted,
// so new placements never need a deploy.
//
// Destination is encoded in the slug: a `web-` prefix (web-agencies-threads)
// 302s to the web app with UTM params (PostHog attributes per slug); every
// other slug 302s to the App Store — that split is how "selling the app" vs
// "selling the web app" placements each land on the right product.
//
// When APPSTORE_PT (the App Store Connect provider token) is set, App Store
// redirects carry Apple campaign params (pt + ct=slug), so App Store Connect
// reports actual DOWNLOADS per slug — not just our click counts.

export const dynamic = "force-dynamic";

const APP_STORE_URL = process.env.APP_STORE_URL || "https://apps.apple.com/app/id0000000000";
const WEB_APP_URL = process.env.WEB_APP_URL || "https://example.com";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;
  const clean = slug.toLowerCase().replace(/[^a-z0-9_-]/g, "").slice(0, 64);

  if (clean && dbConfigured) {
    // Fire-and-forget — a slow DB must never delay the store redirect.
    query(
      "INSERT INTO link_clicks (slug, user_agent, referer) VALUES ($1, $2, $3)",
      [
        clean,
        request.headers.get("user-agent")?.slice(0, 500) ?? null,
        request.headers.get("referer")?.slice(0, 500) ?? null,
      ],
    ).catch((e) => console.error(`[go] click log failed for ${clean}:`, e.message));
  }

  if (clean.startsWith("web-")) {
    const target = new URL(WEB_APP_URL);
    target.searchParams.set("utm_source", "go");
    target.searchParams.set("utm_campaign", clean);
    return NextResponse.redirect(target, 302);
  }

  const target = new URL(APP_STORE_URL);
  const pt = process.env.APPSTORE_PT;
  if (pt && clean) {
    target.searchParams.set("pt", pt);
    target.searchParams.set("ct", clean);
    target.searchParams.set("mt", "8");
  }
  return NextResponse.redirect(target, 302);
}
