import { test, expect } from "@playwright/test";

// ---------------------------------------------------------------------------
// Admin-key login flow (issue #250) + auth hardening
//
// When LLMTRACE_AUTH_ADMIN_KEY is set on the dashboard, login must use that
// exact key (not "any non-empty bearer"). CI/local compose should seed the
// same key on proxy + dashboard.
// ---------------------------------------------------------------------------

const PROXY_BASE = process.env.LLMTRACE_PROXY_URL ?? "http://127.0.0.1:8081";
const ADMIN_KEY =
  process.env.LLMTRACE_AUTH_ADMIN_KEY?.trim() || "llmt_local_admin_change_me";

function expectedCookieName(host: string): string {
  const safe = host
    .toLowerCase()
    .replace(/:\d+$/, "")
    .replace(/[^A-Za-z0-9_-]/g, "_");
  return `llmtrace_session__${safe}`;
}

/** Mirror of dashboard `safeNextPath` for open-redirect regression checks. */
function safeNextPath(raw: string | null | undefined, fallback = "/"): string {
  if (!raw) return fallback;
  const trimmed = raw.trim();
  if (!trimmed.startsWith("/")) return fallback;
  if (trimmed.startsWith("//")) return fallback;
  if (trimmed.includes("\\")) return fallback;
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(trimmed)) return fallback;
  return trimmed;
}

test.describe("Admin-key login (issue #250)", () => {
  test.beforeAll(async ({ request }, testInfo) => {
    testInfo.setTimeout(120_000);
    const deadline = Date.now() + 120_000;
    while (true) {
      try {
        const res = await request.get(`${PROXY_BASE}/health`);
        if (res.ok()) return;
      } catch {
        // ignore — keep polling
      }
      if (Date.now() > deadline) {
        throw new Error(`Proxy not healthy at ${PROXY_BASE}/health`);
      }
      await new Promise((r) => setTimeout(r, 500));
    }
  });

  test("health endpoint stays unauthenticated", async ({ request }) => {
    const res = await request.get("/health");
    expect(res.status()).toBe(200);
  });

  test("login page renders the credentials form", async ({ page }) => {
    await page.goto("/login");
    await expect(page.getByTestId("login-email")).toBeVisible();
    await expect(page.getByTestId("login-password")).toBeVisible();
    await expect(page.getByTestId("login-submit")).toBeVisible();
    await page.getByRole("button", { name: "Sign in with admin key" }).click();
    await expect(page.getByTestId("login-username")).toBeVisible();
    await expect(page.getByTestId("login-admin-key")).toBeVisible();
  });

  test("identity endpoint exposes expected username (default 'admin')", async ({ request }) => {
    const res = await request.get("/api/auth/identity");
    expect(res.status()).toBe(200);
    const body = (await res.json()) as { username?: string };
    expect(typeof body.username).toBe("string");
    expect(body.username!.length).toBeGreaterThan(0);
  });

  test("login route rejects missing credentials with 400", async ({ request }) => {
    const res = await request.post("/api/auth/login", {
      data: {},
      headers: { "Content-Type": "application/json" },
    });
    expect(res.status()).toBe(400);
  });

  test("login route rejects wrong username with 401", async ({ request }) => {
    const res = await request.post("/api/auth/login", {
      data: { username: "definitely-not-the-seeded-user", admin_key: ADMIN_KEY },
      headers: { "Content-Type": "application/json" },
    });
    expect(res.status()).toBe(401);
  });

  test("login route rejects wrong admin key with 401", async ({ request }) => {
    const identityRes = await request.get("/api/auth/identity");
    const identity = (await identityRes.json()) as { username: string };
    const res = await request.post("/api/auth/login", {
      data: {
        username: identity.username,
        admin_key: "definitely-not-the-configured-admin-key",
      },
      headers: { "Content-Type": "application/json" },
    });
    expect(res.status()).toBe(401);
  });

  test("login route sets host-scoped session cookie on success", async ({ request, baseURL }) => {
    const identityRes = await request.get("/api/auth/identity");
    const identity = (await identityRes.json()) as { username: string };

    const res = await request.post("/api/auth/login", {
      data: { username: identity.username, admin_key: ADMIN_KEY },
      headers: { "Content-Type": "application/json" },
    });
    expect(res.status(), `login response: ${await res.text()}`).toBe(200);

    const setCookie = res.headers()["set-cookie"] ?? "";
    expect(setCookie).toContain("llmtrace_session__");
    expect(setCookie.toLowerCase()).toContain("httponly");
    expect(setCookie.toLowerCase()).toContain("samesite=strict");

    const host = new URL(baseURL ?? "http://localhost:3000").host;
    expect(setCookie).toContain(expectedCookieName(host));
  });

  test("logout route clears the session cookie", async ({ request }) => {
    const res = await request.post("/api/auth/logout");
    expect(res.status()).toBe(200);
    const setCookie = res.headers()["set-cookie"] ?? "";
    expect(setCookie).toContain("llmtrace_session__");
    expect(/Max-Age=0|Expires=Thu, 01 Jan 1970/i.test(setCookie)).toBeTruthy();
  });

  test("safeNextPath rejects open redirects", async () => {
    expect(safeNextPath("/traces")).toBe("/traces");
    expect(safeNextPath("//evil.com")).toBe("/");
    expect(safeNextPath("https://evil.com")).toBe("/");
    expect(safeNextPath("/\\evil")).toBe("/");
    expect(safeNextPath(null)).toBe("/");
  });
});
