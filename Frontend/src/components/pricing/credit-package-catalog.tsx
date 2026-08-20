"use client";

import { useEffect, useState } from "react";
import { Gift, Loader2, ShoppingCart } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { formatRand, paymentsEnabled } from "@/lib/credit-commerce";
import type { CreditPackage } from "@/lib/racing/types";
import { createClient } from "@/lib/supabase/client";

const packageColumns = "grid gap-4 md:grid-cols-2 xl:grid-cols-5";

export function useActiveCreditPackages() {
  const [packages, setPackages] = useState<CreditPackage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let isActive = true;

    async function loadPackages() {
      const supabase = createClient();

      if (!supabase) {
        if (isActive) {
          setLoading(false);
          setError("The Credit package database is not configured for this build.");
        }
        return;
      }

      const { data, error: packageError } = await supabase
        .from("credit_packages")
        .select("id,name,credits,reward_credits,price_cents,promotion_label,is_active,sort_order")
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

  return { packages, loading, error };
}

type CreditPackageCatalogProps = {
  packages: CreditPackage[];
  loading: boolean;
  onAdd: (creditPackage: CreditPackage) => void;
};

export function CreditPackageCatalog({
  packages,
  loading,
  onAdd,
}: CreditPackageCatalogProps) {
  if (loading) {
    return (
      <Card>
        <CardContent className="flex min-h-44 items-center justify-center gap-2">
          <Loader2 className="size-5 animate-spin text-primary" />
          Loading Credit packages…
        </CardContent>
      </Card>
    );
  }

  if (!packages.length) {
    return (
      <Card>
        <CardContent className="flex min-h-32 items-center justify-center text-muted-foreground">
          No Credit packages are currently available.
        </CardContent>
      </Card>
    );
  }

  return (
    <div className={packageColumns}>
      {packages.map((creditPackage) => (
        <Card key={creditPackage.id} className="flex flex-col">
          <CardHeader>
            <CardDescription>Credit package</CardDescription>
            <CardTitle className="font-heading text-2xl">
              {creditPackage.credits.toLocaleString("en-ZA")} Purchased Credits
            </CardTitle>
            {creditPackage.reward_credits > 0 ? (
              <Badge className="w-fit bg-brand-cyan text-brand-purple-deep">
                <Gift className="size-3" />
                +{creditPackage.reward_credits.toLocaleString("en-ZA")} Reward Credits
              </Badge>
            ) : null}
          </CardHeader>
          <CardContent className="flex flex-1 flex-col">
            <p className="font-mono text-3xl font-bold">
              {formatRand(creditPackage.price_cents)}
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              R1 per purchased Credit
            </p>
            {creditPackage.promotion_label ? (
              <p className="mt-3 text-sm font-medium text-brand-cyan">
                {creditPackage.promotion_label}
              </p>
            ) : null}
            <div className="mt-auto pt-6">
              <Button
                className="w-full"
                type="button"
                disabled={!paymentsEnabled}
                onClick={() => onAdd(creditPackage)}
              >
                <ShoppingCart className="size-4" />
                Add to basket
              </Button>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
