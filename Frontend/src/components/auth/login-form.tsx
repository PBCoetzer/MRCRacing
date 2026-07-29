"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useRef, useState } from "react";
import type { TurnstileInstance } from "@marsidev/react-turnstile";
import { AlertCircle, CheckCircle2, Loader2 } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CaptchaField, turnstileSiteKey } from "@/components/auth/captcha-field";
import { dashboardForRoles } from "@/lib/auth/roles";
import { supabaseConfigMessage } from "@/lib/supabase/config";
import { createClient } from "@/lib/supabase/client";

type FormState = {
  kind: "idle" | "success" | "error";
  message: string;
};

type RoleRow = {
  role: string;
};

export function LoginForm() {
  const router = useRouter();
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
        message: "Please complete the human verification before logging in.",
      });
      return;
    }

    const formData = new FormData(event.currentTarget);
    const email = String(formData.get("email") ?? "").trim();
    const password = String(formData.get("password") ?? "");

    setIsSubmitting(true);
    setFormState({ kind: "idle", message: "" });

    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password,
        options: {
          captchaToken,
        },
      });

      if (error) {
        throw error;
      }

      const { data: roles, error: roleError } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", data.user.id);

      if (roleError) {
        throw roleError;
      }

      const roleRows = (roles ?? []) as RoleRow[];

      setFormState({
        kind: "success",
        message: "Login successful. Taking you to the requested page.",
      });

      const requestedDestination = new URLSearchParams(window.location.search).get("next");
      const safeDestination =
        requestedDestination?.startsWith("/") && !requestedDestination.startsWith("//")
          ? requestedDestination
          : dashboardForRoles(roleRows.map((row) => row.role));

      router.push(safeDestination);
      router.refresh();
    } catch (error) {
      resetCaptcha();
      setFormState({
        kind: "error",
        message:
          error instanceof Error
            ? error.message
            : "Login failed. Please check your details and try again.",
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
          <AlertTitle>{formState.kind === "error" ? "Login issue" : "Success"}</AlertTitle>
          <AlertDescription>{formState.message}</AlertDescription>
        </Alert>
      ) : null}
      <div className="grid gap-2">
        <Label htmlFor="email">Email</Label>
        <Input id="email" name="email" type="email" placeholder="you@example.com" required />
      </div>
      <div className="grid gap-2">
        <Label htmlFor="password">Password</Label>
        <Input id="password" name="password" type="password" placeholder="Your password" required />
      </div>
      <CaptchaField ref={turnstileRef} action="login" onTokenChange={setCaptchaToken} />
      <Button
        type="submit"
        className="w-full"
        disabled={isSubmitting || !turnstileSiteKey || !captchaToken}
      >
        {isSubmitting ? (
          <>
            <Loader2 className="size-4 animate-spin" />
            Logging in
          </>
        ) : (
          "Login"
        )}
      </Button>
      <div className="flex items-center justify-between text-sm">
        <Link href="/register" className="text-primary hover:underline">
          Create account
        </Link>
        <Link href="/forgot-password" className="text-muted-foreground hover:text-foreground">
          Forgot password?
        </Link>
      </div>
    </form>
  );
}
