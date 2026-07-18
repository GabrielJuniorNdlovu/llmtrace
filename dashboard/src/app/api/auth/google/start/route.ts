import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "crypto";

const STATE_COOKIE = "llmtrace_google_oauth_state";
const STATE_TTL_SECONDS = 10 * 60;

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
  const clientId =
    process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID ||
    process.env.LLMTRACE_GOOGLE_CLIENT_ID ||
    "";
  if (!clientId) {
    return NextResponse.redirect(
      new URL("/login?error=google_unconfigured", req.url),
    );
  }

  const state = randomBytes(24).toString("hex");
  const redirectUri = `${publicOrigin(req)}/api/auth/google/callback`;
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: "openid email profile",
    state,
    access_type: "online",
    prompt: "select_account",
  });

  const res = NextResponse.redirect(
    `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`,
  );
  res.cookies.set({
    name: STATE_COOKIE,
    value: state,
    httpOnly: true,
    sameSite: "lax",
    secure: req.nextUrl.protocol === "https:" ||
      req.headers.get("x-forwarded-proto") === "https",
    path: "/",
    maxAge: STATE_TTL_SECONDS,
  });
  return res;
}
