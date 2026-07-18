"use client";

import { useCallback, useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { User, Activity } from "lucide-react";
import {
  listTenants,
  setStoredTenant,
  type Tenant,
  DEFAULT_TENANT_ID,
  ALL_TENANTS_SCOPE,
  STORED_TENANT_KEY,
  TENANTS_CHANGED_EVENT,
} from "@/lib/api";

const PAGE_TITLES: Record<string, string> = {
  "/": "Overview",
  "/traces": "Traces",
  "/security": "Security",
  "/audit": "Audit",
  "/playground": "Playground",
  "/costs": "Costs",
  "/tenants": "Tenants",
  "/tenants/config": "Tenant Config",
  "/compliance": "Compliance",
  "/status": "Status",
  "/api-docs": "API Docs",
  "/guide": "Guide",
  "/settings": "Settings",
};

function resolveTitle(pathname: string): string {
  if (PAGE_TITLES[pathname]) return PAGE_TITLES[pathname];
  if (pathname.startsWith("/traces/")) return "Trace Detail";
  if (pathname.startsWith("/tenants")) return "Tenants";
  return "LLMTrace";
}

interface SessionUser {
  id: string;
  tenant_id: string;
  email: string;
  display_name: string;
}

interface TopBarProps {
  proxyHealthy?: boolean;
  reconnecting?: boolean;
}

export function TopBar({
  proxyHealthy = true,
  reconnecting = false,
}: TopBarProps) {
  const pathname = usePathname();
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [selectedTenant, setSelectedTenant] =
    useState<string>(DEFAULT_TENANT_ID);
  const [sessionUser, setSessionUser] = useState<SessionUser | null>(null);

  const loadTenants = useCallback(async () => {
    try {
      const meRes = await fetch("/api/auth/me", { cache: "no-store" });
      if (meRes.ok) {
        const me = (await meRes.json()) as SessionUser;
        setSessionUser(me);
        setTenants([
          {
            id: me.tenant_id,
            name: me.display_name
              ? `${me.display_name}'s workspace`
              : me.email,
            api_token: "",
            plan: "free",
            created_at: "",
            config: {
              tenant_id: me.tenant_id,
              security_thresholds: {},
              feature_flags: {},
              monitoring_scope: "hybrid",
            },
          },
        ]);
        setSelectedTenant(me.tenant_id);
        setStoredTenant(me.tenant_id);
        return;
      }
      setSessionUser(null);

      const data = await listTenants();
      setTenants(data);
      const stored = localStorage.getItem(STORED_TENANT_KEY);

      if (
        stored &&
        (stored === ALL_TENANTS_SCOPE ||
          stored === DEFAULT_TENANT_ID ||
          data.some((t) => t.id === stored))
      ) {
        setSelectedTenant(stored);
      } else if (data.length > 0) {
        setSelectedTenant(data[0].id);
        setStoredTenant(data[0].id);
      } else {
        setSelectedTenant(DEFAULT_TENANT_ID);
        setStoredTenant(DEFAULT_TENANT_ID);
      }
    } catch (e) {
      console.error("Failed to load tenants in top bar", e);
      setSelectedTenant(DEFAULT_TENANT_ID);
    }
  }, []);

  useEffect(() => {
    void loadTenants();
    const onChanged = () => void loadTenants();
    window.addEventListener(TENANTS_CHANGED_EVENT, onChanged);
    return () => window.removeEventListener(TENANTS_CHANGED_EVENT, onChanged);
  }, [loadTenants]);

  const handleTenantChange = (id: string) => {
    if (sessionUser) return;
    setSelectedTenant(id);
    setStoredTenant(id);
    window.location.reload();
  };

  const statusLabel = reconnecting
    ? "Reconnecting"
    : proxyHealthy
      ? "Online"
      : "Offline";
  const statusColor = reconnecting
    ? "bg-warning"
    : proxyHealthy
      ? "bg-success"
      : "bg-destructive";

  const pinnedLabel =
    sessionUser?.display_name ||
    sessionUser?.email ||
    tenants.find((t) => t.id === selectedTenant)?.name ||
    "Your workspace";

  return (
    <header className="flex h-20 w-full items-center justify-between px-8">
      <div className="flex flex-1 items-center gap-4">
        <h1 className="text-xl font-semibold tracking-tight">
          {resolveTitle(pathname)}
        </h1>

        <div className="flex h-10 items-center gap-2 rounded-full border border-white/5 bg-card/50 px-4">
          <User className="h-3.5 w-3.5 text-muted-foreground" />
          {sessionUser ? (
            <span
              className="max-w-[220px] truncate text-sm font-medium text-foreground"
              data-testid="tenant-selector"
              title={sessionUser.email}
            >
              {pinnedLabel}
            </span>
          ) : (
            <select
              value={selectedTenant}
              onChange={(e) => handleTenantChange(e.target.value)}
              data-testid="tenant-selector"
              className="max-w-[200px] cursor-pointer appearance-none bg-transparent text-sm font-medium text-foreground [color-scheme:dark] focus:outline-none"
            >
              <option
                value={ALL_TENANTS_SCOPE}
                className="bg-popover text-popover-foreground"
              >
                All tenants
              </option>
              {(tenants.length === 0 ||
                selectedTenant === DEFAULT_TENANT_ID) && (
                <option
                  value={DEFAULT_TENANT_ID}
                  className="bg-popover text-popover-foreground"
                >
                  Default Tenant
                </option>
              )}
              {tenants.map((t) => (
                <option
                  key={t.id}
                  value={t.id}
                  className="bg-popover text-popover-foreground"
                >
                  {t.name}
                </option>
              ))}
            </select>
          )}
        </div>
      </div>

      <div className="flex items-center gap-4">
        <div className="flex h-10 items-center gap-2 rounded-full border border-white/5 bg-card/50 px-4">
          <span
            className={`h-2 w-2 rounded-full ${statusColor} ${
              reconnecting ? "animate-pulse" : ""
            }`}
          />
          <Activity className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="text-sm font-medium">
            <span className="text-foreground">Proxy</span>{" "}
            <span className="text-muted-foreground">{statusLabel}</span>
          </span>
        </div>
      </div>
    </header>
  );
}
