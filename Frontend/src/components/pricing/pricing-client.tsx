"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  BadgeCheck,
  Banknote,
  Building2,
  CheckCircle2,
  CreditCard,
  Loader2,
  LockKeyhole,
  Store,
  Ticket,
  WalletCards,
} from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { CreditPackage } from "@/lib/racing/types";
import { createClient } from "@/lib/supabase/client";

type Provider = "payfast" | "ozow";

type CheckoutResponse = {
  actionUrl: string;
  fields: Record<string, string>;
  paymentId: string;
};

const paymentsEnabled =
  process.env.NEXT_PUBLIC_PAYMENTS_ENABLED?.toLowerCase() === "true";

function formatRand(cents: number) {
  return new Intl.NumberFormat("en-ZA", {
    style: "currency",
    currency: "ZAR",
    maximumFractionDigits: 0,
  }).format(cents / 100);
}

function submitProviderForm(actionUrl: string, fields: Record<string, string>) {
  const form = document.createElement("form");
  form.method = "POST";
  form.action = actionUrl;
  form.style.display = "none";

  for (const [name, value] of Object.entries(fields)) {
    const input = document.createElement("input");
    input.type = "hidden";
    input.name = name;
    input.value = value;
    form.appendChild(input);
  }

  document.body.appendChild(form);
  form.submit();
}

