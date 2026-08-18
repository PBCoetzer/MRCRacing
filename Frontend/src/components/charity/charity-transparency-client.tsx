"use client";

import { useEffect, useState } from "react";
import { HandCoins, HeartHandshake, Loader2, ReceiptText } from "lucide-react";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { createClient } from "@/lib/supabase/client";

type Totals = {
  accruedCents: number;
  transferredCents: number;
  outstandingCents: number;
  lastTransferredOn: string | null;
};

function zar(cents: number) {
  return new Intl.NumberFormat("en-ZA", { style: "currency", currency: "ZAR" }).format(cents / 100);
}

export function CharityTransparencyClient() {
  const [totals, setTotals] = useState<Totals | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      const supabase = createClient();
      if (!supabase) { setError("Live contribution totals are temporarily unavailable."); return; }
      void (async () => {
        const result = await supabase.rpc("get_charity_transparency");
        if (result.error) setError(result.error.message);
        else setTotals(result.data as Totals);
      })();
    }, 0);
    return () => window.clearTimeout(timeoutId);
  }, []);

  if (!totals && !error) return <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" />Loading the contribution ledger…</div>;
  if (error) return <p className="text-sm text-muted-foreground">{error}</p>;

  const items = [
    { label: "Accrued for ECHCU", value: zar(totals?.accruedCents ?? 0), icon: HeartHandshake },
    { label: "Transferred", value: zar(totals?.transferredCents ?? 0), icon: HandCoins },
    { label: "Awaiting transfer", value: zar(totals?.outstandingCents ?? 0), icon: ReceiptText },
  ];
  return <div className="grid gap-4 md:grid-cols-3">{items.map((item) => <Card key={item.label} className="border-brand-gold/30 bg-brand-purple-deep/80"><CardHeader><CardDescription>{item.label}</CardDescription><CardTitle className="flex items-center gap-2 font-mono text-2xl text-white"><item.icon className="size-5 text-brand-gold" />{item.value}</CardTitle></CardHeader></Card>)}<p className="md:col-span-3 text-xs text-muted-foreground">Last recorded transfer: {totals?.lastTransferredOn ? new Intl.DateTimeFormat("en-ZA", { dateStyle: "long", timeZone: "Africa/Johannesburg" }).format(new Date(`${totals.lastTransferredOn}T12:00:00+02:00`)) : "No transfer recorded yet"}.</p></div>;
}
