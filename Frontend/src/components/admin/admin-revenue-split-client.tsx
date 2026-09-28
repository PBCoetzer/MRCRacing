"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  BadgePercent,
  CheckCircle2,
  CircleDollarSign,
  Download,
  HandCoins,
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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

type TipsterPayoutBalance = {
  tipsterId: string;
  tipsterName: string;
  entryCount: number;
  totalEarnedCredits: number;
  availableCredits: number;
  requestedCredits: number;
  paidAwaitingConfirmationCredits: number;
  receivedCredits: number;
};

type TipsterPayoutRequest = {
  requestId: string;
  tipsterId: string;
  tipsterName: string;
  status: "requested" | "paid" | "received";
  amountCredits: number;
  earningRowCount: number;
  requestedThrough: string;
  requestedAt: string;
  paidAt: string | null;
  paymentReference: string | null;
  adminNote: string | null;
  receivedAt: string | null;
};

type TipsterPayoutDashboard = {
  byTipster: TipsterPayoutBalance[];
  requests: TipsterPayoutRequest[];
  generatedAt: string;
};

type CurrentRevenueTransaction = {
  ledgerId: string;
  createdAt: string;
  entryType: string;
  purchaseId: string;
  purchaseType: string;
  purchaseStatus: string;
  tipsterId: string;
  tipsterName: string;
  sourceLabel: string;
  contentCredits: number;
  purchasedCredits: number;
  rewardCreditsExcluded: number;
  horseCareCredits: number;
  platformCredits: number;
  tipsterCredits: number;
  payoutRequestId: string | null;
  payoutStatus: string;
  allocationVersion: string;
};

type CurrentRevenueLedger = {
  policy: RevenuePolicy;
  filters: {
    from: string;
    toExclusive: string;
    tipsterId: string | null;
    limit: number;
  };
  summary: {
    transactionCount: number;
    purchaseCount: number;
    contentCredits: number;
    purchasedCredits: number;
    rewardCreditsExcluded: number;
    horseCareCredits: number;
    platformCredits: number;
    tipsterCredits: number;
    reconciliationDifference: number;
  };
  transactions: CurrentRevenueTransaction[];
  generatedAt: string;
};

type PayoutDraft = {
  reference: string;
  note: string;
};

function credits(value: number) {
  return `${Number(value).toLocaleString("en-ZA", { maximumFractionDigits: 2 })} Credits`;
}

function csvValue(value: string | number | null | undefined) {
  const normalized = value == null ? "" : String(value);
  return `"${normalized.replaceAll('"', '""')}"`;
}

function nextDayIso(date: string) {
  const value = new Date(`${date}T00:00:00+02:00`);
  value.setDate(value.getDate() + 1);
  return value.toISOString();
}

