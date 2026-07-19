"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { RefreshCw, CheckCircle, XCircle, Copy, Check, KeyRound } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import {
  getTenantToken,
  resetTenantToken,
  healthCheck,
} from "@/lib/api";

interface HealthStatus {
  status: string;
  storage?: { healthy: boolean };
  security?: { healthy: boolean };
}

interface LiveConfigPayload {
  config: Record<string, unknown>;
}

interface SettingsClientProps {
  proxyUrl: string;
}

type UpstreamUrlState =
  | { status: "loading" }
  | { status: "ok"; value: string }
  | { status: "missing" }
  | { status: "unavailable" };

function humanizeKey(key: string): string {
  return key
    .replace(/_/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function formatPrimitive(value: string | number | boolean | null): string {
  if (value === null) return "Not set";
  if (typeof value === "boolean") return value ? "Enabled" : "Disabled";
  return String(value);
}

function renderConfigValue(value: unknown, depth = 0) {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    const text = formatPrimitive(value);
    const isRedacted = text === "***redacted***";
    return (
      <span className={isRedacted ? "font-mono text-warning" : "font-mono"}>
        {isRedacted ? "Redacted" : text}
      </span>
    );
  }

  if (Array.isArray(value)) {
    if (value.length === 0) {
      return <span className="text-muted-foreground">None</span>;
    }
    return (
      <div className="space-y-2">
        {value.map((item, index) => (
          <div
            key={`${depth}-${index}`}
            className="rounded-2xl border border-white/5 bg-card/50 p-2"
          >
            {renderConfigValue(item, depth + 1)}
          </div>
        ))}
      </div>
    );
  }

  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length === 0) {
      return <span className="text-muted-foreground">None</span>;
    }

    return (
      <div className="space-y-2">
        {entries.map(([key, nested]) => (
          <div
            key={`${depth}-${key}`}
            className="grid gap-2 rounded-2xl border border-white/5 bg-card/50 p-3 md:grid-cols-[240px_1fr]"
          >
            <div className="text-sm font-medium">{humanizeKey(key)}</div>
            <div className="text-sm">{renderConfigValue(nested, depth + 1)}</div>
          </div>
        ))}
      </div>
    );
  }

  return <span className="text-muted-foreground">Unsupported value</span>;
}

function deriveUpstreamState(config: Record<string, unknown> | null): UpstreamUrlState {
  if (config === null) return { status: "unavailable" };
  const raw = config["upstream_url"];
  if (typeof raw === "string" && raw.trim().length > 0) {
    return { status: "ok", value: raw };
  }
  return { status: "missing" };
}

interface CopyButtonProps {
  value: string;
  label: string;
}

function CopyButton({ value, label }: CopyButtonProps) {
  const [copied, setCopied] = useState(false);

  async function handleCopy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  }

  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={handleCopy}
      aria-label={`Copy ${label}`}
      data-testid={`copy-${label.replace(/\s+/g, "-").toLowerCase()}`}
    >
      {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
    </Button>
  );
}

interface UrlRowProps {
  label: string;
  value: string | null;
  emptyLabel: string;
  emptyTone: "warning" | "muted";
  note?: string;
  testId: string;
  copyable: boolean;
}

function UrlRow({ label, value, emptyLabel, emptyTone, note, testId, copyable }: UrlRowProps) {
  const hasValue = value !== null && value.trim().length > 0;
  const emptyClass =
    emptyTone === "warning" ? "text-warning font-medium" : "text-muted-foreground";

  return (
    <div className="flex items-start gap-3" data-testid={testId}>
      <div className="flex-1 min-w-0">
        <label className="text-xs text-muted-foreground">{label}</label>
        {hasValue ? (
          <p className="font-mono text-sm break-all" data-testid={`${testId}-value`}>
            {value}
          </p>
        ) : (
          <p className={`text-sm ${emptyClass}`} data-testid={`${testId}-value`}>
            {emptyLabel}
          </p>
        )}
        {note ? <p className="text-xs text-muted-foreground mt-1">{note}</p> : null}
      </div>
      {hasValue && copyable ? <CopyButton value={value} label={label} /> : null}
    </div>
  );
}

interface ConnectionStatusBadgeProps {
  health: HealthStatus | null;
  loading: boolean;
  onCheck: () => void;
}

