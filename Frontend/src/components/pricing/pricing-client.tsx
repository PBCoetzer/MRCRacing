"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { FunctionsHttpError } from "@supabase/supabase-js";
import {
  AlertTriangle,
  ArrowRight,
  BadgeCheck,
  Building2,
  CheckCircle2,
  CreditCard,
  Loader2,
  LockKeyhole,
  Minus,
  Plus,
  ShoppingCart,
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

type Provider = "ozow";

const checkoutProviders = [
  {
    id: "ozow",
    title: "Ozow Pay by Bank",
    description: "Pay securely from a supported South African bank.",
    status: "Available now",
    enabled: true,
    icon: Building2,
  },
  {
    id: "vouchers",
    title: "Vouchers",
    description: "1Voucher, OTT Voucher and Blu Voucher support is being prepared.",
    status: "Coming soon",
    enabled: false,
    icon: Ticket,
  },
  {
    id: "paystack",
    title: "Paystack",
    description: "Card and alternative payment support is planned for a future release.",
    status: "Planned",
    enabled: false,
    icon: CreditCard,
  },
] as const;

type CheckoutResponse = {
  actionUrl?: string;
  redirectUrl?: string;
  fields?: Record<string, string>;
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

async function getCheckoutErrorMessage(error: unknown) {
  if (error instanceof FunctionsHttpError) {
    const payload = await error.context.json().catch(() => null) as
      | { error?: unknown }
      | null;

    if (typeof payload?.error === "string" && payload.error.trim()) {
      return payload.error;
    }
  }

  return error instanceof Error
    ? error.message
    : "Checkout could not be started.";
}

export function PricingClient() {
  const router = useRouter();
  const { packages, loading, error: packageError } = useActiveCreditPackages();
  const [processing, setProcessing] = useState("");
  const [error, setError] = useState("");
  const [cart, setCart] = useState<CreditCartState>({});
  const [cartLoaded, setCartLoaded] = useState(false);
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [selectedProvider, setSelectedProvider] = useState<Provider>("ozow");

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

  function openCheckout() {
    setError("");

    if (!cartItems.length) {
      setError("Add at least one Credit package to your Shopping Cart.");
      return;
    }

    setCheckoutOpen(true);
    window.requestAnimationFrame(() => {
      document.getElementById("payment-methods")?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
    });
  }

  async function startCheckout(provider: Provider) {
    const supabase = createClient();

    if (!supabase) {
      setError("The secure checkout service is not configured.");
      return;
    }

    if (!paymentsEnabled) {
      setError(
        "Online Credit purchases are not live yet. Ozow will be enabled after the live merchant configuration is verified.",
      );
      return;
    }

    setError("");
    if (!cartItems.length) {
      setError("Add at least one Credit package to your Shopping Cart.");
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

      if (checkout.redirectUrl) {
        window.location.assign(checkout.redirectUrl);
        return;
      }

      if (!checkout.actionUrl || !checkout.fields) {
        throw new Error("The payment provider did not return a checkout form.");
      }

      submitProviderForm(checkout.actionUrl, checkout.fields);
    } catch (checkoutError) {
      setError(await getCheckoutErrorMessage(checkoutError));
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
                Credits unlock eligible digital content and cannot be withdrawn.
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
              Ozow checkout infrastructure is installed, but live purchases remain
              disabled until the merchant configuration and notification endpoint are
              verified. No payment can be charged from this page yet.
            </AlertDescription>
          </Alert>
        ) : null}
        {packageError ? (
          <Alert variant="destructive" className="mb-8">
            <AlertTriangle className="size-4" />
            <AlertTitle>Checkout unavailable</AlertTitle>
            <AlertDescription>{packageError}</AlertDescription>
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
                  Your Shopping Cart
                </CardTitle>
                <CardDescription>
                  Review your Credit packages, then proceed to choose a payment method.
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
                        aria-label={`Remove ${creditPackage.name} from Shopping Cart`}
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
                Your Shopping Cart is empty. Add one or more Credit packages above.
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

            <div>
              <Button
                type="button"
                className="w-full"
                disabled={!cartItems.length || Boolean(processing)}
                onClick={openCheckout}
              >
                Proceed to Checkout
                <ArrowRight className="size-4" />
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Reward Credits are promotional and are kept separate from purchased Credits.
              They do not create tipster earnings or ECHCU contribution accrual.
            </p>
          </CardContent>
        </Card>

        {checkoutOpen ? (
          <Card
            id="payment-methods"
            className="mt-8 scroll-mt-24 border-brand-cyan/40"
          >
            <CardHeader>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <CardTitle className="flex items-center gap-2">
                    <WalletCards className="size-5 text-brand-cyan" />
                    Choose your payment method
                  </CardTitle>
                  <CardDescription>
                    Select one provider for this {formatRand(cartPriceCents)} order.
                  </CardDescription>
                </div>
                <Badge variant="outline">Secure checkout</Badge>
              </div>
            </CardHeader>
            <CardContent className="space-y-5">
              <div
                className="grid gap-3 md:grid-cols-3"
                role="radiogroup"
                aria-label="Payment provider"
              >
                {checkoutProviders.map((provider) => {
                  const isSelected = provider.id === selectedProvider;
                  const ProviderIcon = provider.icon;

                  return (
                    <button
                      key={provider.id}
                      type="button"
                      role="radio"
                      aria-checked={isSelected}
                      disabled={!provider.enabled}
                      onClick={() => {
                        if (provider.id === "ozow") {
                          setSelectedProvider("ozow");
                          setError("");
                        }
                      }}
                      className={`rounded-xl border p-4 text-left transition-colors ${
                        isSelected
                          ? "border-brand-gold bg-brand-gold/10"
                          : "border-border bg-background/45"
                      } disabled:cursor-not-allowed disabled:opacity-55`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <ProviderIcon className="size-5 text-brand-cyan" />
                        <Badge variant={provider.enabled ? "default" : "outline"}>
                          {provider.status}
                        </Badge>
                      </div>
                      <p className="mt-4 font-semibold">{provider.title}</p>
                      <p className="mt-1 text-sm text-muted-foreground">
                        {provider.description}
                      </p>
                    </button>
                  );
                })}
              </div>

              <div className="grid gap-4 rounded-lg border border-brand-cyan/25 bg-brand-cyan/5 p-4 sm:grid-cols-2">
                <div>
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">
                    Credits after payment
                  </p>
                  <p className="font-mono text-xl font-bold">
                    {(cartPurchasedCredits + cartRewardCredits).toLocaleString("en-ZA")}
                  </p>
                </div>
                <div>
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">
                    Pay now
                  </p>
                  <p className="font-mono text-xl font-bold">
                    {formatRand(cartPriceCents)}
                  </p>
                </div>
              </div>

              <Button
                type="button"
                className="w-full"
                disabled={!paymentsEnabled || !cartItems.length || Boolean(processing)}
                onClick={() => void startCheckout(selectedProvider)}
              >
                {processing === selectedProvider ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Building2 className="size-4" />
                )}
                Continue with Ozow
              </Button>

              {error ? (
                <Alert variant="destructive" role="alert">
                  <AlertTriangle className="size-4" />
                  <AlertTitle>Checkout could not start</AlertTitle>
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              ) : null}

              <Alert className="border-brand-cyan/35 bg-brand-cyan/8">
                <CheckCircle2 className="size-4" />
                <AlertTitle>Verified payment confirmation</AlertTitle>
                <AlertDescription>
                  Credits are issued only after the provider confirms payment. A
                  successful order automatically clears your Shopping Cart.
                </AlertDescription>
              </Alert>
            </CardContent>
          </Card>
        ) : null}
      </section>
    </main>
  );
}
