import { NextRequest, NextResponse } from "next/server";
import { fetchWithFallback } from "@/lib/backend";
import {
  sessionCookieName,
  SESSION_TTL_SECONDS,
  USER_SESSION_TTL_SECONDS,
  expectedAdminUsername,
  expectedAdminKey,
  usernameMatches,
  secretMatches,
  attachSessionCookie,
  requestIsSecure,
} from "@/lib/auth";

interface LoginBody {
  username?: string;
  admin_key?: string;
  email?: string;
  password?: string;
}

interface AuthSessionPayload {
  session_token?: string;
  user?: unknown;
  tenant_id?: string;
  api_token?: string | null;
  error?: { message?: string } | string;
}

async function passwordLogin(
  req: NextRequest,
  email: string,
  password: string,
): Promise<NextResponse> {
  let upstream: Response;
  try {
    const result = await fetchWithFallback("/api/v1/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
      cache: "no-store",
    });
    upstream = result.response;
  } catch (e) {
    console.error("[auth/login] password login backend unavailable:", e);
    return NextResponse.json({ error: "backend unavailable" }, { status: 502 });
  }

  const payload = (await upstream.json().catch(() => null)) as AuthSessionPayload | null;
  if (!upstream.ok) {
    const message =
      typeof payload?.error === "string"
        ? payload.error
        : payload?.error?.message ?? `Login failed (${upstream.status})`;
    return NextResponse.json({ error: message }, { status: upstream.status });
  }

  if (!payload?.session_token) {
    return NextResponse.json(
      { error: "login succeeded but no session token was returned" },
      { status: 502 },
    );
  }

  const res = NextResponse.json({
    ok: true,
    user: payload.user,
    tenant_id: payload.tenant_id,
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

async function adminKeyLogin(
  req: NextRequest,
  username: string,
  adminKey: string,
): Promise<NextResponse> {
  if (!usernameMatches(username, expectedAdminUsername())) {
    return NextResponse.json({ error: "invalid credentials" }, { status: 401 });
  }

  const expectedKey = expectedAdminKey();
  if (!expectedKey) {
    return NextResponse.json(
      {
        error:
          "admin-key login is not configured (set LLMTRACE_AUTH_ADMIN_KEY on the dashboard)",
      },
      { status: 503 },
    );
  }

  // Compare against the configured bootstrap key — never trust "proxy accepted
  // any bearer" which happens whenever LLMTRACE_AUTH_ENABLED=0.
  if (!secretMatches(adminKey, expectedKey)) {
    return NextResponse.json({ error: "invalid credentials" }, { status: 401 });
  }

  // Best-effort upstream probe so a mismatched proxy/dashboard key pair is
  // surfaced clearly when proxy auth is enabled.
  try {
    const { response } = await fetchWithFallback("/api/v1/auth/keys", {
      method: "GET",
      headers: { Authorization: `Bearer ${adminKey}` },
      cache: "no-store",
    });
    if (!response.ok && response.status !== 401 && response.status !== 403) {
      // Transport/backend errors only — 401 here still means the local key
      // matched but the proxy rejected it (auth disabled vs enabled mismatch).
      console.warn(
        `[auth/login] upstream admin-key probe returned ${response.status}`,
      );
    }
    if (response.status === 401 || response.status === 403) {
      return NextResponse.json(
        {
          error:
            "admin key accepted by the dashboard but rejected by the proxy — ensure LLMTRACE_AUTH_ENABLED=1 and the same LLMTRACE_AUTH_ADMIN_KEY is set on both",
        },
        { status: 502 },
      );
    }
  } catch (e) {
    console.error("[auth/login] upstream probe failed:", e);
    return NextResponse.json({ error: "backend unavailable" }, { status: 502 });
  }

  const res = NextResponse.json({ ok: true });
  res.cookies.set({
    name: sessionCookieName(req.headers.get("host")),
    value: adminKey,
    httpOnly: true,
    secure: requestIsSecure(req),
    sameSite: "strict",
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  });
  return res;
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const ct = req.headers.get("content-type") ?? "";
  let body: LoginBody | null = null;

  if (ct.includes("application/json")) {
    body = (await req.json().catch(() => null)) as LoginBody | null;
  } else if (
    ct.includes("application/x-www-form-urlencoded") ||
    ct.includes("multipart/form-data")
  ) {
    const form = await req.formData();
    body = {
      username: typeof form.get("username") === "string" ? String(form.get("username")) : undefined,
      admin_key:
        typeof form.get("admin_key") === "string" ? String(form.get("admin_key")) : undefined,
      email: typeof form.get("email") === "string" ? String(form.get("email")) : undefined,
      password:
        typeof form.get("password") === "string" ? String(form.get("password")) : undefined,
    };
  }

  const email = body?.email?.trim() || null;
  const password = body?.password || null;
  if (email && password) {
    return passwordLogin(req, email, password);
  }

  const username = body?.username?.trim() || null;
  const adminKey = body?.admin_key?.trim() || null;
  if (username && adminKey) {
    return adminKeyLogin(req, username, adminKey);
  }

  return NextResponse.json(
    {
      error:
        "provide email+password for user login, or username+admin_key for operator login",
    },
    { status: 400 },
  );
}
