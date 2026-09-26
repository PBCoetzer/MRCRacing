"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { AlertCircle, Loader2, ShieldCheck } from "lucide-react";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";
import { supabaseConfigMessage } from "@/lib/supabase/config";

type RoleGateState =
  | "loading"
  | "configured"
  | "signed-out"
  | "mfa-required"
  | "mfa-setup-required"
  | "restricted"
  | "forbidden"
  | "ready"
  | "error";

export type MfaPolicy = "enrolled" | "administrator" | "management";

type RoleGateProps = {
  allowedRoles: string[];
  children: React.ReactNode;
  description: string;
  title: string;
  mfaPolicy?: MfaPolicy;
  requireRole?: boolean;
};

type RoleRow = {
  role: string;
};

type AccountControl = {
  status: "active" | "flagged" | "suspended" | "banned";
  suspension_until: string | null;
  public_message: string | null;
};

function isMissingAuthSession(error: unknown) {
  return error instanceof Error && error.message.toLowerCase().includes("auth session missing");
}

export function RoleGate({
  allowedRoles,
  children,
  description,
  title,
  mfaPolicy = "enrolled",
  requireRole = true,
}: RoleGateProps) {
  const [gateState, setGateState] = useState<RoleGateState>("loading");
  const [message, setMessage] = useState("Checking your Supabase session.");
  const loginHref = typeof window === "undefined"
    ? "/login/"
    : `/login/?next=${encodeURIComponent(`${window.location.pathname}${window.location.search}${window.location.hash}`)}`;

  useEffect(() => {
    let isMounted = true;

    async function checkAccess() {
      const supabase = createClient();

      if (!supabase) {
        setGateState("configured");
        setMessage(supabaseConfigMessage);
        return;
      }

      try {
        const {
          data: { user },
          error: userError,
        } = await supabase.auth.getUser();

        if (userError) {
          if (isMissingAuthSession(userError)) {
            setGateState("signed-out");
            setMessage("Please log in before opening this private workspace.");
            return;
          }

          throw userError;
        }

        if (!user) {
          setGateState("signed-out");
          setMessage("Please log in before opening this private workspace.");
          return;
        }

        const [controlResult, roleResult] = await Promise.all([
          supabase
            .from("user_account_controls")
            .select("status,suspension_until,public_message")
            .eq("user_id", user.id)
            .maybeSingle(),
          requireRole
            ? supabase
                .from("user_roles")
                .select("role")
                .eq("user_id", user.id)
            : null,
        ]);

        if (controlResult.error) {
          throw controlResult.error;
        }

        const control = controlResult.data as AccountControl | null;
        const activeSuspension =
          control?.status === "suspended" &&
          (!control.suspension_until ||
            new Date(control.suspension_until).getTime() > Date.now());

        if (control?.status === "banned" || activeSuspension) {
          const expiry = control.suspension_until
            ? ` until ${new Date(control.suspension_until).toLocaleString("en-ZA")}`
            : "";
          setGateState("restricted");
          setMessage(
            control.public_message ||
              `This account is currently restricted${expiry}. Please contact MRC Racing support if you need assistance.`,
          );
          return;
        }

        if (!isMounted) {
          return;
        }

        if (requireRole) {
          if (!roleResult) {
            throw new Error("Account access could not be confirmed.");
          }

          if (roleResult.error) {
            throw roleResult.error;
          }

          const roleRows = (roleResult.data ?? []) as RoleRow[];
          const hasAccess = roleRows.some((row) => allowedRoles.includes(row.role));

          if (!hasAccess) {
            setGateState("forbidden");
            setMessage(`This account does not have access to ${description}.`);
            return;
          }
        }

        if (mfaPolicy !== "management") {
          const { data: assurance, error: assuranceError } =
            await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
          if (assuranceError) throw assuranceError;

          if (assurance.nextLevel === "aal2" && assurance.currentLevel !== "aal2") {
            setGateState("mfa-required");
            setMessage("Enter a current authenticator code to finish signing in.");
            return;
          }

          if (mfaPolicy === "administrator" && assurance.currentLevel !== "aal2") {
            setGateState("mfa-setup-required");
            setMessage("Administrators must set up two-factor authentication before opening this workspace.");
            return;
          }
        }

        setGateState("ready");
        setMessage(`Access confirmed for ${description}.`);
      } catch (error) {
        if (!isMounted) {
          return;
        }

        setGateState("error");
        setMessage(error instanceof Error ? error.message : "Could not confirm access.");
      }
    }

    checkAccess();

    return () => {
      isMounted = false;
    };
  }, [allowedRoles, description, mfaPolicy, requireRole]);

  if (gateState === "ready") {
    return children;
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <SiteHeader />
      <main className="mx-auto flex min-h-[calc(100svh-8rem)] w-full max-w-2xl items-center px-4 py-10 sm:px-6">
        <div className="grid w-full gap-4">
          <Alert
            variant={
              gateState === "error" ||
              gateState === "forbidden" ||
              gateState === "restricted"
                ? "destructive"
                : "default"
            }
          >
            {gateState === "loading" ? (
              <Loader2 className="size-4 animate-spin" />
            ) : gateState === "signed-out" ? (
              <ShieldCheck className="size-4" />
            ) : (
              <AlertCircle className="size-4" />
            )}
            <AlertTitle>
              {gateState === "loading"
                ? "Checking access"
                : gateState === "signed-out"
                  ? "Login required"
                  : gateState === "restricted"
                    ? "Account restricted"
                    : gateState === "mfa-required"
                      ? "Two-factor verification required"
                      : gateState === "mfa-setup-required"
                        ? "Two-factor setup required"
                  : title}
            </AlertTitle>
            <AlertDescription>{message}</AlertDescription>
          </Alert>
          {gateState === "signed-out" ? (
            <div className="flex flex-wrap gap-3">
              <Button asChild>
                <Link href={loginHref}>Login</Link>
              </Button>
              <Button asChild variant="outline">
                <Link href="/register/">Create account</Link>
              </Button>
            </div>
          ) : null}
          {gateState === "mfa-required" || gateState === "mfa-setup-required" ? (
            <Button asChild>
              <Link
                href={
                  typeof window === "undefined"
                    ? "/account/security/"
                    : `/account/security/?mode=${gateState === "mfa-required" ? "challenge" : "setup"}&next=${encodeURIComponent(`${window.location.pathname}${window.location.search}${window.location.hash}`)}`
                }
              >
                Open account security
              </Link>
            </Button>
          ) : null}
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
