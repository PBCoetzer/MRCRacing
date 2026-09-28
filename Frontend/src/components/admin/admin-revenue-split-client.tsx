"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  BadgePercent,
  CircleDollarSign,
  HeartHandshake,
  Landmark,
  Loader2,
  RefreshCw,
  UserRoundCheck,
} from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatRaceDateTime } from "@/lib/racing/format";
import { createClient } from "@/lib/supabase/client";

type RevenuePolicy = {
  trigger: "content_spend";
  allocationVersion: string;
  effectiveAt: string;
  horseCareRate: number;
  platformRate: number;
  tipsterRate: number;
  rewardCreditsExcluded: boolean;
  creditTopUpsExcluded: boolean;
};

type RevenueSummary = {
  purchaseCount: number;
  disputedCount: number;
  refundedPurchaseCount: number;
  historicalPurchaseCount: number;
  contentCreditsUsed: number;
  purchasedCreditsUsed: number;
  rewardCreditsExcluded: number;
  horseCareCredits: number;
  platformCredits: number;
  tipsterCredits: number;
  allocatedCredits: number;
  reconciliationDifference: number;
};

type OpeningSettlement = {
  settledThrough: string;
  reason: string;
  horseCareCredits: number;
  platformCredits: number;
  tipsterCredits: number;
  totalCredits: number;
  tipsters: {
    tipsterId: string;
    tipsterName: string;
    settledCredits: number;
  }[];
};

type TipsterRevenue = {
  tipsterId: string;
  tipsterName: string;
  purchaseCount: number;
  contentCreditsUsed: number;
  purchasedCreditsUsed: number;
  rewardCreditsExcluded: number;
  horseCareCredits: number;
  platformCredits: number;
  tipsterCredits: number;
};

type RecentRevenue = {
  purchaseId: string;
  createdAt: string;
  purchaseType: "meeting" | "subscription";
  status: "active" | "disputed" | "refunded" | "cancelled";
  tipsterName: string;
  sourceLabel: string;
  contentCreditsUsed: number;
  purchasedCreditsUsed: number;
  rewardCreditsExcluded: number;
  horseCareCredits: number;
  platformCredits: number;
  tipsterCredits: number;
  allocationVersion: string;
};

type RevenueReport = {
  policy: RevenuePolicy;
  summary: RevenueSummary;
  openingSettlement: OpeningSettlement;
  byTipster: TipsterRevenue[];
  recent: RecentRevenue[];
  generatedAt: string;
};

function credits(value: number) {
  return `${Number(value).toLocaleString("en-ZA", { maximumFractionDigits: 2 })} Credits`;
}

