"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { EmailOtpType, Session, SupabaseClient } from "@supabase/supabase-js";
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

const sessionWaitAttempts = 20;
const sessionWaitIntervalMs = 250;

async function waitForAuthSession(supabase: SupabaseClient): Promise<Session | null> {
  for (let attempt = 0; attempt < sessionWaitAttempts; attempt += 1) {
    const {
      data: { session },
      error,
    } = await supabase.auth.getSession();

    if (error) {
      throw error;
    }

    if (session) {
      return session;
    }

    await new Promise<void>((resolve) => {
      window.setTimeout(resolve, sessionWaitIntervalMs);
    });
  }

  return null;
}

export function AuthCallback() {
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
        const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ""));
        const callbackError =
          searchParams.get("error_description") ?? hashParams.get("error_description");
        const tokenHash = searchParams.get("token_hash");
        const otpType = searchParams.get("type") as EmailOtpType | null;

        if (callbackError) {
          throw new Error(callbackError);
        }

        if (tokenHash && otpType && emailOtpTypes.has(otpType)) {
          const { error: verificationError } = await supabase.auth.verifyOtp({
            token_hash: tokenHash,
            type: otpType,
          });

          if (verificationError) {
            throw verificationError;
          }
        }

        const session = await waitForAuthSession(supabase);

        if (!session) {
          throw new Error(
            "This confirmation link could not start a secure session. It may be expired or already used. If your email is already confirmed, continue to login.",
          );
        }

        const {
          data: { user },
          error: userError,
        } = await supabase.auth.getUser(session.access_token);

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
        window.location.replace(destination);
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
  }, []);

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
            <Link href="/forgot-password/">Reset password</Link>
          </Button>
        </div>
      ) : null}
    </div>
  );
}
