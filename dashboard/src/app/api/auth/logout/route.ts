import { NextRequest, NextResponse } from "next/server";
import { fetchWithFallback } from "@/lib/backend";
import { isUserSessionToken, sessionCookieName } from "@/lib/auth";

export async function POST(req: NextRequest): Promise<NextResponse> {
  const cookieName = sessionCookieName(req.headers.get("host"));
  const session = req.cookies.get(cookieName)?.value;

  if (session && isUserSessionToken(session)) {
    try {
      await fetchWithFallback("/api/v1/auth/logout", {
        method: "POST",
        headers: { Authorization: `Bearer ${session}` },
        cache: "no-store",
      });
    } catch (e) {
      console.error("[auth/logout] failed to revoke upstream session:", e);
    }
  }

  const res = NextResponse.json({ ok: true });
  res.cookies.set({
    name: cookieName,
    value: "",
    httpOnly: true,
    sameSite: "strict",
    path: "/",
    maxAge: 0,
  });
  return res;
}