export function AdminRevenueSplitClient() {
  const [report, setReport] = useState<RevenueReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");

  const loadReport = useCallback(async (refresh = false) => {
    const supabase = createClient();

    if (!supabase) {
      setError("Supabase is not configured.");
      setLoading(false);
      return;
    }

    if (refresh) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }
    setError("");

    const { data, error: reportError } = await supabase.rpc(
      "admin_get_revenue_split_report",
      { p_limit: 100 },
    );

    if (reportError) {
      setError(reportError.message);
    } else {
      setReport(data as RevenueReport);
    }

    setLoading(false);
    setRefreshing(false);
  }, []);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => void loadReport(), 0);
    return () => window.clearTimeout(timeoutId);
  }, [loadReport]);

  const reconciliationOk = useMemo(
    () => Math.abs(Number(report?.summary.reconciliationDifference ?? 0)) < 0.005,
    [report],
  );

  if (loading) {
    return (
      <Card>
        <CardContent className="flex min-h-64 items-center justify-center gap-2">
          <Loader2 className="size-5 animate-spin" />
          Loading revenue allocation…
        </CardContent>
      </Card>
    );
  }

  if (!report) {
    return (
      <Alert variant="destructive">
        <AlertTitle>Revenue report unavailable</AlertTitle>
        <AlertDescription>{error || "The revenue report did not return data."}</AlertDescription>
      </Alert>
    );
  }

  const allocationCards = [
    {
      label: "Horse Care",
      rate: report.policy.horseCareRate,
      value: report.summary.horseCareCredits,
      icon: HeartHandshake,
    },
    {
      label: "MRC platform",
      rate: report.policy.platformRate,
      value: report.summary.platformCredits,
      icon: Landmark,
    },
    {
      label: "Tipsters",
      rate: report.policy.tipsterRate,
      value: report.summary.tipsterCredits,
      icon: UserRoundCheck,
    },
  ];

  return (
    <div className="space-y-6">
      {error ? (
        <Alert variant="destructive">
          <AlertTitle>Refresh failed</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <Alert>
        <CircleDollarSign className="size-4" />
        <AlertTitle>Forward-only 10/20/70 period active</AlertTitle>
        <AlertDescription>
          Started {formatRaceDateTime(report.policy.effectiveAt)}. No allocation is recorded when a client buys Credits; the split is recorded only when cash-backed Credits are used on a meeting card or subscription. Reward Credits are excluded.
        </AlertDescription>
      </Alert>

      <Card>
        <CardHeader>
          <CardTitle>Opening Settlement Recorded</CardTitle>
          <CardDescription>{report.openingSettlement.reason}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {[
              ["Horse Care Settled", report.openingSettlement.horseCareCredits],
              ["MRC Platform Settled", report.openingSettlement.platformCredits],
              ["Tipsters Settled", report.openingSettlement.tipsterCredits],
              ["Total Settled History", report.openingSettlement.totalCredits],
            ].map(([label, value]) => (
              <div key={String(label)} className="rounded-lg border bg-background/45 p-4">
                <p className="text-sm text-muted-foreground">{label}</p>
                <p className="mt-1 font-mono text-xl">{credits(Number(value))}</p>
              </div>
            ))}
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-muted-foreground">
            <span>Settled through {formatRaceDateTime(report.openingSettlement.settledThrough)}. Client Purchased Credits and Reward Credits were not changed.</span>
            <Button asChild size="sm" variant="outline">
              <Link href="/admin/#internal-ledger">View Historical Ledger</Link>
            </Button>
          </div>
        </CardContent>
      </Card>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2">
          <Badge variant="outline">{report.summary.purchaseCount} new-period purchases</Badge>
          <Badge variant="outline">{report.summary.historicalPurchaseCount} historical purchases retained</Badge>
          <Badge variant="outline">{report.summary.disputedCount} disputed</Badge>
          <Badge variant="outline">{report.summary.refundedPurchaseCount} refunded</Badge>
        </div>
        <Button
          disabled={refreshing}
          type="button"
          variant="outline"
          onClick={() => void loadReport(true)}
        >
          {refreshing ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
          Refresh
        </Button>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        {allocationCards.map((item) => (
          <Card key={item.label}>
            <CardHeader>
              <CardDescription className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-2"><item.icon className="size-4" />{item.label}</span>
                <BadgePercent className="size-4" />
              </CardDescription>
              <CardTitle className="font-mono text-3xl">{item.rate}%</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="font-mono text-xl text-brand-cyan">{credits(item.value)}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Current Period Reconciliation</CardTitle>
          <CardDescription>
            Only the cash-backed portion consumed by paid content is allocated. Promotional Reward Credits remain access-only.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-lg border bg-background/45 p-4">
            <p className="text-sm text-muted-foreground">All Credits used</p>
            <p className="mt-1 font-mono text-xl">{credits(report.summary.contentCreditsUsed)}</p>
          </div>
          <div className="rounded-lg border bg-background/45 p-4">
            <p className="text-sm text-muted-foreground">Cash-backed Credits used</p>
            <p className="mt-1 font-mono text-xl">{credits(report.summary.purchasedCreditsUsed)}</p>
          </div>
          <div className="rounded-lg border bg-background/45 p-4">
            <p className="text-sm text-muted-foreground">Reward Credits excluded</p>
            <p className="mt-1 font-mono text-xl text-brand-cyan">{credits(report.summary.rewardCreditsExcluded)}</p>
          </div>
          <div className="rounded-lg border bg-background/45 p-4">
            <p className="text-sm text-muted-foreground">Allocated difference</p>
            <p className={reconciliationOk ? "mt-1 font-mono text-xl text-emerald-400" : "mt-1 font-mono text-xl text-destructive"}>
              {credits(report.summary.reconciliationDifference)}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              {reconciliationOk ? "Reconciled exactly" : "Requires administrator review"}
            </p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Current Tipster Balances</CardTitle>
          <CardDescription>Only entries after the new period started are included. Settled history remains available in the full ledger.</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Tipster</TableHead>
                <TableHead>Uses</TableHead>
                <TableHead>Cash-backed used</TableHead>
                <TableHead>Reward excluded</TableHead>
                <TableHead>Horse Care</TableHead>
                <TableHead>MRC</TableHead>
                <TableHead>Tipster balance</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {report.byTipster.map((item) => (
                <TableRow key={item.tipsterId}>
                  <TableCell className="font-medium">{item.tipsterName}</TableCell>
                  <TableCell>{item.purchaseCount.toLocaleString("en-ZA")}</TableCell>
                  <TableCell className="font-mono">{credits(item.purchasedCreditsUsed)}</TableCell>
                  <TableCell className="font-mono text-brand-cyan">{credits(item.rewardCreditsExcluded)}</TableCell>
                  <TableCell className="font-mono">{credits(item.horseCareCredits)}</TableCell>
                  <TableCell className="font-mono">{credits(item.platformCredits)}</TableCell>
                  <TableCell className="font-mono font-semibold">{credits(item.tipsterCredits)}</TableCell>
                </TableRow>
              ))}
              {!report.byTipster.length ? (
                <TableRow>
                  <TableCell colSpan={7} className="h-24 text-center text-muted-foreground">
                    No new-period Credit-use allocations have been recorded.
                  </TableCell>
                </TableRow>
              ) : null}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Recent New-Period Credit Usage</CardTitle>
          <CardDescription>Each row records the 10/20/70 split at the time a meeting card or subscription consumes Purchased Credits.</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Time</TableHead>
                <TableHead>Content</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Used</TableHead>
                <TableHead>Excluded</TableHead>
                <TableHead>10 / 20 / 70</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {report.recent.map((item) => (
                <TableRow key={item.purchaseId}>
                  <TableCell>{formatRaceDateTime(item.createdAt)}</TableCell>
                  <TableCell>
                    <p className="font-medium">{item.tipsterName}</p>
                    <p className="max-w-72 text-xs text-muted-foreground">{item.sourceLabel}</p>
                    <p className="mt-1 font-mono text-xs text-muted-foreground">{item.purchaseType} · {item.purchaseId.slice(0, 8)}</p>
                  </TableCell>
                  <TableCell><Badge variant={item.status === "refunded" ? "destructive" : "outline"}>{item.status}</Badge></TableCell>
                  <TableCell>
                    <p className="font-mono">{credits(item.contentCreditsUsed)}</p>
                    <p className="text-xs text-muted-foreground">{credits(item.purchasedCreditsUsed)} cash-backed</p>
                  </TableCell>
                  <TableCell className="font-mono text-brand-cyan">{credits(item.rewardCreditsExcluded)}</TableCell>
                  <TableCell>
                    <p className="font-mono text-xs">Horse Care {credits(item.horseCareCredits)}</p>
                    <p className="font-mono text-xs">MRC {credits(item.platformCredits)}</p>
                    <p className="font-mono text-xs">Tipster {credits(item.tipsterCredits)}</p>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <p className="mt-4 text-xs text-muted-foreground">Generated {formatRaceDateTime(report.generatedAt)} · {report.policy.allocationVersion}</p>
        </CardContent>
      </Card>
    </div>
  );
}
