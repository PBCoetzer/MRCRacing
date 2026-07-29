"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Clock3,
  Loader2,
} from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { createClient } from "@/lib/supabase/client";

type PaymentRow = {
  id: string;
  provider: string;
  credits: number;
  status: string;
  paid_at: string | null;
};

export function PaymentStatusClient() {
  const [payment, setPayment] = useState<PaymentRow | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let isActive = true;
    let attempt = 0;

    async function loadPayment() {
      const paymentId = new URLSearchParams(window.location.search).get("payment");
      const supabase = createClient();

      if (!paymentId || !supabase) {
        setError("This payment status link is incomplete.");
        setLoading(false);
        return;
      }

      attempt += 1;
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        const next = `/payment-status/?payment=${paymentId}`;
        window.location.replace(`/login/?next=${encodeURIComponent(next)}`);
        return;
      }

      const { data, error: paymentError } = await supabase
        .from("payments")
        .select("id,provider,credits,status,paid_at")
        .eq("id", paymentId)
        .maybeSingle();

      if (!isActive) {
        return;
      }

      if (paymentError || !data) {
        setError(paymentError?.message ?? "Payment could not be found.");
        setLoading(false);
        return;
      }

      const paymentRow = data as PaymentRow;
      setPayment(paymentRow);
      setLoading(false);

      if (paymentRow.status === "pending" && attempt < 15) {
        window.setTimeout(() => void loadPayment(), 2000);
      }
    }

    const timeoutId = window.setTimeout(() => {
      void loadPayment();
    }, 0);

    return () => {
      isActive = false;
      window.clearTimeout(timeoutId);
    };
  }, []);

  const isPaid = payment?.status === "paid";
  const isPending = payment?.status === "pending";

  return (
    <Card className="w-full">
      <CardHeader>
        <CardTitle>Credit payment status</CardTitle>
        <CardDescription>
          Provider return pages never issue Credits. MRC waits for the verified payment
          notification.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {loading ? (
          <div className="flex items-center gap-2 text-muted-foreground">
            <Loader2 className="size-5 animate-spin text-primary" />
            Checking the secure payment record…
          </div>
        ) : error ? (
          <Alert variant="destructive">
            <AlertTriangle className="size-4" />
            <AlertTitle>Payment status unavailable</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : isPaid ? (
          <Alert>
            <CheckCircle2 className="size-4" />
            <AlertTitle>Credits added</AlertTitle>
            <AlertDescription>
              {payment?.credits.toLocaleString("en-ZA")} Credits were issued exactly once
              after {payment?.provider} confirmed the payment.
            </AlertDescription>
          </Alert>
        ) : isPending ? (
          <Alert>
            <Clock3 className="size-4" />
            <AlertTitle>Waiting for provider confirmation</AlertTitle>
            <AlertDescription>
              The payment remains pending. Do not retry while your bank or payment
              provider is still processing it.
            </AlertDescription>
          </Alert>
        ) : (
          <Alert variant="destructive">
            <AlertTriangle className="size-4" />
            <AlertTitle>Payment not completed</AlertTitle>
            <AlertDescription>
              Current status: {payment?.status ?? "unknown"}. No Credits were issued.
            </AlertDescription>
          </Alert>
        )}
        <div className="flex flex-wrap gap-3">
          <Button asChild>
            <Link href="/client/">Open client dashboard</Link>
          </Button>
          <Button asChild variant="outline">
            <Link href="/pricing/">Return to Credits</Link>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
