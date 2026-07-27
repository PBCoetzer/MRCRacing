"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useRef, useState } from "react";
import { Turnstile, type TurnstileInstance } from "@marsidev/react-turnstile";
import { AlertCircle, CheckCircle2, Loader2, ShieldCheck } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
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
import { createClient } from "@/lib/supabase/client";
import { supabaseConfigMessage } from "@/lib/supabase/config";
import { getSiteUrl } from "@/lib/site-url";

type FormState = {
  kind: "idle" | "success" | "error";
  message: string;
};

export function RegisterForm() {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const turnstileRef = useRef<TurnstileInstance>(null);
  const turnstileSiteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? "";
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
          emailRedirectTo: `${getSiteUrl()}/login/`,
          captchaToken,
          data: {
            accepted_terms: acceptedTerms,
            confirmed_over_18: confirmedOver18,
            display_name: displayName,
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
        <div className="grid gap-2">
          <Label htmlFor="name">Display name</Label>
          <Input id="name" name="displayName" placeholder="Your name" required />
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
          I accept the MRC Racing Tips terms, privacy policy, and responsible gambling guidance.
        </label>
        {turnstileSiteKey ? (
          <div className="rounded-lg border border-brand-cyan/25 bg-background/60 p-3">
            <div className="mb-2 flex items-center gap-2 text-sm font-semibold">
              <ShieldCheck className="size-4 text-brand-cyan" />
              Human verification
            </div>
            <Turnstile
              ref={turnstileRef}
              siteKey={turnstileSiteKey}
              options={{ action: "register", size: "flexible", theme: "dark" }}
              onSuccess={setCaptchaToken}
              onExpire={() => setCaptchaToken("")}
              onError={() => setCaptchaToken("")}
            />
          </div>
        ) : (
          <Alert variant="destructive">
            <AlertCircle className="size-4" />
            <AlertTitle>Registration temporarily unavailable</AlertTitle>
            <AlertDescription>
              Human verification must be configured before new accounts can be created.
            </AlertDescription>
          </Alert>
        )}
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
              {formState.kind === "error" ? "Registration failed" : "Registration successful"}
            </DialogTitle>
            <DialogDescription>{formState.message}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" onClick={handleDialogConfirmation}>
              {formState.kind === "error" ? "Try again" : "Continue"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
