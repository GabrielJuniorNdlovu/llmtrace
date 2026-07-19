"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  FileSearch,
  Shield,
  DollarSign,
  Users,
  Settings,
  FileCheck,
  BookOpen,
  Gauge,
  ScrollText,
  Code,
  MessageSquare,
  LogOut,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface NavItem {
  href: string;
  label: string;
  icon: typeof LayoutDashboard;
  /** When true, only admin-key sessions (no `/api/auth/me` user) see this item. */
  adminOnly?: boolean;
}

const navItems: NavItem[] = [
  { href: "/", label: "Overview", icon: LayoutDashboard },
  { href: "/traces", label: "Traces", icon: FileSearch },
  { href: "/security", label: "Security", icon: Shield },
  { href: "/audit", label: "Audit", icon: ScrollText },
  { href: "/playground", label: "Playground", icon: MessageSquare },
  { href: "/costs", label: "Costs", icon: DollarSign },
  { href: "/tenants", label: "Tenants", icon: Users, adminOnly: true },
  { href: "/compliance", label: "Compliance", icon: FileCheck },
  { href: "/status", label: "Status", icon: Gauge },
  { href: "/api-docs", label: "API Docs", icon: Code },
  { href: "/guide", label: "Guide", icon: BookOpen },
];

const bottomItems = [{ href: "/settings", label: "Settings", icon: Settings }];

export function Sidebar() {
  const pathname = usePathname();
  const [isSessionUser, setIsSessionUser] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/auth/me", { cache: "no-store" })
      .then((res) => {
        if (!cancelled) setIsSessionUser(res.ok);
      })
      .catch(() => {
        if (!cancelled) setIsSessionUser(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const visibleNav = navItems.filter(
    (item) => !(item.adminOnly && isSessionUser),
  );

  const handleSignOut = async () => {
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } catch (e) {
      console.error("Sign out failed:", e);
    } finally {
      window.location.assign("/login");
    }
  };

  return (
    <aside className="my-4 ml-4 flex h-[calc(100vh-2rem)] w-20 shrink-0 flex-col items-center justify-between gap-2 rounded-3xl border border-white/5 bg-card py-4 shadow-xl">
      <div className="flex min-h-0 w-full flex-col items-center gap-3">
        <Link
          href="/"
          className="shrink-0 text-xl font-bold text-primary"
          title="LLMTrace"
        >
          lt
        </Link>
        <nav className="flex w-full flex-col gap-1.5 px-3 py-1">
          {visibleNav.map((item) => {
            const active =
              item.href === "/"
                ? pathname === "/"
                : pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-label={item.label}
                className={cn(
                  "group relative mx-auto flex h-10 w-10 shrink-0 items-center justify-center rounded-xl transition-all duration-200",
                  active
                    ? "bg-primary text-primary-foreground shadow-[0_0_15px_rgba(157,78,221,0.5)]"
                    : "text-muted-foreground hover:bg-white/5 hover:text-foreground",
                )}
              >
                <item.icon className="h-[18px] w-[18px]" />
                <span className="pointer-events-none absolute left-full z-50 ml-3 whitespace-nowrap rounded-lg border border-white/10 bg-popover px-2.5 py-1 text-xs font-medium text-popover-foreground opacity-0 shadow-lg transition-opacity group-hover:opacity-100">
                  {item.label}
                </span>
              </Link>
            );
          })}
        </nav>
      </div>

      <div className="flex w-full shrink-0 flex-col gap-1.5 px-3">
        {bottomItems.map((item) => {
          const active = pathname.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-label={item.label}
              className={cn(
                "group relative mx-auto flex h-10 w-10 items-center justify-center rounded-xl transition-all duration-200",
                active
                  ? "bg-primary text-primary-foreground shadow-[0_0_15px_rgba(157,78,221,0.5)]"
                  : "text-muted-foreground hover:bg-white/5 hover:text-foreground",
              )}
            >
              <item.icon className="h-[18px] w-[18px]" />
              <span className="pointer-events-none absolute left-full z-50 ml-3 whitespace-nowrap rounded-lg border border-white/10 bg-popover px-2.5 py-1 text-xs font-medium text-popover-foreground opacity-0 shadow-lg transition-opacity group-hover:opacity-100">
                {item.label}
              </span>
            </Link>
          );
        })}
        <button
          type="button"
          onClick={handleSignOut}
          data-testid="sign-out-button"
          aria-label="Sign out"
          className="group relative mx-auto flex h-10 w-10 items-center justify-center rounded-xl text-muted-foreground transition-all duration-200 hover:bg-white/5 hover:text-foreground"
        >
          <LogOut className="h-[18px] w-[18px]" />
          <span className="pointer-events-none absolute left-full z-50 ml-3 whitespace-nowrap rounded-lg border border-white/10 bg-popover px-2.5 py-1 text-xs font-medium text-popover-foreground opacity-0 shadow-lg transition-opacity group-hover:opacity-100">
            Sign out
          </span>
        </button>
      </div>
    </aside>
  );
}
