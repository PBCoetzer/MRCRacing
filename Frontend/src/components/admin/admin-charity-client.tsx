"use client";

import { useCallback, useEffect, useState } from "react";
import { HandCoins, HeartHandshake, Loader2 } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { createClient } from "@/lib/supabase/client";

type Totals = {
  accruedCents: number;
  transferredCents: number;
  outstandingCents: number;
  lastTransferredOn: string | null;
  periodStartedAt: string;
  lifetimeAccruedCents: number;
  lifetimeTransferredCents: number;
};
type Remittance = { id: string; amount_cents: number; transferred_on: string; reference: string; notes: string | null; created_at: string };
type Contribution = { id: string; entry_type: string; amount_cents: number; created_at: string };
const money = (cents: number) => new Intl.NumberFormat("en-ZA", { style: "currency", currency: "ZAR" }).format(cents / 100);

export function AdminCharityClient() {
  const [totals, setTotals] = useState<Totals | null>(null);
  const [remittances, setRemittances] = useState<Remittance[]>([]);
  const [contributions, setContributions] = useState<Contribution[]>([]);
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState("");
  const [reference, setReference] = useState("");
  const [notes, setNotes] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const load = useCallback(async () => {
    const supabase = createClient(); if (!supabase) return;
    setLoading(true); setError("");
    const [totalResult, remittanceResult, contributionResult] = await Promise.all([
      supabase.rpc("get_charity_transparency"),
      supabase.from("charity_remittances").select("id,amount_cents,transferred_on,reference,notes,created_at").order("transferred_on", { ascending: false }),
      supabase.from("charity_contribution_entries").select("id,entry_type,amount_cents,created_at").order("created_at", { ascending: false }).limit(100),
    ]);
    const firstError = totalResult.error ?? remittanceResult.error ?? contributionResult.error;
    if (firstError) setError(firstError.message);
    setTotals(totalResult.data as Totals);
    setRemittances((remittanceResult.data ?? []) as Remittance[]);
    setContributions((contributionResult.data ?? []) as Contribution[]);
    setLoading(false);
  }, []);
  useEffect(() => {
    const timeoutId = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timeoutId);
  }, [load]);

  async function recordTransfer() {
    const supabase = createClient(); if (!supabase) return;
    const cents = Math.round(Number(amount.replace(",", ".")) * 100);
    setBusy(true); setError(""); setMessage("");
    const { error: recordError } = await supabase.rpc("admin_record_charity_remittance", { p_amount_cents: cents, p_transferred_on: date, p_reference: reference, p_notes: notes || null, p_proof_path: null });
    if (recordError) setError(recordError.message); else { setMessage("ECHCU transfer recorded in the immutable audit trail."); setAmount(""); setReference(""); setNotes(""); await load(); }
    setBusy(false);
  }

  if (loading) return <Card><CardContent className="flex min-h-52 items-center justify-center gap-2"><Loader2 className="size-5 animate-spin" />Loading contribution ledger…</CardContent></Card>;
  return <div className="space-y-6">{error ? <Alert variant="destructive"><AlertTitle>Contribution ledger failed</AlertTitle><AlertDescription>{error}</AlertDescription></Alert> : null}{message ? <Alert><AlertTitle>Transfer recorded</AlertTitle><AlertDescription>{message}</AlertDescription></Alert> : null}
    <Card><CardHeader><CardTitle>Current 10/20/70 Period</CardTitle><CardDescription>Balances start from the new policy activation. Earlier contributions and transfers remain visible as settled history.</CardDescription></CardHeader><CardContent className="text-sm text-muted-foreground">Started {totals?.periodStartedAt ? new Date(totals.periodStartedAt).toLocaleString("en-ZA") : "when the policy migration is applied"}.</CardContent></Card>
    <div className="grid gap-4 md:grid-cols-3">{[{ label: "Current Period Accrued", value: totals?.accruedCents ?? 0 }, { label: "Current Period Transferred", value: totals?.transferredCents ?? 0 }, { label: "Current Period Outstanding", value: totals?.outstandingCents ?? 0 }].map((item) => <Card key={item.label}><CardHeader><CardDescription>{item.label}</CardDescription><CardTitle className="font-mono text-2xl">{money(item.value)}</CardTitle></CardHeader></Card>)}</div>
    <div className="grid gap-4 md:grid-cols-2"><Card><CardHeader><CardDescription>Historical Accrued</CardDescription><CardTitle className="font-mono text-xl">{money(totals?.lifetimeAccruedCents ?? 0)}</CardTitle></CardHeader></Card><Card><CardHeader><CardDescription>Historical Transfers</CardDescription><CardTitle className="font-mono text-xl">{money(totals?.lifetimeTransferredCents ?? 0)}</CardTitle></CardHeader></Card></div>
    <Card><CardHeader><CardTitle className="flex items-center gap-2"><HandCoins className="size-5 text-brand-gold" />Record ECHCU remittance</CardTitle><CardDescription>This records a completed transfer only; it does not move money. The amount cannot exceed the outstanding ledger balance.</CardDescription></CardHeader><CardContent className="grid gap-4 sm:grid-cols-2"><div><Label htmlFor="remit-amount">Amount (ZAR)</Label><Input id="remit-amount" inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="0.00" /></div><div><Label htmlFor="remit-date">Transfer date</Label><Input id="remit-date" type="date" value={date} onChange={(event) => setDate(event.target.value)} /></div><div className="sm:col-span-2"><Label htmlFor="remit-reference">Bank/reference number</Label><Input id="remit-reference" value={reference} onChange={(event) => setReference(event.target.value)} /></div><div className="sm:col-span-2"><Label htmlFor="remit-notes">Internal notes</Label><Textarea id="remit-notes" value={notes} onChange={(event) => setNotes(event.target.value)} /></div><div className="sm:col-span-2"><Button disabled={busy || !amount || !date || reference.trim().length < 3} onClick={recordTransfer}>{busy ? <Loader2 className="size-4 animate-spin" /> : <HeartHandshake className="size-4" />}Record transfer</Button></div></CardContent></Card>
    <Card><CardHeader><CardTitle>Recorded transfers</CardTitle></CardHeader><CardContent><Table><TableHeader><TableRow><TableHead>Date</TableHead><TableHead>Reference</TableHead><TableHead>Amount</TableHead><TableHead>Notes</TableHead></TableRow></TableHeader><TableBody>{remittances.map((item) => <TableRow key={item.id}><TableCell>{item.transferred_on}</TableCell><TableCell>{item.reference}</TableCell><TableCell>{money(item.amount_cents)}</TableCell><TableCell>{item.notes ?? "—"}</TableCell></TableRow>)}</TableBody></Table>{!remittances.length ? <p className="py-5 text-sm text-muted-foreground">No transfers recorded yet.</p> : null}</CardContent></Card>
    <Card><CardHeader><CardTitle>Recent contribution entries</CardTitle><CardDescription>Accrual and reversal entries are immutable. Customer and purchase identities are intentionally not shown here.</CardDescription></CardHeader><CardContent className="space-y-2">{contributions.map((item) => <div key={item.id} className="flex items-center justify-between rounded-lg border p-3 text-sm"><span>{item.entry_type} · {new Date(item.created_at).toLocaleString("en-ZA")}</span><span className={item.amount_cents < 0 ? "text-destructive" : "text-brand-cyan"}>{money(item.amount_cents)}</span></div>)}</CardContent></Card>
  </div>;
}
