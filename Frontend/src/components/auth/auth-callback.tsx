"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import type { EmailOtpType } from "@supabase/supabase-js";
import { AlertCircle, CheckCircle2, Loader2 } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { dashboardForRoles } from "@/lib/auth/roles";
import { createClient } from "@/lib/supabase/client";
import { supabaseConfigMessage } from "@/lib/supabase/config";

type CallbackState = "checking" | "success" | "error";

type RoleRow = {
  role: string;
};

const emailOtpTypes = new Set<EmailOtpType>([
  "email",
  "signup",
  "invite",
  "magiclink",
  "recovery",
  "email_change",
]);

export function AuthCallback() {
  const router = useRouter();
  const [callbackState, setCallbackState] = useState<CallbackState>("checking");
  const [message, setMessage] = useState("Confirming your email and preparing your account.");

  useEffect(() => {
    let isMounted = true;

    async function completeAuthentication() {
      const supabase = createClient();

      if (!supabase) {
        setCallbackState("error");
        setMessage(supabaseConfigMessage);
        return;
      }

      try {
        const searchParams = new URLSearchParams(window.location.search);
        const tokenHash = searchParams.get("token_hash");
        const otpType = searchParams.get("type") as EmailOtpType | null;

        if (tokenHash && otpType && emailOtpTypes.has(otpType)) {
          const { error: verificationError } = await supabase.auth.verifyOtp({
            token_hash: tokenHash,
            type: otpType,
          });

          if (verificationError) {
            throw verificationError;
          }
        }

        const {
          data: { user },
          error: userError,
        } = await supabase.auth.getUser();

        if (userError) {
          throw userError;
        }

        if (!user) {
          throw new Error("The confirmation link is invalid or has expired.");
        }

        const { data: roles, error: roleError } = await supabase
          .from("user_roles")
          .select("role")
          .eq("user_id", user.id);

        if (roleError) {
          throw roleError;
        }

        if (!isMounted) {
          return;
        }

        const roleRows = (roles ?? []) as RoleRow[];
        const destination = dashboardForRoles(roleRows.map((row) => row.role));

        window.history.replaceState({}, document.title, window.location.pathname);
        setCallbackState("success");
        setMessage("Email confirmed. Taking you to your dashboard.");
        router.replace(destination);
        router.refresh();
      } catch (error) {
        if (!isMounted) {
          return;
        }

        setCallbackState("error");
        setMessage(
          error instanceof Error
            ? error.message
            : "Could not confirm this email. Please request a new confirmation link.",
        );
      }
    }

    completeAuthentication();

    return () => {
      isMounted = false;
    };
  }, [router]);

  return (
    <div className="grid gap-4">
      <Alert variant={callbackState === "error" ? "destructive" : "default"}>
        {callbackState === "checking" ? (
          <Loader2 className="size-4 animate-spin" />
        ) : callbackState === "success" ? (
          <CheckCircle2 className="size-4" />
        ) : (
          <AlertCircle className="size-4" />
        )}
        <AlertTitle>
          {callbackState === "checking"
            ? "Confirming email"
            : callbackState === "success"
              ? "Email confirmed"
              : "Confirmation issue"}
        </AlertTitle>
        <AlertDescription>{message}</AlertDescription>
      </Alert>
      {callbackState === "error" ? (
        <div className="flex flex-wrap gap-3">
          <Button asChild>
            <Link href="/login/">Go to login</Link>
          </Button>
          <Button asChild variant="outline">
            <Link href="/register/">Register again</Link>
          </Button>
        </div>
      ) : null}
    </div>
  );
}
