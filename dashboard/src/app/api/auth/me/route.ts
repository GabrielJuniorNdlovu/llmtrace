import { NextRequest, NextResponse } from "next/server";
import { fetchWithFallback } from "@/lib/backend";
import { sessionCookieName } from "@/lib/auth";

export async function GET(req: NextRequest): Promise<NextResponse> {
  const cookieName = sessionCookieName(req.headers.get("host"));
  const session = req.cookies.get(cookieName)?.value;
  if (!session) {
    return NextResponse.json({ error: "auth required" }, { status: 401 });
  }

  try {
    const { response } = await fetchWithFallback("/api/v1/auth/me", {
      method: "GET",
      headers: { Authorization: `Bearer ${session}` },
      cache: "no-store",
    });
    const body = await response.json().catch(() => null);
    return NextResponse.json(body ?? { error: "upstream error" }, {
      status: response.status,
    });
  } catch (e) {
    console.error("[auth/me] backend unavailable:", e);
    return NextResponse.json({ error: "backend unavailable" }, { status: 502 });
  }
}
