import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, isValidSession } from "@/lib/auth";

// /api/zernio/webhook authenticates itself via HMAC signature, not the session.
// /go/* are public tracked redirects to the App Store (bio links etc.) —
// followers hit them logged-out by definition.
const PUBLIC_PATHS = ["/login", "/api/zernio/webhook", "/api/ai-news", "/go"];

// Short-link host (SHORT_LINK_HOST): <host>/<slug> == /go/<slug>. That host serves ONLY
// tracked redirects — the root and any dashboard path bounce to the web app, so
// the dashboard/login never appear on the public short domain.
const SHORT_HOST = (process.env.SHORT_LINK_HOST || "").toLowerCase(); // e.g. go.yourdomain.com
const SHORT_HOST_HOME = process.env.WEB_APP_URL || "https://example.com";

function requestHost(request: NextRequest) {
  const raw = request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? "";
  return raw.split(",")[0].trim().split(":")[0].toLowerCase();
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (SHORT_HOST && requestHost(request) === SHORT_HOST) {
    const slug = pathname.replace(/^\/(go\/)?/, "").split("/")[0];
    if (!slug) return NextResponse.redirect(SHORT_HOST_HOME, 302);
    const url = request.nextUrl.clone();
    url.pathname = `/go/${slug}`;
    return NextResponse.rewrite(url);
  }
  const isPublic = PUBLIC_PATHS.some(
    (p) => pathname === p || pathname.startsWith(p + "/"),
  );

  const token = request.cookies.get(SESSION_COOKIE)?.value;
  const valid = await isValidSession(token);

  if (!valid && !isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    if (pathname !== "/") url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }

  if (valid && pathname === "/login") {
    const url = request.nextUrl.clone();
    url.pathname = "/dashboard";
    url.search = "";
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    // Skip /api/upload so large videos are not cloned into the proxy buffer.
    "/((?!_next/static|_next/image|favicon.ico|api/upload|api/agent-edits|api/agent-clones|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
