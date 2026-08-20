"use client";

import { useRouter } from "next/navigation";
import { AlertTriangle } from "lucide-react";
import {
  CreditPackageCatalog,
  useActiveCreditPackages,
} from "@/components/pricing/credit-package-catalog";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  addCreditPackageToCart,
  readCreditCart,
  writeCreditCart,
} from "@/lib/credit-commerce";
import type { CreditPackage } from "@/lib/racing/types";

export function HomeCreditPackages() {
  const router = useRouter();
  const { packages, loading, error } = useActiveCreditPackages();

  function addToBasket(creditPackage: CreditPackage) {
    try {
      const cart = addCreditPackageToCart(readCreditCart(), creditPackage.id);
      writeCreditCart(cart);
      router.push("/pricing/#checkout");
    } catch {
      router.push("/pricing/");
    }
  }

  return (
    <>
      {error ? (
        <Alert variant="destructive" className="mb-5">
          <AlertTriangle className="size-4" />
          <AlertTitle>Credit packages unavailable</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      <CreditPackageCatalog
        packages={packages}
        loading={loading}
        onAdd={addToBasket}
      />
    </>
  );
}
