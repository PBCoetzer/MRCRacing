"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ClipboardCheck, KeyRound, Loader2, ShieldCheck, Smartphone } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { resolveMfaProfileStatus } from "@/lib/auth/mfa-status";
import { createClient } from "@/lib/supabase/client";

type MfaProfileCardProps = {
  href?: string;
  presentation?: "requirements" | "security";
  required?: boolean;
};

type SecurityState = {
  currentLevel: string | null;
  error: string;
  loading: boolean;
  verifiedFactorCount: number;
};

type MfaFactorRow = {
  factor_type: string;
  status: string;
};

export function MfaProfileCard({
  href = "/account/security/",
  presentation = "security",
  required = false,
}: MfaProfileCardProps) {
  const [state, setState] = useState<SecurityState>({
    currentLevel: null,
    error: "",
    loading: true,
    verifiedFactorCount: 0,
  });

  useEffect(() => {
    const supabase = createClient();
    if (!supabase) {
      const timeoutId = window.setTimeout(() => {
        setState((current) => ({
          ...current,
          error: "Account security is temporarily unavailable.",
          loading: false,
        }));
      }, 0);
      return () => window.clearTimeout(timeoutId);
    }

    let active = true;

    async function loadStatus() {
      try {
        const [factorResult, assuranceResult] = await Promise.all([
          supabase.auth.mfa.listFactors(),
          supabase.auth.mfa.getAuthenticatorAssuranceLevel(),
        ]);

        if (!active) return;

        const statusError = factorResult.error ?? assuranceResult.error;
        if (statusError) throw statusError;

        setState({
          currentLevel: assuranceResult.data.currentLevel,
          error: "",
          loading: false,
          verifiedFactorCount: factorResult.data.all.filter(
            (factor: MfaFactorRow) =>
              factor.factor_type === "totp" && factor.status === "verified",
          ).length,
        });
      } catch (caughtError) {
        if (!active) return;
        setState({
          currentLevel: null,
          error: caughtError instanceof Error
            ? caughtError.message
            : "Account security could not be loaded.",
          loading: false,
          verifiedFactorCount: 0,
        });
      }
    }

    void loadStatus();
    return () => {
      active = false;
    };
  }, []);

  const status = resolveMfaProfileStatus({
    currentLevel: state.currentLevel,
    verifiedFactorCount: state.verifiedFactorCount,
    required,
  });
  const requirementsPresentation = presentation === "requirements";
  const statusBadge = state.loading
    ? "Checking"
    : state.error
      ? "Unavailable"
      : requirementsPresentation
        ? status.protected ? "Up to date" : "1 action required"
        : status.badge;
  const actionLabel = requirementsPresentation
    ? "Review profile requirements"
    : state.loading ? "Open account security" : status.action;

  return (
    <Card className={status.protected ? "border-brand-cyan/45" : "border-brand-gold/35"}>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2">
              {requirementsPresentation ? (
                <ClipboardCheck className="size-5 text-brand-cyan" />
              ) : (
                <ShieldCheck className="size-5 text-brand-cyan" />
              )}
              {requirementsPresentation ? "Profile requirements" : "Profile security and 2FA"}
            </CardTitle>
            <CardDescription className="mt-1">
              {requirementsPresentation
                ? "Complete the account actions currently required by MRC. Future legal, privacy, or announcement acknowledgements can be added here."
                : "Enable or manage an authenticator app for this account."}
            </CardDescription>
          </div>
          {state.loading ? (
            <Badge variant="outline"><Loader2 className="size-3 animate-spin" />Checking</Badge>
          ) : state.error ? (
            <Badge variant="destructive">Unavailable</Badge>
          ) : (
            <Badge variant={status.protected ? "default" : "outline"}>{statusBadge}</Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex gap-3 rounded-lg border bg-background/40 p-4">
          {status.protected ? (
            <Smartphone className="mt-0.5 size-5 shrink-0 text-brand-cyan" />
          ) : (
            <KeyRound className="mt-0.5 size-5 shrink-0 text-brand-gold" />
          )}
          <div className="space-y-1">
            {requirementsPresentation ? (
              <p className="text-sm font-semibold text-foreground">Two-factor authentication</p>
            ) : null}
            <p className="text-sm text-foreground">{state.error || status.description}</p>
            <p className="text-xs leading-5 text-muted-foreground">
              A successful code verifies the current Supabase session, so 2FA is not requested on
              every page. MRC never stores a separate permanent device-bypass token.
            </p>
          </div>
        </div>
        <Button asChild variant={status.protected ? "outline" : "default"}>
          {href.startsWith("/client/#") ? (
            <a href={href}>
              <ShieldCheck className="size-4" />
              {actionLabel}
            </a>
          ) : (
            <Link href={href}>
              <ShieldCheck className="size-4" />
              {actionLabel}
            </Link>
          )}
        </Button>
      </CardContent>
    </Card>
  );
}
