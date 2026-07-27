"use client";

import Link from "next/link";
import { FormEvent, useRef, useState } from "react";
import type { TurnstileInstance } from "@marsidev/react-turnstile";
import { AlertCircle, CheckCircle2, Loader2 } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CaptchaField, turnstileSiteKey } from "@/components/auth/captcha-field";
import { createClient } from "@/lib/supabase/client";
import { supabaseConfigMessage } from "@/lib/supabase/config";
import { getSiteUrl } from "@/lib/site-url";

type FormState = {
  kind: "idle" | "success" | "error";
  message: string;
};

export function ForgotPasswordForm() {
  const turnstileRef = useRef<TurnstileInstance>(null);
  const [formState, setFormState] = useState<FormState>({
    kind: "idle",
    message: "",
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [captchaToken, setCaptchaToken] = useState("");

  function resetCaptcha() {
    setCaptchaToken("");
    turnstileRef.current?.reset();
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const supabase = createClient();

    if (!supabase) {
      setFormState({ kind: "error", message: supabaseConfigMessage });
      return;
    }

    if (!turnstileSiteKey) {
      setFormState({
        kind: "error",
        message: "Human verification is not configured yet. Please contact MRC Racing support.",
      });
      return;
    }

    if (!captchaToken) {
      setFormState({
        kind: "error",
        message: "Please complete the human verification before requesting a reset link.",
      });
      return;
    }

    const formData = new FormData(event.currentTarget);
    const email = String(formData.get("email") ?? "").trim();

    setIsSubmitting(true);
    setFormState({ kind: "idle", message: "" });

    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${getSiteUrl()}/reset-password/`,
        captchaToken,
      });

      if (error) {
        throw error;
      }

      setFormState({
        kind: "success",
        message: "Reset link sent. Check your inbox and follow the secure link.",
      });
      resetCaptcha();
    } catch (error) {
      resetCaptcha();
      setFormState({
        kind: "error",
        message:
          error instanceof Error
            ? error.message
            : "Could not send the reset link. Please try again.",
      });
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <form className="grid gap-4" onSubmit={handleSubmit}>
      {formState.kind !== "idle" ? (
        <Alert variant={formState.kind === "error" ? "destructive" : "default"}>
          {formState.kind === "error" ? (
            <AlertCircle className="size-4" />
          ) : (
            <CheckCircle2 className="size-4" />
          )}
          <AlertTitle>{formState.kind === "error" ? "Reset issue" : "Email sent"}</AlertTitle>
          <AlertDescription>{formState.message}</AlertDescription>
        </Alert>
      ) : null}
      <div className="grid gap-2">
        <Label htmlFor="email">Email</Label>
        <Input id="email" name="email" type="email" placeholder="you@example.com" required />
      </div>
      <CaptchaField
        ref={turnstileRef}
        action="forgot_password"
        onTokenChange={setCaptchaToken}
      />
      <Button
        type="submit"
        disabled={isSubmitting || !turnstileSiteKey || !captchaToken}
      >
        {isSubmitting ? (
          <>
            <Loader2 className="size-4 animate-spin" />
            Sending link
          </>
        ) : (
          "Send reset link"
        )}
      </Button>
      <Button asChild type="button" variant="ghost">
        <Link href="/login">Back to login</Link>
      </Button>
    </form>
  );
}
