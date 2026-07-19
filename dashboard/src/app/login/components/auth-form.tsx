"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Eye, EyeOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { setStoredTenant } from "@/lib/api";
import { safeNextPath } from "@/lib/auth";

type AuthMode = "signup" | "login" | "admin";

export function AuthForm(): React.ReactElement {
  const router = useRouter();
  const search = useSearchParams();
  const next = safeNextPath(search.get("next"), "/");

  const [mode, setMode] = useState<AuthMode>("login");
  const [showPassword, setShowPassword] = useState(false);
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const [username, setUsername] = useState("");
  const [adminKey, setAdminKey] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    const err = search.get("error");
    if (!err) return;
    const messages: Record<string, string> = {
      sso: "That one-click sign-in link has expired or is invalid.",
    };
    setError(messages[err] ?? "Sign-in failed. Please try again.");
  }, [search]);

  useEffect(() => {
    if (mode !== "admin") return;
    let cancelled = false;
    fetch("/api/auth/identity", { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : null))
      .then((body: { username?: string } | null) => {
        if (cancelled || !body?.username) return;
        setUsername(body.username);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [mode]);

  async function onSubmit(e: FormEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
    setError(null);
    setPending(true);
    try {
      if (mode === "signup") {
        if (!acceptedTerms) {
          setError("You must agree to the Terms & Conditions");
          return;
        }
        const res = await fetch("/api/auth/signup", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            email,
            password,
            first_name: firstName || undefined,
            last_name: lastName || undefined,
          }),
        });
        const body = (await res.json().catch(() => null)) as {
          error?: string;
          tenant_id?: string;
          api_token?: string | null;
        } | null;
        if (!res.ok) {
          setError(body?.error ?? `Signup failed (${res.status})`);
          return;
        }
        if (body?.tenant_id) {
          setStoredTenant(body.tenant_id);
        }
        if (body?.api_token) {
          try {
            sessionStorage.setItem("llmtrace_signup_api_token", body.api_token);
          } catch {
            // sessionStorage may be unavailable; Settings can still fetch the token.
          }
        }
        router.replace(body?.api_token ? "/settings?new_token=1" : next);
        router.refresh();
        return;
      }

      if (mode === "login") {
        const res = await fetch("/api/auth/login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email, password }),
        });
        const body = (await res.json().catch(() => null)) as {
          error?: string;
          tenant_id?: string;
        } | null;
        if (!res.ok) {
          setError(body?.error ?? `Login failed (${res.status})`);
          return;
        }
        if (body?.tenant_id) {
          setStoredTenant(body.tenant_id);
        }
        router.replace(next);
        router.refresh();
        return;
      }

      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, admin_key: adminKey }),
      });
      const body = (await res.json().catch(() => null)) as {
        error?: string;
      } | null;
      if (!res.ok) {
        setError(body?.error ?? `Login failed (${res.status})`);
        return;
      }
      router.replace(next);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Authentication failed");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex w-full flex-col gap-8">
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold tracking-tight text-foreground">
          {mode === "signup"
            ? "Create an account"
            : mode === "admin"
              ? "Operator sign in"
              : "Welcome back"}
        </h1>
        <p className="text-sm text-muted-foreground">
          {mode === "signup" ? (
            <>
              Already have an account?{" "}
              <button
                type="button"
                className="text-primary underline transition-colors hover:text-primary/80"
                onClick={() => {
                  setMode("login");
                  setError(null);
                }}
              >
                Log in
              </button>
            </>
          ) : mode === "login" ? (
            <>
              New to LLMTrace?{" "}
              <button
                type="button"
                className="text-primary underline transition-colors hover:text-primary/80"
                onClick={() => {
                  setMode("signup");
                  setError(null);
                }}
              >
                Create an account
              </button>
            </>
          ) : (
            <>
              Prefer email login?{" "}
              <button
                type="button"
                className="text-primary underline transition-colors hover:text-primary/80"
                onClick={() => {
                  setMode("login");
                  setError(null);
                }}
              >
                Back to user login
              </button>
            </>
          )}
        </p>
      </div>

      <form className="flex flex-col gap-5" onSubmit={onSubmit}>
        {mode === "signup" && (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-2">
              <Label htmlFor="firstName" className="sr-only">
                First name
              </Label>
              <Input
                id="firstName"
                placeholder="First name"
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                className="rounded-xl border-muted bg-muted/50"
                autoComplete="given-name"
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="lastName" className="sr-only">
                Last name
              </Label>
              <Input
                id="lastName"
                placeholder="Last name"
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                className="rounded-xl border-muted bg-muted/50"
                autoComplete="family-name"
              />
            </div>
          </div>
        )}

        {mode === "admin" ? (
          <>
            <div className="flex flex-col gap-2">
              <Label htmlFor="username">Email or username</Label>
              <Input
                id="username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="rounded-xl border-muted bg-muted/50"
                autoComplete="username"
                data-testid="login-username"
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="admin_key">Admin key</Label>
              <Input
                id="admin_key"
                type="password"
                value={adminKey}
                onChange={(e) => setAdminKey(e.target.value)}
                className="rounded-xl border-muted bg-muted/50"
                autoComplete="current-password"
                data-testid="login-admin-key"
              />
            </div>
          </>
        ) : (
          <>
            <div className="flex flex-col gap-2">
              <Label htmlFor="email" className="sr-only">
                Email
              </Label>
              <Input
                id="email"
                type="email"
                placeholder="Email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="rounded-xl border-muted bg-muted/50"
                autoComplete="email"
                required
                data-testid="login-email"
              />
            </div>
            <div className="relative flex flex-col gap-2">
              <Label htmlFor="password" className="sr-only">
                Password
              </Label>
              <Input
                id="password"
                type={showPassword ? "text" : "password"}
                placeholder={
                  mode === "signup" ? "Create a password" : "Enter your password"
                }
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="rounded-xl border-muted bg-muted/50 pr-10"
                autoComplete={
                  mode === "signup" ? "new-password" : "current-password"
                }
                required
                minLength={8}
                data-testid="login-password"
              />
              <button
                type="button"
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground transition-colors hover:text-foreground"
                onClick={() => setShowPassword((v) => !v)}
              >
                {showPassword ? (
                  <EyeOff className="size-4" />
                ) : (
                  <Eye className="size-4" />
                )}
                <span className="sr-only">Toggle password visibility</span>
              </button>
            </div>
          </>
        )}

        {mode === "signup" && (
          <div className="mt-1 flex items-center gap-2">
            <Checkbox
              id="terms"
              checked={acceptedTerms}
              onChange={(e) => setAcceptedTerms(e.target.checked)}
              className="border-muted-foreground/30 data-[state=checked]:bg-primary"
            />
            <Label
              htmlFor="terms"
              className="text-sm font-normal leading-none text-muted-foreground"
            >
              I agree to the Terms & Conditions
            </Label>
          </div>
        )}

        {error && (
          <p
            role="alert"
            className="rounded-xl bg-destructive/15 px-3 py-2 text-sm text-destructive"
            data-testid="login-error"
          >
            {error}
          </p>
        )}

        <Button
          type="submit"
          disabled={pending}
          className="mt-2 h-11 w-full font-medium"
          data-testid="login-submit"
        >
          {pending
            ? mode === "signup"
              ? "Creating account..."
              : "Signing in..."
            : mode === "signup"
              ? "Create account"
              : "Sign in"}
        </Button>
      </form>

      {mode !== "admin" && (
        <p className="text-center text-xs text-muted-foreground">
          Operator?{" "}
          <button
            type="button"
            className="underline transition-colors hover:text-foreground"
            onClick={() => {
              setMode("admin");
              setError(null);
            }}
          >
            Sign in with admin key
          </button>
        </p>
      )}
    </div>
  );
}