export function PricingClient() {
  const router = useRouter();
  const [packages, setPackages] = useState<CreditPackage[]>([]);
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    let isActive = true;

    async function loadPackages() {
      const supabase = createClient();

      if (!supabase) {
        setLoading(false);
        setError("The Credit package database is not configured for this build.");
        return;
      }

      const { data, error: packageError } = await supabase
        .from("credit_packages")
        .select("id,name,credits,price_cents,is_active,sort_order")
        .eq("is_active", true)
        .order("sort_order");

      if (!isActive) {
        return;
      }

      setPackages((data ?? []) as CreditPackage[]);
      setError(packageError?.message ?? "");
      setLoading(false);
    }

    const timeoutId = window.setTimeout(() => {
      void loadPackages();
    }, 0);

    return () => {
      isActive = false;
      window.clearTimeout(timeoutId);
    };
  }, []);

  async function startCheckout(
    creditPackage: CreditPackage,
    provider: Provider,
  ) {
    const supabase = createClient();

    if (!supabase) {
      setError("The secure checkout service is not configured.");
      return;
    }

    if (!paymentsEnabled) {
      setError(
        "Online Credit purchases are not live yet. PayFast and Ozow will be enabled after the merchant credentials are approved.",
      );
      return;
    }

    setError("");
    setProcessing(`${creditPackage.id}:${provider}`);

    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        const next = `/pricing/?package=${creditPackage.id}&provider=${provider}`;
        router.push(`/login/?next=${encodeURIComponent(next)}`);
        return;
      }

      const { data, error: checkoutError } = await supabase.functions.invoke(
        "create-credit-checkout",
        {
          body: {
            packageId: creditPackage.id,
            provider,
          },
          headers: {
            "x-idempotency-key": crypto.randomUUID(),
          },
        },
      );

      if (checkoutError) {
        throw checkoutError;
      }

      const checkout = data as CheckoutResponse;

      if (!checkout.actionUrl || !checkout.fields) {
        throw new Error("The payment provider did not return a checkout form.");
      }

      submitProviderForm(checkout.actionUrl, checkout.fields);
    } catch (checkoutError) {
      setError(
        checkoutError instanceof Error
          ? checkoutError.message
          : "Checkout could not be started.",
      );
      setProcessing("");
    }
  }

  return (
    <main>
      <section className="border-b border-brand-gold/20 bg-brand-purple-deep text-white">
        <div className="mx-auto grid w-full max-w-7xl gap-8 px-4 py-14 sm:px-6 lg:grid-cols-[1fr_0.7fr] lg:px-8">
          <div>
            <Badge className="bg-brand-gold text-brand-purple-deep">
              R1 = 1 Credit
            </Badge>
            <h1 className="mt-5 font-heading text-4xl sm:text-5xl">
              Buy Credits. Choose your own tipsters.
            </h1>
            <p className="mt-5 max-w-3xl text-lg leading-8 text-white/74">
              MRC sells Credits only. Each verified tipster sets the Credit price for
              their complete meeting cards and their own 1, 3, 6, or 12-month
              subscriptions.
            </p>
          </div>
          <Card className="border-brand-cyan/30 bg-white/8 text-white">
            <CardHeader>
              <CardTitle>What Credits unlock</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm text-white/74">
              <p className="flex gap-2">
                <BadgeCheck className="mt-0.5 size-4 shrink-0 text-brand-cyan" />
                Full venue/date meeting cards with every published race selection.
              </p>
              <p className="flex gap-2">
                <BadgeCheck className="mt-0.5 size-4 shrink-0 text-brand-cyan" />
                Tipster-specific subscriptions that never auto-renew.
              </p>
              <p className="flex gap-2">
                <LockKeyhole className="mt-0.5 size-4 shrink-0 text-brand-gold" />
                Digital racing analysis only; Credits cannot place bets or be withdrawn.
              </p>
            </CardContent>
          </Card>
        </div>
      </section>

      <section className="mx-auto w-full max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
        {!paymentsEnabled ? (
          <Alert className="mb-8 border-brand-gold/45 bg-brand-gold/8">
            <AlertTriangle className="size-4" />
            <AlertTitle>Secure payment setup in progress</AlertTitle>
            <AlertDescription>
              PayFast and Ozow checkout infrastructure is installed, but live purchases
              remain disabled until the merchant accounts and signing credentials are
              configured. No payment can be charged from this page yet.
            </AlertDescription>
          </Alert>
        ) : null}
        {error ? (
          <Alert variant="destructive" className="mb-8">
            <AlertTriangle className="size-4" />
            <AlertTitle>Checkout unavailable</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}

        <div className="mb-7">
          <h2 className="font-heading text-3xl text-white">Credit packages</h2>
          <p className="mt-2 text-muted-foreground">
            Every package keeps the same transparent one-to-one value.
          </p>
        </div>

        {loading ? (
          <Card>
            <CardContent className="flex min-h-44 items-center justify-center gap-2">
              <Loader2 className="size-5 animate-spin text-primary" />
              Loading Credit packages…
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
            {packages.map((creditPackage) => (
              <Card key={creditPackage.id} className="flex flex-col">
                <CardHeader>
                  <CardDescription>Credit package</CardDescription>
                  <CardTitle className="font-heading text-2xl">
                    {creditPackage.credits.toLocaleString("en-ZA")} Credits
                  </CardTitle>
                </CardHeader>
                <CardContent className="flex flex-1 flex-col">
                  <p className="font-mono text-3xl font-bold">
                    {formatRand(creditPackage.price_cents)}
                  </p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    R1 per Credit
                  </p>
                  <div className="mt-auto grid gap-2 pt-6">
                    <Button
                      type="button"
                      disabled={
                        !paymentsEnabled ||
                        processing === `${creditPackage.id}:payfast`
                      }
                      onClick={() => void startCheckout(creditPackage, "payfast")}
                    >
                      {processing === `${creditPackage.id}:payfast` ? (
                        <Loader2 className="size-4 animate-spin" />
                      ) : (
                        <CreditCard className="size-4" />
                      )}
                      PayFast
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      disabled={
                        !paymentsEnabled ||
                        processing === `${creditPackage.id}:ozow`
                      }
                      onClick={() => void startCheckout(creditPackage, "ozow")}
                    >
                      {processing === `${creditPackage.id}:ozow` ? (
                        <Loader2 className="size-4 animate-spin" />
                      ) : (
                        <Building2 className="size-4" />
                      )}
                      Ozow
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        <div className="mt-10 grid gap-4 md:grid-cols-3">
          {[
            {
              title: "PayFast",
              description: "Cards and Instant EFT through PayFast.",
              icon: WalletCards,
            },
            {
              title: "Ozow",
              description: "Independent secure pay-by-bank checkout.",
              icon: Building2,
            },
            {
              title: "Webhook verified",
              description:
                "Credits are issued only after the payment provider confirms payment.",
              icon: CheckCircle2,
            },
          ].map((item) => (
            <Card key={item.title}>
              <CardHeader>
                <item.icon className="size-5 text-brand-cyan" />
                <CardTitle>{item.title}</CardTitle>
                <CardDescription>{item.description}</CardDescription>
              </CardHeader>
            </Card>
          ))}
        </div>

        <div className="mt-12">
          <div className="max-w-3xl">
            <Badge variant="outline">South African payment access</Badge>
            <h2 className="mt-3 font-heading text-3xl text-white">More ways to pay</h2>
            <p className="mt-2 text-muted-foreground">
              The secure PayFast checkout can expose enabled bank, card, wallet, QR, and
              cash-assisted methods from one verified payment flow. Voucher providers need
              separate merchant approval before MRC may redeem a PIN.
            </p>
          </div>

          <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-5">
            {[
              {
                title: "Bank apps and wallets",
                status: "Via PayFast",
                description:
                  "Instant EFT, Capitec Pay, cards, QR, Apple Pay, Google Pay, and other methods appear when enabled on the MRC merchant profile.",
                href: "https://payfast.io/features/payment-methods/",
                icon: Banknote,
              },
              {
                title: "Cash-assisted checkout",
                status: "Provider activation",
                description:
                  "PayFast offers options such as MukuruPay and other cash-access methods on eligible merchant configurations.",
                href: "https://payfast.io/features/payment-methods/",
                icon: Store,
              },
              {
                title: "1Voucher",
                status: "Merchant onboarding",
                description:
                  "Customers can buy 1Voucher through supported banking apps and participating retailers. MRC needs approved Flash API access and settlement terms before redemption goes live.",
                href: "https://www.1voucher.co.za/support",
                icon: Ticket,
              },
              {
                title: "OTT Voucher",
                status: "Merchant onboarding",
                description:
                  "OTT Voucher serves cash customers through banking apps and a broad retail network. MRC will enable redemption only after approved merchant credentials are active.",
                href: "https://ottvoucher.com/business/",
                icon: Ticket,
              },
              {
                title: "Blu Voucher",
                status: "Merchant onboarding",
                description:
                  "Blu Voucher supports approved third-party online partners. MRC is preparing the secure payment boundary while commercial and API access are reviewed.",
                href: "https://www.bluelabeltelecoms.co.za/blu-label-distribution.php",
                icon: WalletCards,
              },
            ].map((method) => (
              <Card key={method.title}>
                <CardHeader>
                  <method.icon className="size-5 text-brand-cyan" />
                  <div className="flex flex-wrap items-center gap-2">
                    <CardTitle>{method.title}</CardTitle>
                    <Badge variant="outline">{method.status}</Badge>
                  </div>
                  <CardDescription>{method.description}</CardDescription>
                </CardHeader>
                <CardContent>
                  <a
                    href={method.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm font-semibold text-brand-cyan hover:underline"
                  >
                    Provider information
                  </a>
                </CardContent>
              </Card>
            ))}
          </div>

          <Alert className="mt-6 border-brand-cyan/35 bg-brand-cyan/8">
            <LockKeyhole className="size-4" />
            <AlertTitle>Voucher PIN safety</AlertTitle>
            <AlertDescription>
              Voucher redemption is not live yet. Never send a voucher PIN by email,
              Telegram, comments, or support messages. When enabled, a PIN will be submitted
              only to a dedicated server endpoint and never stored in the browser or public
              database.
            </AlertDescription>
          </Alert>
        </div>
      </section>
    </main>
  );
}
