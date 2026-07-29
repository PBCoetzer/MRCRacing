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
  | "restricted"
  | "forbidden"
  | "ready"
  | "error";

type RoleGateProps = {
  allowedRoles: string[];
  children: React.ReactNode;
  description: string;
  title: string;
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

export function RoleGate({ allowedRoles, children, description, title }: RoleGateProps) {
  const [gateState, setGateState] = useState<RoleGateState>("loading");
  const [message, setMessage] = useState("Checking your Supabase session.");

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
          supabase
            .from("user_roles")
            .select("role")
            .eq("user_id", user.id),
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

        if (roleResult.error) {
          throw roleResult.error;
        }

        if (!isMounted) {
          return;
        }

        const roleRows = (roleResult.data ?? []) as RoleRow[];
        const hasAccess = roleRows.some((row) => allowedRoles.includes(row.role));

        if (!hasAccess) {
          setGateState("forbidden");
          setMessage(`This account does not have access to ${description}.`);
          return;
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
  }, [allowedRoles, description]);

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
                  : title}
            </AlertTitle>
            <AlertDescription>{message}</AlertDescription>
          </Alert>
          {gateState === "signed-out" ? (
            <div className="flex flex-wrap gap-3">
              <Button asChild>
                <Link href="/login/">Login</Link>
              </Button>
              <Button asChild variant="outline">
                <Link href="/register/">Create account</Link>
              </Button>
            </div>
          ) : null}
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
