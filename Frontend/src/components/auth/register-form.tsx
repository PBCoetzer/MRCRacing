"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useRef, useState } from "react";
import type { TurnstileInstance } from "@marsidev/react-turnstile";
import { AlertCircle, CheckCircle2, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CaptchaField, turnstileSiteKey } from "@/components/auth/captcha-field";
import { createClient } from "@/lib/supabase/client";
import { supabaseConfigMessage } from "@/lib/supabase/config";
import { getSiteUrl } from "@/lib/site-url";

type FormState = {
  kind: "idle" | "success" | "existing" | "error";
  message: string;
};

export function RegisterForm() {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const turnstileRef = useRef<TurnstileInstance>(null);
  const [formState, setFormState] = useState<FormState>({
    kind: "idle",
    message: "",
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [captchaToken, setCaptchaToken] = useState("");
  const [redirectAfterConfirmation, setRedirectAfterConfirmation] = useState(false);

  function showResult(kind: FormState["kind"], message: string) {
    setFormState({ kind, message });
    setIsDialogOpen(true);
  }

  function resetCaptcha() {
    setCaptchaToken("");
    turnstileRef.current?.reset();
  }

  function handleDialogConfirmation() {
    setIsDialogOpen(false);

    if (formState.kind === "success") {
      formRef.current?.reset();
      resetCaptcha();
      setFormState({ kind: "idle", message: "" });

      if (redirectAfterConfirmation) {
        router.push("/client/");
        router.refresh();
      }
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const supabase = createClient();

    if (!supabase) {
      showResult("error", supabaseConfigMessage);
      return;
    }

    if (!turnstileSiteKey) {
      showResult(
        "error",
        "Human verification is not configured yet. Please contact MRC Racing support.",
      );
      return;
    }

    if (!captchaToken) {
      showResult("error", "Please complete the human verification before registering.");
      return;
    }

    const formData = new FormData(event.currentTarget);
    const firstName = String(formData.get("firstName") ?? "").trim();
    const lastName = String(formData.get("lastName") ?? "").trim();
    const displayName = String(formData.get("displayName") ?? "").trim();
    const phone = String(formData.get("phone") ?? "").trim();
    const email = String(formData.get("email") ?? "").trim();
    const password = String(formData.get("password") ?? "");
    const acceptedTerms = formData.get("acceptedTerms") === "on";
    const confirmedOver18 = formData.get("confirmedOver18") === "on";

    if (!acceptedTerms || !confirmedOver18) {
      showResult("error", "Please confirm the terms and 18+ responsible-use declaration.");
      return;
    }

    setIsSubmitting(true);
    setFormState({ kind: "idle", message: "" });

    try {
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          emailRedirectTo: `${getSiteUrl()}/auth/callback/`,
          captchaToken,
          data: {
            accepted_terms: acceptedTerms,
            confirmed_over_18: confirmedOver18,
            first_name: firstName,
            last_name: lastName,
            display_name: displayName || `${firstName} ${lastName}`,
            phone,
          },
        },
      });

      if (error) {
        throw error;
      }

      if (data.session) {
        setRedirectAfterConfirmation(true);
        showResult("success", "Account created. Your client dashboard is ready.");
        return;
      }

      if (data.user?.identities?.length === 0) {
        setRedirectAfterConfirmation(false);
        showResult(
          "existing",
          "No new account or confirmation email was created. If you registered before, log in with your existing password or reset it.",
        );
        return;
      }

      setRedirectAfterConfirmation(false);
      showResult("success", "Account created. Please check your email to confirm your login.");
    } catch (error) {
      resetCaptcha();
      showResult(
        "error",
        error instanceof Error ? error.message : "Registration failed. Please try again.",
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <>
      <form ref={formRef} className="grid gap-4" onSubmit={handleSubmit}>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="grid gap-2">
            <Label htmlFor="first-name">First name</Label>
            <Input id="first-name" name="firstName" autoComplete="given-name" required />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="last-name">Surname</Label>
            <Input id="last-name" name="lastName" autoComplete="family-name" required />
          </div>
        </div>
        <div className="grid gap-2">
          <Label htmlFor="name">Public display name (optional)</Label>
          <Input
            id="name"
            name="displayName"
            placeholder="Defaults to your full name"
            autoComplete="nickname"
          />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="phone">Cell number</Label>
          <Input id="phone" name="phone" placeholder="+27" />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="email">Email</Label>
          <Input id="email" name="email" type="email" placeholder="you@example.com" required />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="password">Password</Label>
          <Input
            id="password"
            name="password"
            type="password"
            placeholder="Create a password"
            required
            minLength={8}
          />
        </div>
        <label className="flex items-start gap-3 rounded-lg border border-brand-gold/25 bg-background/60 p-3 text-sm text-muted-foreground">
          <input name="confirmedOver18" type="checkbox" required className="mt-1 accent-primary" />
          I confirm that I am 18 or older and understand that betting decisions remain my responsibility.
        </label>
        <label className="flex items-start gap-3 rounded-lg border border-brand-gold/25 bg-background/60 p-3 text-sm text-muted-foreground">
          <input name="acceptedTerms" type="checkbox" required className="mt-1 accent-primary" />
          <span>
            I accept the MRC Racing Tips <Link href="/terms/" className="text-brand-cyan underline">terms</Link>,{" "}
            <Link href="/privacy/" className="text-brand-cyan underline">privacy policy</Link>,{" "}
            <Link href="/refund-policy/" className="text-brand-cyan underline">refund policy</Link>,{" "}
            <Link href="/cancellation-policy/" className="text-brand-cyan underline">cancellation policy</Link>, and{" "}
            <Link href="/responsible-gambling/" className="text-brand-cyan underline">responsible gambling guidance</Link>.
          </span>
        </label>
        <CaptchaField
          ref={turnstileRef}
          action="register"
          onTokenChange={setCaptchaToken}
        />
        <Button
          type="submit"
          className="w-full"
          disabled={isSubmitting || !turnstileSiteKey || !captchaToken}
        >
          {isSubmitting ? (
            <>
              <Loader2 className="size-4 animate-spin" />
              Creating account
            </>
          ) : (
            "Create account"
          )}
        </Button>
        <p className="text-sm text-muted-foreground">
          Already registered?{" "}
          <Link href="/login" className="text-primary hover:underline">
            Login
          </Link>
        </p>
      </form>

      <Dialog open={isDialogOpen}>
        <DialogContent showCloseButton={false}>
          <DialogHeader>
            <div
              className={`flex size-10 items-center justify-center rounded-full ${
                formState.kind === "error"
                  ? "bg-brand-red/15 text-brand-red"
                  : formState.kind === "existing"
                    ? "bg-brand-gold/15 text-brand-gold"
                  : "bg-brand-cyan/15 text-brand-cyan"
              }`}
            >
              {formState.kind === "error" ? (
                <AlertCircle className="size-5" />
              ) : (
                <CheckCircle2 className="size-5" />
              )}
            </div>
            <DialogTitle>
              {formState.kind === "error"
                ? "Registration failed"
                : formState.kind === "existing"
                  ? "Check your existing account"
                  : "Registration successful"}
            </DialogTitle>
            <DialogDescription>{formState.message}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            {formState.kind === "existing" ? (
              <>
                <Button asChild variant="outline">
                  <Link href="/forgot-password/">Reset password</Link>
                </Button>
                <Button asChild>
                  <Link href="/login/">Go to login</Link>
                </Button>
              </>
            ) : (
              <Button type="button" onClick={handleDialogConfirmation}>
                {formState.kind === "error" ? "Try again" : "Continue"}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
