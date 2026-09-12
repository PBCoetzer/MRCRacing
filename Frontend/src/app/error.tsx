"use client";

import { useEffect } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function ErrorBoundary({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Application route failed", {
      digest: error.digest ?? null,
      name: error.name,
    });
  }, [error]);

  return (
    <main className="mx-auto flex min-h-[60vh] w-full max-w-3xl items-center px-4 py-16 sm:px-6">
      <section
        aria-labelledby="route-error-title"
        className="w-full rounded-2xl border border-destructive/50 bg-card p-6 shadow-2xl sm:p-8"
        role="alert"
      >
        <AlertTriangle className="size-9 text-destructive" aria-hidden="true" />
        <h1 id="route-error-title" className="mt-4 font-heading text-3xl text-white">
          This page could not be loaded
        </h1>
        <p className="mt-3 max-w-xl leading-7 text-muted-foreground">
          Your account and payment information have not been changed. Try loading the page again.
          If the problem continues, contact MRC support and include the time it happened.
        </p>
        {error.digest ? (
          <p className="mt-3 font-mono text-xs text-muted-foreground">
            Reference: {error.digest}
          </p>
        ) : null}
        <Button type="button" className="mt-6 min-h-11" onClick={reset}>
          <RefreshCw className="size-4" aria-hidden="true" />
          Try again
        </Button>
      </section>
    </main>
  );
}