function ConnectionStatusBadge({ health, loading, onCheck }: ConnectionStatusBadgeProps) {
  const isHealthy = health?.status === "ok" || health?.status === "healthy";
  return (
    <div className="flex items-center gap-3">
      <div>
        <label className="text-xs text-muted-foreground">Status</label>
        <div className="flex items-center gap-2">
          {isHealthy ? (
            <>
              <CheckCircle className="h-4 w-4 text-success" />
              <Badge variant="secondary" className="bg-success/15 text-success border border-success/30">
                Connected
              </Badge>
            </>
          ) : (
            <>
              <XCircle className="h-4 w-4 text-destructive" />
              <Badge variant="destructive">Disconnected</Badge>
            </>
          )}
        </div>
      </div>
      <Button variant="outline" size="sm" onClick={onCheck} disabled={loading}>
        <RefreshCw className={`mr-2 h-4 w-4 ${loading ? "animate-spin" : ""}`} />
        Check
      </Button>
    </div>
  );
}

export default function SettingsClient({ proxyUrl }: SettingsClientProps) {
  const [health, setHealth] = useState<HealthStatus | null>(null);
  const [liveConfig, setLiveConfig] = useState<Record<string, unknown> | null>(null);
  const [upstream, setUpstream] = useState<UpstreamUrlState>({ status: "loading" });
  const [loading, setLoading] = useState(false);
  const [configLoading, setConfigLoading] = useState(false);
  const [sessionTenantId, setSessionTenantId] = useState<string | null>(null);
  const [apiToken, setApiToken] = useState<string | null>(null);
  const [tokenLoading, setTokenLoading] = useState(false);
  const [tokenError, setTokenError] = useState<string | null>(null);
  const [showNewTokenBanner, setShowNewTokenBanner] = useState(false);

  async function checkHealth(): Promise<void> {
    console.log("[Settings] Checking health via API helper...");
    setLoading(true);
    try {
      const data = await healthCheck();
      console.log("[Settings] Health check response:", data);
      setHealth(data);
    } catch (e) {
      console.error("[Settings] Health check failed:", e);
      setHealth({ status: "unreachable" });
    } finally {
      setLoading(false);
    }
  }

  async function fetchLiveConfig(): Promise<void> {
    setConfigLoading(true);
    try {
      const response = await fetch("/api/proxy/config/live", { cache: "no-store" });
      if (!response.ok) {
        throw new Error(`Failed to load config: ${response.status}`);
      }
      const data = (await response.json()) as LiveConfigPayload;
      setLiveConfig(data.config);
      setUpstream(deriveUpstreamState(data.config));
    } catch {
      setLiveConfig(null);
      setUpstream({ status: "unavailable" });
    } finally {
      setConfigLoading(false);
    }
  }

  async function loadWorkspaceToken(tenantId: string): Promise<void> {
    setTokenLoading(true);
    setTokenError(null);
    try {
      let fromSignup: string | null = null;
      try {
        fromSignup = sessionStorage.getItem("llmtrace_signup_api_token");
        if (fromSignup) {
          sessionStorage.removeItem("llmtrace_signup_api_token");
        }
      } catch {
        fromSignup = null;
      }
      if (fromSignup) {
        setApiToken(fromSignup);
        return;
      }
      const res = await getTenantToken(tenantId);
      setApiToken(res.api_token);
    } catch (e) {
      setTokenError(e instanceof Error ? e.message : "Failed to load API token");
      setApiToken(null);
    } finally {
      setTokenLoading(false);
    }
  }

  async function handleResetToken(): Promise<void> {
    if (!sessionTenantId) return;
    setTokenLoading(true);
    setTokenError(null);
    try {
      const res = await resetTenantToken(sessionTenantId);
      setApiToken(res.api_token);
    } catch (e) {
      setTokenError(e instanceof Error ? e.message : "Failed to reset API token");
    } finally {
      setTokenLoading(false);
    }
  }

  useEffect(() => {
    checkHealth();
    fetchLiveConfig();
    if (typeof window !== "undefined") {
      const params = new URLSearchParams(window.location.search);
      setShowNewTokenBanner(params.get("new_token") === "1");
    }
    let cancelled = false;
    fetch("/api/auth/me", { cache: "no-store" })
      .then(async (res) => {
        if (!res.ok || cancelled) return;
        const me = (await res.json()) as { tenant_id?: string };
        if (!me.tenant_id || cancelled) return;
        setSessionTenantId(me.tenant_id);
        await loadWorkspaceToken(me.tenant_id);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const proxyValue = proxyUrl.trim().length > 0 ? proxyUrl : null;
  const upstreamValue = upstream.status === "ok" ? upstream.value : null;
  const upstreamEmptyLabel =
    upstream.status === "loading"
      ? "Loading..."
      : upstream.status === "missing"
        ? "Not configured"
        : "Unavailable";

  return (
    <div className="space-y-6">
      <p className="text-sm text-muted-foreground">
        URLs, connectivity, and runtime configuration for the LLMTrace proxy
      </p>

      {sessionTenantId ? (
        <Card data-testid="workspace-api-token-card">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <KeyRound className="h-4 w-4" />
              Workspace API Token
            </CardTitle>
            <CardDescription>
              Use this bearer token when sending traffic through the proxy for your
              workspace. Rotate it if it may have been exposed.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {showNewTokenBanner ? (
              <p className="rounded-xl border border-primary/30 bg-primary/10 px-3 py-2 text-sm text-foreground">
                Your account is ready. Copy your workspace API token below — you can
                always retrieve or rotate it here later.
              </p>
            ) : null}
            {tokenError ? (
              <p className="text-sm text-destructive">{tokenError}</p>
            ) : null}
            <UrlRow
              label="API token"
              value={apiToken}
              emptyLabel={tokenLoading ? "Loading..." : "Unavailable"}
              emptyTone="warning"
              note="Send as Authorization: Bearer <token> on /v1/* requests."
              testId="workspace-api-token-row"
              copyable
            />
            <Button
              variant="outline"
              size="sm"
              onClick={() => void handleResetToken()}
              disabled={tokenLoading || !sessionTenantId}
              data-testid="reset-workspace-api-token"
            >
              <RefreshCw
                className={`mr-2 h-4 w-4 ${tokenLoading ? "animate-spin" : ""}`}
              />
              Rotate token
            </Button>
          </CardContent>
        </Card>
      ) : null}

      {/* API Connection */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">API Connection</CardTitle>
          <CardDescription>
            URLs and reachability for the LLMTrace proxy that powers this dashboard.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <UrlRow
            label="Proxy public URL"
            value={proxyValue}
            emptyLabel="Not configured"
            emptyTone="warning"
            note="The address tenants' apps POST /v1/* traffic to."
            testId="proxy-public-url-row"
            copyable
          />
          <UrlRow
            label="Dashboard to Proxy URL"
            value={proxyValue}
            emptyLabel="Not configured"
            emptyTone="warning"
            note="Internal backend address — same as public URL on this deployment."
            testId="dashboard-proxy-url-row"
            copyable
          />
          <UrlRow
            label="Upstream URL"
            value={upstreamValue}
            emptyLabel={upstreamEmptyLabel}
            emptyTone="muted"
            note="Where the proxy forwards /v1/* (OpenAI, Anthropic, Moonshot, etc.)."
            testId="upstream-url-row"
            copyable={false}
          />
          <ConnectionStatusBadge health={health} loading={loading} onCheck={checkHealth} />
        </CardContent>
      </Card>

      {/* Environment */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Environment Variables</CardTitle>
          <CardDescription>
            Configure the dashboard via environment variables.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="overflow-hidden rounded-2xl border border-white/5 bg-card/50">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/50">
                  <th className="px-4 py-2 text-left font-medium">Variable</th>
                  <th className="px-4 py-2 text-left font-medium">Description</th>
                  <th className="px-4 py-2 text-left font-medium">Default</th>
                </tr>
              </thead>
              <tbody>
                <tr className="border-b">
                  <td className="px-4 py-2 font-mono text-xs">LLMTRACE_PROXY_URL</td>
                  <td className="px-4 py-2">Proxy public URL surfaced to operators</td>
                  <td className="px-4 py-2 text-muted-foreground">unset</td>
                </tr>
                <tr className="border-b">
                  <td className="px-4 py-2 font-mono text-xs">LLMTRACE_API_URL</td>
                  <td className="px-4 py-2">LLMTrace proxy base URL (server-side proxy routes)</td>
                  <td className="px-4 py-2 text-muted-foreground">unset</td>
                </tr>
                <tr>
                  <td className="px-4 py-2 font-mono text-xs">PORT</td>
                  <td className="px-4 py-2">Dashboard listen port</td>
                  <td className="px-4 py-2 text-muted-foreground">3000</td>
                </tr>
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Current Configuration */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Current Configuration</CardTitle>
          <CardDescription>
            Redacted runtime configuration currently loaded by the proxy server.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Button variant="outline" size="sm" onClick={fetchLiveConfig} disabled={configLoading}>
            <RefreshCw className={`mr-2 h-4 w-4 ${configLoading ? "animate-spin" : ""}`} />
            Refresh Config
          </Button>
          <div className="rounded-2xl border border-white/5 bg-card/50 p-3">
            {liveConfig ? (
              <div className="max-h-[520px] overflow-auto pr-1">
                {renderConfigValue(liveConfig)}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">Live configuration unavailable.</p>
            )}
          </div>
        </CardContent>
      </Card>

      {/* API Endpoints moved to /api-docs */}
      <Card>
        <CardContent className="py-4 text-sm">
          API endpoints reference moved to{" "}
          <Link href="/api-docs" className="underline">
            /api-docs
          </Link>
          .
        </CardContent>
      </Card>
    </div>
  );
}
