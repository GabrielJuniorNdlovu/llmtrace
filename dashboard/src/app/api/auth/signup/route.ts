import { NextRequest, NextResponse } from "next/server";
import { fetchWithFallback } from "@/lib/backend";
import {
  attachSessionCookie,
  requestIsSecure,
  USER_SESSION_TTL_SECONDS,
} from "@/lib/auth";

interface SignupBody {
  email?: string;
  password?: string;
  first_name?: string;
  last_name?: string;
  display_name?: string;
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const body = (await req.json().catch(() => null)) as SignupBody | null;
  if (!body?.email?.trim() || !body?.password) {
    return NextResponse.json(
      { error: "email and password are required" },
      { status: 400 },
    );
  }

  let upstream: Response;
  try {
    const result = await fetchWithFallback("/api/v1/auth/signup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: body.email.trim(),
        password: body.password,
        first_name: body.first_name,
        last_name: body.last_name,
        display_name: body.display_name,
      }),
      cache: "no-store",
    });
    upstream = result.response;
  } catch (e) {
    console.error("[auth/signup] backend unavailable:", e);
    return NextResponse.json({ error: "backend unavailable" }, { status: 502 });
  }

  const payload = (await upstream.json().catch(() => null)) as {
    session_token?: string;
    user?: unknown;
    tenant_id?: string;
    api_token?: string | null;
    error?: { message?: string } | string;
  } | null;

  if (!upstream.ok) {
    const message =
      typeof payload?.error === "string"
        ? payload.error
        : payload?.error?.message ?? `Signup failed (${upstream.status})`;
    return NextResponse.json({ error: message }, { status: upstream.status });
  }

  if (!payload?.session_token) {
    return NextResponse.json(
      { error: "signup succeeded but no session token was returned" },
      { status: 502 },
    );
  }

  const res = NextResponse.json({
    ok: true,
    user: payload.user,
    tenant_id: payload.tenant_id,
    // One-time plaintext traffic token — also retrievable later via Settings.
    api_token: payload.api_token ?? null,
  });
  attachSessionCookie(
    res,
    req.headers.get("host"),
    payload.session_token,
    requestIsSecure(req),
    USER_SESSION_TTL_SECONDS,
  );
  return res;
}
