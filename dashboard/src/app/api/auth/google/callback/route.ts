import { NextRequest, NextResponse } from "next/server";
import { fetchWithFallback } from "@/lib/backend";
import {
  attachSessionCookie,
  requestIsSecure,
  USER_SESSION_TTL_SECONDS,
} from "@/lib/auth";

const STATE_COOKIE = "llmtrace_google_oauth_state";

function publicOrigin(req: NextRequest): string {
  const configured = process.env.NEXT_PUBLIC_DASHBOARD_URL?.replace(/\/+$/, "");
  if (configured) return configured;
  const proto =
    req.headers.get("x-forwarded-proto") ??
    (req.nextUrl.protocol === "https:" ? "https" : "http");
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  return `${proto}://${host}`;
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const code = req.nextUrl.searchParams.get("code");
  const state = req.nextUrl.searchParams.get("state");
  const expectedState = req.cookies.get(STATE_COOKIE)?.value;

  if (!code || !state || !expectedState || state !== expectedState) {
    return NextResponse.redirect(new URL("/login?error=google_state", req.url));
  }

  const redirectUri = `${publicOrigin(req)}/api/auth/google/callback`;

  let upstream: Response;
  try {
    const result = await fetchWithFallback("/api/v1/auth/oauth/google", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code, redirect_uri: redirectUri }),
      cache: "no-store",
    });
    upstream = result.response;
  } catch (e) {
    console.error("[auth/google/callback] backend unavailable:", e);
    return NextResponse.redirect(
      new URL("/login?error=google_backend", req.url),
    );
  }

  const payload = (await upstream.json().catch(() => null)) as {
    session_token?: string;
    tenant_id?: string;
  } | null;

  if (!upstream.ok || !payload?.session_token) {
    return NextResponse.redirect(
      new URL("/login?error=google_failed", req.url),
    );
  }

  const res = NextResponse.redirect(new URL("/", req.url));
  attachSessionCookie(
    res,
    req.headers.get("host"),
    payload.session_token,
    requestIsSecure(req),
    USER_SESSION_TTL_SECONDS,
  );
  res.cookies.set({
    name: STATE_COOKIE,
    value: "",
    httpOnly: true,
    path: "/",
    maxAge: 0,
  });

  // Pin the user's tenant in a short-lived hint cookie the client can read
  // once; top-bar also fetches /api/auth/me.
  if (payload.tenant_id) {
    res.cookies.set({
      name: "llmtrace_signup_tenant",
      value: payload.tenant_id,
      httpOnly: false,
      sameSite: "lax",
      path: "/",
      maxAge: 60,
    });
  }
  return res;
}