export function AdminRevenueSplitClient() {
  const [report, setReport] = useState<RevenueReport | null>(null);
  const [payoutDashboard, setPayoutDashboard] = useState<TipsterPayoutDashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [payingRequestId, setPayingRequestId] = useState<string | null>(null);
  const [exportFrom, setExportFrom] = useState("");
  const [exportTo, setExportTo] = useState("");
  const [exportTipsterId, setExportTipsterId] = useState("");
  const [payoutDrafts, setPayoutDrafts] = useState<Record<string, PayoutDraft>>({});
  const [message, setMessage] = useState("");
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

    const [reportResult, payoutResult] = await Promise.all([
      supabase.rpc("admin_get_revenue_split_report", { p_limit: 100 }),
      supabase.rpc("admin_get_tipster_payout_dashboard", { p_limit: 100 }),
    ]);

    const loadError = reportResult.error ?? payoutResult.error;
    if (loadError) {
      setError(loadError.message);
    } else {
      setReport(reportResult.data as RevenueReport);
      setPayoutDashboard(payoutResult.data as TipsterPayoutDashboard);
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

  const payoutTotals = useMemo(() => {
    const rows = payoutDashboard?.byTipster ?? [];
    return rows.reduce(
      (total, row) => ({
        available: total.available + Number(row.availableCredits),
        requested: total.requested + Number(row.requestedCredits),
        paid: total.paid + Number(row.paidAwaitingConfirmationCredits),
        received: total.received + Number(row.receivedCredits),
      }),
      { available: 0, requested: 0, paid: 0, received: 0 },
    );
  }, [payoutDashboard]);

  const updatePayoutDraft = useCallback((requestId: string, field: keyof PayoutDraft, value: string) => {
    setPayoutDrafts((current) => ({
      ...current,
      [requestId]: {
        reference: current[requestId]?.reference ?? "",
        note: current[requestId]?.note ?? "",
        [field]: value,
      },
    }));
  }, []);

  const markPayoutPaid = useCallback(async (requestId: string) => {
    const supabase = createClient();
    const draft = payoutDrafts[requestId] ?? { reference: "", note: "" };

    if (!supabase) {
      setError("Supabase is not configured.");
      return;
    }

    if (!draft.reference.trim()) {
      setError("Enter a payment reference before marking the payout paid.");
      return;
    }

    setPayingRequestId(requestId);
    setError("");
    setMessage("");
    const { error: paymentError } = await supabase.rpc("admin_mark_tipster_payout_paid", {
      p_request_id: requestId,
      p_payment_reference: draft.reference.trim(),
      p_admin_note: draft.note.trim() || null,
    });

    if (paymentError) {
      setError(paymentError.message);
    } else {
      setMessage("Payout marked paid. The Tipster must now confirm receipt.");
      await loadReport(true);
    }
    setPayingRequestId(null);
  }, [loadReport, payoutDrafts]);

  const exportLedger = useCallback(async () => {
    const supabase = createClient();

    if (!supabase) {
      setError("Supabase is not configured.");
      return;
    }

    if (exportFrom && exportTo && exportTo < exportFrom) {
      setError("The report end date cannot be before the start date.");
      return;
    }

    setExporting(true);
    setError("");
    setMessage("");
    const { data, error: exportError } = await supabase.rpc("admin_get_current_revenue_ledger", {
      p_from: exportFrom ? new Date(`${exportFrom}T00:00:00+02:00`).toISOString() : null,
      p_to: exportTo ? nextDayIso(exportTo) : null,
      p_tipster_id: exportTipsterId || null,
      p_limit: 10000,
    });

    if (exportError) {
      setError(exportError.message);
      setExporting(false);
      return;
    }

    const ledger = data as CurrentRevenueLedger;
    const metadata = [
      ["MRC Racing 10/20/70 Revenue Ledger"],
      ["Allocation version", ledger.policy.allocationVersion],
      ["Effective from", ledger.policy.effectiveAt],
      ["Report from", ledger.filters.from],
      ["Report to (exclusive)", ledger.filters.toExclusive],
      ["Transactions", ledger.summary.transactionCount],
      ["Purchased Credits", ledger.summary.purchasedCredits],
      ["Reward Credits excluded", ledger.summary.rewardCreditsExcluded],
      ["Horse Care Credits", ledger.summary.horseCareCredits],
      ["Platform Credits", ledger.summary.platformCredits],
      ["Tipster Credits", ledger.summary.tipsterCredits],
      ["Reconciliation difference", ledger.summary.reconciliationDifference],
      [],
    ];
    const header = [
      "Date/time",
      "Ledger ID",
      "Purchase ID",
      "Entry",
      "Purchase type",
      "Purchase status",
      "Tipster",
      "Content",
      "All Credits used",
      "Purchased Credits",
      "Reward Credits excluded",
      "Horse Care 10%",
      "Platform 20%",
      "Tipster 70%",
      "Payout status",
      "Payout request ID",
    ];
    const csv = [
      ...metadata.map((row) => row.map(csvValue).join(",")),
      header.map(csvValue).join(","),
      ...ledger.transactions.map((row) => [
        row.createdAt,
        row.ledgerId,
        row.purchaseId,
        row.entryType,
        row.purchaseType,
        row.purchaseStatus,
        row.tipsterName,
        row.sourceLabel,
        row.contentCredits,
        row.purchasedCredits,
        row.rewardCreditsExcluded,
        row.horseCareCredits,
        row.platformCredits,
        row.tipsterCredits,
        row.payoutStatus,
        row.payoutRequestId,
      ].map(csvValue).join(",")),
    ].join("\r\n");
    const blob = new Blob(["\uFEFF", csv], { type: "text/csv;charset=utf-8" });
    const downloadUrl = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = downloadUrl;
    anchor.download = `mrc-10-20-70-ledger-${exportFrom || "period-start"}-to-${exportTo || "today"}.csv`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(downloadUrl);
    setMessage(`Exported ${ledger.summary.transactionCount.toLocaleString("en-ZA")} current-period ledger entries.`);
    setExporting(false);
  }, [exportFrom, exportTipsterId, exportTo]);

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

  if (!report || !payoutDashboard) {
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
      {message ? (
        <Alert>
          <CheckCircle2 className="size-4" />
          <AlertTitle>Revenue workspace updated</AlertTitle>
          <AlertDescription>{message}</AlertDescription>
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
          <div className="space-y-3 md:hidden">
            {report.byTipster.map((item) => (
              <article key={item.tipsterId} className="rounded-lg border bg-background/35 p-4">
                <div className="flex items-center justify-between gap-3">
                  <p className="font-semibold text-white">{item.tipsterName}</p>
                  <Badge variant="outline">{item.purchaseCount.toLocaleString("en-ZA")} uses</Badge>
                </div>
                <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
                  <div><dt className="text-muted-foreground">Cash-backed</dt><dd className="font-mono">{credits(item.purchasedCreditsUsed)}</dd></div>
                  <div><dt className="text-muted-foreground">Reward excluded</dt><dd className="font-mono text-brand-cyan">{credits(item.rewardCreditsExcluded)}</dd></div>
                  <div><dt className="text-muted-foreground">Horse Care</dt><dd className="font-mono">{credits(item.horseCareCredits)}</dd></div>
                  <div><dt className="text-muted-foreground">MRC</dt><dd className="font-mono">{credits(item.platformCredits)}</dd></div>
                  <div className="col-span-2"><dt className="text-muted-foreground">Tipster balance</dt><dd className="font-mono font-semibold">{credits(item.tipsterCredits)}</dd></div>
                </dl>
              </article>
            ))}
            {!report.byTipster.length ? (
              <p className="rounded-lg border bg-background/35 p-4 text-sm text-muted-foreground">No new-period Credit-use allocations have been recorded.</p>
            ) : null}
          </div>
          <div className="hidden overflow-x-auto md:block">
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
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Download className="size-5 text-brand-cyan" />
            Download 10/20/70 Transaction Report
          </CardTitle>
          <CardDescription>
            Export only the forward revenue period. The settled legacy ledger is deliberately excluded so old and new accounting can never be mixed.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 md:grid-cols-3">
            <div className="space-y-2">
              <Label htmlFor="revenue-export-from">From date</Label>
              <Input
                id="revenue-export-from"
                type="date"
                value={exportFrom}
                onChange={(event) => setExportFrom(event.target.value)}
              />
              <p className="text-xs text-muted-foreground">Blank starts at the 10/20/70 effective timestamp.</p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="revenue-export-to">Through date</Label>
              <Input
                id="revenue-export-to"
                type="date"
                value={exportTo}
                onChange={(event) => setExportTo(event.target.value)}
              />
              <p className="text-xs text-muted-foreground">Blank includes all current entries.</p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="revenue-export-tipster">Tipster</Label>
              <select
                id="revenue-export-tipster"
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                value={exportTipsterId}
                onChange={(event) => setExportTipsterId(event.target.value)}
              >
                <option value="">All Tipsters</option>
                {payoutDashboard.byTipster.map((tipsterBalance) => (
                  <option key={tipsterBalance.tipsterId} value={tipsterBalance.tipsterId}>
                    {tipsterBalance.tipsterName}
                  </option>
                ))}
              </select>
              <p className="text-xs text-muted-foreground">Use this for an individual Tipster statement.</p>
            </div>
          </div>
          <Button type="button" disabled={exporting} onClick={() => void exportLedger()}>
            {exporting ? <Loader2 className="size-4 animate-spin" /> : <Download className="size-4" />}
            Download CSV
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <HandCoins className="size-5 text-brand-cyan" />
            Tipster Payout Control
          </CardTitle>
          <CardDescription>
            Payouts assign immutable new-period earning rows. New earnings continue accumulating separately while an earlier request awaits payment or receipt confirmation.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {[
              ["Available to request", payoutTotals.available],
              ["Requested", payoutTotals.requested],
              ["Paid, awaiting confirmation", payoutTotals.paid],
              ["Confirmed received", payoutTotals.received],
            ].map(([label, value]) => (
              <div key={String(label)} className="rounded-lg border bg-background/45 p-4">
                <p className="text-sm text-muted-foreground">{label}</p>
                <p className="mt-1 font-mono text-xl">{credits(Number(value))}</p>
              </div>
            ))}
          </div>

          <div className="space-y-3 md:hidden">
            {payoutDashboard.byTipster.map((item) => (
              <article key={item.tipsterId} className="rounded-lg border bg-background/35 p-4">
                <div className="flex items-center justify-between gap-3">
                  <p className="font-semibold text-white">{item.tipsterName}</p>
                  <Badge variant="outline">{item.entryCount.toLocaleString("en-ZA")} entries</Badge>
                </div>
                <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
                  <div><dt className="text-muted-foreground">Total earned</dt><dd className="font-mono">{credits(item.totalEarnedCredits)}</dd></div>
                  <div><dt className="text-muted-foreground">Available</dt><dd className="font-mono text-brand-cyan">{credits(item.availableCredits)}</dd></div>
                  <div><dt className="text-muted-foreground">Requested</dt><dd className="font-mono">{credits(item.requestedCredits)}</dd></div>
                  <div><dt className="text-muted-foreground">Paid, unconfirmed</dt><dd className="font-mono">{credits(item.paidAwaitingConfirmationCredits)}</dd></div>
                  <div className="col-span-2"><dt className="text-muted-foreground">Received</dt><dd className="font-mono">{credits(item.receivedCredits)}</dd></div>
                </dl>
              </article>
            ))}
          </div>
          <div className="hidden overflow-x-auto rounded-lg border md:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Tipster</TableHead>
                  <TableHead>Entries</TableHead>
                  <TableHead>Total earned</TableHead>
                  <TableHead>Available</TableHead>
                  <TableHead>Requested</TableHead>
                  <TableHead>Paid, unconfirmed</TableHead>
                  <TableHead>Received</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {payoutDashboard.byTipster.map((item) => (
                  <TableRow key={item.tipsterId}>
                    <TableCell className="font-medium">{item.tipsterName}</TableCell>
                    <TableCell>{item.entryCount.toLocaleString("en-ZA")}</TableCell>
                    <TableCell className="font-mono">{credits(item.totalEarnedCredits)}</TableCell>
                    <TableCell className="font-mono text-brand-cyan">{credits(item.availableCredits)}</TableCell>
                    <TableCell className="font-mono">{credits(item.requestedCredits)}</TableCell>
                    <TableCell className="font-mono">{credits(item.paidAwaitingConfirmationCredits)}</TableCell>
                    <TableCell className="font-mono">{credits(item.receivedCredits)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          <div className="space-y-3">
            <div>
              <h3 className="font-heading text-lg">Payout Requests</h3>
              <p className="text-sm text-muted-foreground">Enter the bank or payment reference before marking a request paid.</p>
            </div>
            {payoutDashboard.requests.map((request) => {
              const draft = payoutDrafts[request.requestId] ?? { reference: "", note: "" };
              return (
                <article key={request.requestId} className="rounded-lg border bg-background/35 p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="font-semibold text-white">{request.tipsterName}</p>
                      <p className="mt-1 font-mono text-xl">{credits(request.amountCredits)}</p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        Requested {formatRaceDateTime(request.requestedAt)} · {request.earningRowCount} ledger entries · through {formatRaceDateTime(request.requestedThrough)}
                      </p>
                    </div>
                    <Badge variant={request.status === "requested" ? "default" : "outline"}>{request.status}</Badge>
                  </div>

                  {request.status === "requested" ? (
                    <div className="mt-4 grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)_auto] lg:items-end">
                      <div className="space-y-2">
                        <Label htmlFor={`reference-${request.requestId}`}>Payment reference</Label>
                        <Input
                          id={`reference-${request.requestId}`}
                          maxLength={160}
                          placeholder="Bank or transfer reference"
                          value={draft.reference}
                          onChange={(event) => updatePayoutDraft(request.requestId, "reference", event.target.value)}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor={`note-${request.requestId}`}>Administrator note (optional)</Label>
                        <Input
                          id={`note-${request.requestId}`}
                          maxLength={500}
                          placeholder="Payment method or supporting note"
                          value={draft.note}
                          onChange={(event) => updatePayoutDraft(request.requestId, "note", event.target.value)}
                        />
                      </div>
                      <Button
                        type="button"
                        disabled={payingRequestId === request.requestId}
                        onClick={() => void markPayoutPaid(request.requestId)}
                      >
                        {payingRequestId === request.requestId ? <Loader2 className="size-4 animate-spin" /> : <CheckCircle2 className="size-4" />}
                        Mark Paid
                      </Button>
                    </div>
                  ) : (
                    <div className="mt-4 grid gap-2 text-sm sm:grid-cols-2">
                      <p><span className="text-muted-foreground">Reference:</span> {request.paymentReference ?? "Not recorded"}</p>
                      <p><span className="text-muted-foreground">Paid:</span> {request.paidAt ? formatRaceDateTime(request.paidAt) : "Awaiting payment"}</p>
                      {request.adminNote ? <p className="sm:col-span-2"><span className="text-muted-foreground">Note:</span> {request.adminNote}</p> : null}
                      {request.receivedAt ? <p className="sm:col-span-2 text-emerald-400">Receipt confirmed {formatRaceDateTime(request.receivedAt)}</p> : null}
                    </div>
                  )}
                </article>
              );
            })}
            {!payoutDashboard.requests.length ? (
              <p className="rounded-lg border bg-background/35 p-4 text-sm text-muted-foreground">No Tipster payout requests have been submitted in the new period.</p>
            ) : null}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Recent New-Period Credit Usage</CardTitle>
          <CardDescription>Each row records the 10/20/70 split at the time a meeting card or subscription consumes Purchased Credits.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-3 md:hidden">
            {report.recent.map((item) => (
              <article key={item.purchaseId} className="rounded-lg border bg-background/35 p-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="font-semibold text-white">{item.tipsterName}</p>
                    <p className="text-sm">{item.sourceLabel}</p>
                    <p className="mt-1 text-xs text-muted-foreground">{formatRaceDateTime(item.createdAt)} · {item.purchaseType} · {item.purchaseId.slice(0, 8)}</p>
                  </div>
                  <Badge variant={item.status === "refunded" ? "destructive" : "outline"}>{item.status}</Badge>
                </div>
                <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
                  <div><dt className="text-muted-foreground">All Credits used</dt><dd className="font-mono">{credits(item.contentCreditsUsed)}</dd></div>
                  <div><dt className="text-muted-foreground">Cash-backed</dt><dd className="font-mono">{credits(item.purchasedCreditsUsed)}</dd></div>
                  <div><dt className="text-muted-foreground">Reward excluded</dt><dd className="font-mono text-brand-cyan">{credits(item.rewardCreditsExcluded)}</dd></div>
                  <div><dt className="text-muted-foreground">Horse Care 10%</dt><dd className="font-mono">{credits(item.horseCareCredits)}</dd></div>
                  <div><dt className="text-muted-foreground">MRC 20%</dt><dd className="font-mono">{credits(item.platformCredits)}</dd></div>
                  <div><dt className="text-muted-foreground">Tipster 70%</dt><dd className="font-mono font-semibold">{credits(item.tipsterCredits)}</dd></div>
                </dl>
              </article>
            ))}
          </div>
          <div className="hidden overflow-x-auto md:block">
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
          </div>
          <p className="mt-4 text-xs text-muted-foreground">Generated {formatRaceDateTime(report.generatedAt)} · {report.policy.allocationVersion}</p>
        </CardContent>
      </Card>
    </div>
  );
}
