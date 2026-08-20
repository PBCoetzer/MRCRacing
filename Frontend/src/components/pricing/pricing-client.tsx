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
  Minus,
  Plus,
  ShoppingCart,
  Store,
  Ticket,
  Trash2,
  WalletCards,
} from "lucide-react";
import {
  CreditPackageCatalog,
  useActiveCreditPackages,
} from "@/components/pricing/credit-package-catalog";
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
import {
  creditCartStorageKey,
  formatRand,
  parseCreditCart,
  paymentsEnabled,
  type CreditCartState,
} from "@/lib/credit-commerce";
import { createClient } from "@/lib/supabase/client";

type Provider = "payfast" | "ozow";

type CheckoutResponse = {
  actionUrl: string;
  fields: Record<string, string>;
  paymentId: string;
};

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
  const { packages, loading, error: packageError } = useActiveCreditPackages();
  const [processing, setProcessing] = useState("");
  const [error, setError] = useState("");
  const [cart, setCart] = useState<CreditCartState>({});
  const [cartLoaded, setCartLoaded] = useState(false);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      try {
        const storedCart = window.localStorage.getItem(creditCartStorageKey);
        if (storedCart) {
          setCart(parseCreditCart(storedCart));
        }
      } catch {
        window.localStorage.removeItem(creditCartStorageKey);
      } finally {
        setCartLoaded(true);
      }
    }, 0);

    return () => window.clearTimeout(timeoutId);
  }, []);

  useEffect(() => {
    if (!cartLoaded) {
      return;
    }

    window.localStorage.setItem(creditCartStorageKey, JSON.stringify(cart));
  }, [cart, cartLoaded]);

  function setCartQuantity(packageId: string, quantity: number) {
    setCart((current) => {
      if (quantity <= 0) {
        const next = { ...current };
        delete next[packageId];
        return next;
      }

      return { ...current, [packageId]: Math.min(20, quantity) };
    });
  }

  const cartItems = packages
    .filter((creditPackage) => (cart[creditPackage.id] ?? 0) > 0)
    .map((creditPackage) => ({
      creditPackage,
      quantity: cart[creditPackage.id] ?? 0,
    }));
  const cartPackageQuantity = cartItems.reduce(
    (total, item) => total + item.quantity,
    0,
  );
  const cartPriceCents = cartItems.reduce(
    (total, item) => total + item.creditPackage.price_cents * item.quantity,
    0,
  );
  const cartPurchasedCredits = cartItems.reduce(
    (total, item) => total + item.creditPackage.credits * item.quantity,
    0,
  );
  const cartRewardCredits = cartItems.reduce(
    (total, item) => total + item.creditPackage.reward_credits * item.quantity,
    0,
  );

  async function startCheckout(provider: Provider) {
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
    if (!cartItems.length) {
      setError("Add at least one Credit package to your basket.");
      return;
    }

    setProcessing(provider);

    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        const next = "/pricing/#checkout";
        router.push(`/login/?next=${encodeURIComponent(next)}`);
        return;
      }

      const { data, error: checkoutError } = await supabase.functions.invoke(
        "create-credit-checkout",
        {
          body: {
            items: cartItems.map((item) => ({
              packageId: item.creditPackage.id,
              quantity: item.quantity,
            })),
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
        {error || packageError ? (
          <Alert variant="destructive" className="mb-8">
            <AlertTriangle className="size-4" />
            <AlertTitle>Checkout unavailable</AlertTitle>
            <AlertDescription>{error || packageError}</AlertDescription>
          </Alert>
        ) : null}

        <div className="mb-7">
          <h2 className="font-heading text-3xl text-white">Credit packages</h2>
          <p className="mt-2 text-muted-foreground">
            Purchased Credits remain R1 each. Larger packages may include separate
            promotional Reward Credits configured by MRC administration.
          </p>
        </div>

        <CreditPackageCatalog
          packages={packages}
          loading={loading}
          onAdd={(creditPackage) =>
            setCartQuantity(
              creditPackage.id,
              (cart[creditPackage.id] ?? 0) + 1,
            )
          }
        />

        <Card id="checkout" className="mt-8 scroll-mt-24 border-brand-gold/40">
          <CardHeader>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <ShoppingCart className="size-5 text-brand-gold" />
                  Your Credit basket
                </CardTitle>
                <CardDescription>
                  Stack packages, then choose one payment provider for the complete order.
                </CardDescription>
              </div>
              <Badge variant="outline">
                {cartPackageQuantity} {cartPackageQuantity === 1 ? "package" : "packages"}
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-5">
            {cartItems.length ? (
              <div className="space-y-3">
                {cartItems.map(({ creditPackage, quantity }) => (
                  <div
                    key={creditPackage.id}
                    className="flex flex-col gap-3 rounded-lg border bg-background/45 p-4 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div>
                      <p className="font-semibold">{creditPackage.name}</p>
                      <p className="text-sm text-muted-foreground">
                        {creditPackage.credits.toLocaleString("en-ZA")} purchased
                        {creditPackage.reward_credits
                          ? ` + ${creditPackage.reward_credits.toLocaleString("en-ZA")} Reward Credits`
                          : ""}
                        {` · ${formatRand(creditPackage.price_cents)} each`}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Button
                        type="button"
                        size="icon-sm"
                        variant="outline"
                        aria-label={`Reduce ${creditPackage.name} quantity`}
                        onClick={() => setCartQuantity(creditPackage.id, quantity - 1)}
                      >
                        <Minus className="size-4" />
                      </Button>
                      <span className="min-w-8 text-center font-mono font-bold">{quantity}</span>
                      <Button
                        type="button"
                        size="icon-sm"
                        variant="outline"
                        aria-label={`Increase ${creditPackage.name} quantity`}
                        onClick={() => setCartQuantity(creditPackage.id, quantity + 1)}
                      >
                        <Plus className="size-4" />
                      </Button>
                      <Button
                        type="button"
                        size="icon-sm"
                        variant="ghost"
                        aria-label={`Remove ${creditPackage.name} from basket`}
                        onClick={() => setCartQuantity(creditPackage.id, 0)}
                      >
                        <Trash2 className="size-4" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
                Your basket is empty. Add one or more Credit packages above.
              </div>
            )}

            <div className="grid gap-4 rounded-lg border border-brand-cyan/25 bg-brand-cyan/5 p-4 sm:grid-cols-3">
              <div>
                <p className="text-xs uppercase tracking-wide text-muted-foreground">Purchased</p>
                <p className="font-mono text-xl font-bold">{cartPurchasedCredits.toLocaleString("en-ZA")}</p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wide text-muted-foreground">Reward bonus</p>
                <p className="font-mono text-xl font-bold text-brand-cyan">+{cartRewardCredits.toLocaleString("en-ZA")}</p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wide text-muted-foreground">Order total</p>
                <p className="font-mono text-xl font-bold">{formatRand(cartPriceCents)}</p>
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <Button
                type="button"
                disabled={!paymentsEnabled || !cartItems.length || Boolean(processing)}
                onClick={() => void startCheckout("payfast")}
              >
                {processing === "payfast" ? <Loader2 className="size-4 animate-spin" /> : <CreditCard className="size-4" />}
                Checkout with PayFast
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={!paymentsEnabled || !cartItems.length || Boolean(processing)}
                onClick={() => void startCheckout("ozow")}
              >
                {processing === "ozow" ? <Loader2 className="size-4 animate-spin" /> : <Building2 className="size-4" />}
                Checkout with Ozow
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Reward Credits are promotional and are kept separate from purchased Credits.
              They do not create tipster earnings or ECHCU contribution accrual.
            </p>
          </CardContent>
        </Card>

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
