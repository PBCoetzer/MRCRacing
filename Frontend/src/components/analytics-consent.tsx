"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";

const storageKey = "mrc-analytics-consent";
const measurementId = process.env.NEXT_PUBLIC_GA4_MEASUREMENT_ID?.trim() ?? "";

declare global {
  interface Window {
    dataLayer?: unknown[];
    gtag?: (...args: unknown[]) => void;
  }
}

function enableAnalytics() {
  if (!measurementId || document.querySelector(`script[data-mrc-ga4="${measurementId}"]`)) return;
  window.dataLayer = window.dataLayer ?? [];
  window.gtag = (...args: unknown[]) => window.dataLayer?.push(args);
  window.gtag("js", new Date());
  window.gtag("config", measurementId, { anonymize_ip: true, allow_google_signals: false });
  const script = document.createElement("script");
  script.async = true;
  script.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(measurementId)}`;
  script.dataset.mrcGa4 = measurementId;
  document.head.appendChild(script);
}

function disableAnalytics() {
  document.querySelectorAll("script[data-mrc-ga4]").forEach((item) => item.remove());
  window.dataLayer = [];
}

export function AnalyticsConsent() {
  const [choice, setChoice] = useState<"accepted" | "declined" | null>(null);
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    if (!measurementId) return;
    const timeoutId = window.setTimeout(() => {
      const saved = window.localStorage.getItem(storageKey);
      if (saved === "accepted" || saved === "declined") setChoice(saved);
      if (saved === "accepted") enableAnalytics();
    }, 0);
    return () => window.clearTimeout(timeoutId);
  }, []);

  if (!measurementId) return null;

  function choose(value: "accepted" | "declined") {
    window.localStorage.setItem(storageKey, value);
    setChoice(value);
    setEditing(false);
    if (value === "accepted") enableAnalytics();
    else disableAnalytics();
  }

  if (choice && !editing) {
    return (
      <Button type="button" variant="outline" size="sm" className="fixed right-3 bottom-3 z-[70] bg-background/95" onClick={() => setEditing(true)}>
        Analytics settings
      </Button>
    );
  }

  return (
    <aside className="fixed inset-x-3 bottom-3 z-[70] mx-auto max-w-2xl rounded-xl border border-brand-gold/40 bg-background p-5 shadow-2xl" aria-label="Analytics consent">
      <p className="font-semibold text-white">Optional anonymous analytics</p>
      <p className="mt-2 text-sm leading-6 text-muted-foreground">MRC can use aggregate Google Analytics data to improve public pages. No analytics request is sent before you accept, and account details are never included.</p>
      <div className="mt-4 flex flex-wrap gap-2">
        <Button type="button" onClick={() => choose("accepted")}>Allow analytics</Button>
        <Button type="button" variant="outline" onClick={() => choose("declined")}>Decline</Button>
      </div>
    </aside>
  );
}
