"use client";

import { useEffect, useState } from "react";
import { Activity, Shield, DollarSign, AlertTriangle } from "lucide-react";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
} from "recharts";
import { StatCard } from "@/components/stat-card";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  type StorageStats,
  type TraceSpan,
  type PaginatedResponse,
  getStats,
  listSecurityFindings,
  listTraces,
  findActiveTenant,
  getGlobalStats,
} from "@/lib/api";

const SEVERITY_COLORS: Record<string, string> = {
  Critical: "hsl(var(--severity-critical))",
  High: "hsl(var(--severity-high))",
  Medium: "hsl(var(--severity-medium))",
  Low: "hsl(var(--severity-low))",
  Info: "hsl(var(--severity-info))",
};

const PIE_COLORS = [
  "hsl(var(--severity-critical))",
  "hsl(var(--severity-high))",
  "hsl(var(--severity-medium))",
  "hsl(var(--severity-low))",
  "hsl(var(--severity-info))",
];

export default function OverviewPage() {
  const [stats, setStats] = useState<StorageStats | null>(null);
  const [globalStats, setGlobalStats] = useState<StorageStats | null>(null);
  const [findings, setFindings] = useState<PaginatedResponse<TraceSpan> | null>(null);
  const [activityData, setActivityData] = useState<{ hour: string; traces: number }[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      try {
        const tenantId = await findActiveTenant();

        const [statsRes, findingsRes, tracesRes, globalRes] = await Promise.all([
          getStats(tenantId),
          listSecurityFindings({ limit: 10 }, tenantId),
          listTraces({ limit: 100 }, tenantId),
          getGlobalStats(),
        ]);
        setStats(statsRes);
        setGlobalStats(globalRes);
        setFindings(findingsRes);

        const now = new Date();
        const buckets = new Map<string, number>();

        for (let i = 5; i >= 0; i--) {
          const d = new Date(now.getTime() - i * 60 * 60 * 1000);
          const key = `${d.getHours().toString().padStart(2, "0")}:00`;
          buckets.set(key, 0);
        }

        if (tracesRes?.data) {
          for (const trace of tracesRes.data) {
            const date = new Date(trace.created_at);
            const key = `${date.getHours().toString().padStart(2, "0")}:00`;
            if (buckets.has(key)) {
              buckets.set(key, (buckets.get(key) ?? 0) + 1);
            }
          }
        }

        const aggregated = Array.from(buckets.entries()).map(([hour, traces]) => ({
          hour,
          traces,
        }));
        setActivityData(aggregated);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to load data");
      }
    }
    load();

    const interval = setInterval(load, 30000);
    return () => clearInterval(interval);
  }, []);

  const severityCounts: Record<string, number> = {};
  if (findings?.data) {
    for (const span of findings.data) {
      for (const f of span.security_findings ?? []) {
        severityCounts[f.severity] = (severityCounts[f.severity] ?? 0) + 1;
      }
    }
  }
  const severityData = Object.entries(severityCounts).map(([name, value]) => ({
    name,
    value,
  }));

  const anomalies =
    findings?.data
      ?.flatMap((s) => s.security_findings || [])
      .filter((f) => f.finding_type.startsWith("anomaly_")) || [];

  if (error) {
    return (
      <div className="space-y-6">
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12 text-muted-foreground">
            <AlertTriangle className="mb-2 h-8 w-8 text-warning" />
            <p className="text-sm">Could not connect to the LLMTrace API</p>
            <p className="mt-1 text-xs">{error}</p>
            <p className="mt-2 text-xs">
              Ensure the proxy is running and{" "}
              <code className="rounded bg-muted px-1">NEXT_PUBLIC_API_URL</code> is set.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          Security-aware LLM observability at a glance
        </p>
        {anomalies.length > 0 && (
          <Badge variant="destructive" className="animate-pulse gap-1 px-3 py-1 text-sm">
            <AlertTriangle className="h-4 w-4" />
            {anomalies.length} Anomalies Detected
          </Badge>
        )}
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        <StatCard
          title="Global Transactions"
          value={globalStats?.total_traces ?? "—"}
          description="Across all tenants"
          icon={Activity}
        />
        <StatCard
          title="Global Security Findings"
          value={globalStats?.total_findings ?? "—"}
          description="Total risks detected"
          icon={Shield}
        />
        <StatCard
          title="Global Costs"
          value={
            globalStats?.total_cost_usd != null
              ? `$${globalStats.total_cost_usd.toFixed(2)}`
              : "—"
          }
          description="Cluster-wide spend"
          icon={DollarSign}
        />
        <StatCard
          title="Total Traces"
          value={stats?.total_traces ?? "—"}
          description="Selected tenant"
          icon={Activity}
        />
        <StatCard
          title="Security Findings"
          value={findings?.total ?? "—"}
          description="Selected tenant"
          icon={Shield}
        />
        <StatCard
          title="Total Cost"
          value={
            stats?.total_cost_usd != null
              ? `$${stats.total_cost_usd.toFixed(2)}`
              : "—"
          }
          description="Selected tenant"
          icon={DollarSign}
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Trace Activity</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={280}>
              <AreaChart
                data={activityData}
                margin={{ top: 10, right: 0, left: -20, bottom: 0 }}
              >
                <defs>
                  <linearGradient id="colorTraces" x1="0" y1="0" x2="0" y2="1">
                    <stop
                      offset="5%"
                      stopColor="hsl(var(--primary))"
                      stopOpacity={0.35}
                    />
                    <stop
                      offset="95%"
                      stopColor="hsl(var(--primary))"
                      stopOpacity={0}
                    />
                  </linearGradient>
                </defs>
                <XAxis
                  dataKey="hour"
                  axisLine={false}
                  tickLine={false}
                  tick={{ fontSize: 12, fill: "hsl(var(--muted-foreground))" }}
                  dy={10}
                />
                <YAxis
                  axisLine={false}
                  tickLine={false}
                  tick={{ fontSize: 12, fill: "hsl(var(--muted-foreground))" }}
                  dx={-10}
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: "hsl(var(--card))",
                    borderColor: "hsl(var(--border))",
                    borderRadius: "12px",
                  }}
                  itemStyle={{ color: "hsl(var(--foreground))" }}
                />
                <Area
                  type="monotone"
                  dataKey="traces"
                  stroke="hsl(var(--primary))"
                  strokeWidth={3}
                  fillOpacity={1}
                  fill="url(#colorTraces)"
                />
              </AreaChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Security Severity Breakdown</CardTitle>
          </CardHeader>
          <CardContent>
            {severityData.length > 0 ? (
              <ResponsiveContainer width="100%" height={280}>
                <PieChart>
                  <Pie
                    data={severityData}
                    dataKey="value"
                    nameKey="name"
                    cx="50%"
                    cy="50%"
                    outerRadius={90}
                    label={({ name, value }) => `${name}: ${value}`}
                  >
                    {severityData.map((entry, i) => (
                      <Cell
                        key={entry.name}
                        fill={
                          SEVERITY_COLORS[entry.name] ??
                          PIE_COLORS[i % PIE_COLORS.length]
                        }
                      />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={{
                      backgroundColor: "hsl(var(--card))",
                      borderColor: "hsl(var(--border))",
                      borderRadius: "12px",
                    }}
                  />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex h-[280px] items-center justify-center text-sm text-muted-foreground">
                No security findings detected
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Recent Security Findings</CardTitle>
        </CardHeader>
        <CardContent>
          {findings?.data && findings.data.length > 0 ? (
            <div className="space-y-3">
              {findings.data.slice(0, 5).map((span) => (
                <div
                  key={span.span_id}
                  className="flex items-center justify-between rounded-2xl border border-white/5 bg-background/40 p-4"
                >
                  <div className="space-y-1">
                    <p className="text-sm font-medium">{span.model_name}</p>
                    <p className="text-xs text-muted-foreground">
                      {span.security_findings?.[0]?.description ?? "Security finding"}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge
                      variant={
                        span.security_score >= 70
                          ? "destructive"
                          : span.security_score >= 40
                            ? "default"
                            : "secondary"
                      }
                    >
                      Score: {span.security_score}
                    </Badge>
                    {span.security_findings?.[0] && (
                      <Badge variant="outline">
                        {span.security_findings[0].severity}
                      </Badge>
                    )}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No recent findings</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
