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
import {
  CaptchaField,
  isCaptchaChallengeError,
  turnstileSiteKey,
} from "@/components/auth/captcha-field";
import { createClient } from "@/lib/supabase/client";
import { supabaseConfigMessage } from "@/lib/supabase/config";
import { getSiteUrl } from "@/lib/site-url";
import { EMAIL_MARKETING_CONSENT_VERSION } from "@/lib/email-marketing-consent";
import {
  isExistingRegistrationError,
  isRegistrationEmailRateLimitError,
} from "@/lib/auth/registration-errors";

type FormState = {
  kind: "idle" | "success" | "existing" | "uncertain" | "error";
  message: string;
};

export function RegisterForm() {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const submitLockRef = useRef(false);
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

    const currentCaptchaToken = turnstileRef.current?.getResponse() || captchaToken;

    if (!currentCaptchaToken || turnstileRef.current?.isExpired() === true) {
      resetCaptcha();
      showResult(
        "error",
        "Human verification expired and has been refreshed. Please complete it again before registering.",
      );
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
    const emailMarketingChoice = String(formData.get("emailMarketingChoice") ?? "");
    const acceptedEmailAnnouncements = emailMarketingChoice === "yes";

    if (!acceptedTerms || !confirmedOver18 || !["yes", "no"].includes(emailMarketingChoice)) {
      showResult(
        "error",
        "Please accept the platform terms, confirm the age declaration, and choose your email preference.",
      );
      return;
    }

    if (submitLockRef.current) {
      return;
    }

    submitLockRef.current = true;
    setIsSubmitting(true);
    setFormState({ kind: "idle", message: "" });

    try {
      const { data: currentTermsVersion, error: termsVersionError } = await supabase.rpc(
        "get_current_premium_terms_version",
      );

      if (termsVersionError || typeof currentTermsVersion !== "string" || !currentTermsVersion) {
        throw new Error("The current Terms version could not be verified. Please try again.");
      }

      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          emailRedirectTo: `${getSiteUrl()}/auth/callback/`,
          captchaToken: currentCaptchaToken,
          data: {
            accepted_terms: acceptedTerms,
            accepted_terms_version: currentTermsVersion,
            confirmed_over_18: confirmedOver18,
            email_marketing_consent: acceptedEmailAnnouncements,
            email_marketing_consent_version: EMAIL_MARKETING_CONSENT_VERSION,
            first_name: firstName,
            last_name: lastName,
            display_name: displayName || `${firstName} ${lastName}`,
            phone,
          },
        },
      });

      if (error) {
        if (isExistingRegistrationError(error)) {
          resetCaptcha();
          setRedirectAfterConfirmation(false);
          showResult(
            "existing",
            "An account may already use this email. To protect account privacy, log in or reset the password instead of registering again.",
          );
          return;
        }

        if (isRegistrationEmailRateLimitError(error)) {
          resetCaptcha();
          setRedirectAfterConfirmation(false);
          showResult(
            "uncertain",
            "A confirmation request was made recently. Check your inbox and spam folder before trying again. If the account is already confirmed, go to login or reset the password.",
          );
          return;
        }

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

      if (isCaptchaChallengeError(error)) {
        setRedirectAfterConfirmation(false);
        showResult(
          "uncertain",
          "The registration response could not be confirmed because human verification expired or was already used. If a confirmation email arrived, your account was created: open the email, then log in. If no email arrived, complete the refreshed verification and try once more.",
        );
      } else {
        showResult(
          "error",
          error instanceof Error
            ? error.message
            : "Registration failed. Please try again.",
        );
      }
    } finally {
      submitLockRef.current = false;
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
          <input name="acceptedTerms" type="checkbox" required className="mt-1 accent-primary" />
          <span>
            I accept the MRC Racing Tips <Link href="/terms/" className="text-brand-cyan underline">terms</Link>,{" "}
            <Link href="/privacy/" className="text-brand-cyan underline">privacy policy</Link>,{" "}
            <Link href="/refund-policy/" className="text-brand-cyan underline">refund policy</Link>,{" "}
            and <Link href="/cancellation-policy/" className="text-brand-cyan underline">cancellation policy</Link>.
            I understand that paid meeting-card content is licensed personally, may be
            visibly watermarked, and may not be shared, republished, or resold.
          </span>
        </label>
        <label className="flex items-start gap-3 rounded-lg border border-brand-gold/25 bg-background/60 p-3 text-sm text-muted-foreground">
          <input name="confirmedOver18" type="checkbox" required className="mt-1 accent-primary" />
          <span>I confirm that I am 18 years old or older.</span>
        </label>
        <fieldset className="grid gap-3 rounded-lg border border-brand-cyan/30 bg-brand-cyan/5 p-3 text-sm text-muted-foreground">
          <legend className="px-1 font-medium text-foreground">Optional email announcements</legend>
          <p>
            Choose whether MRC Racing Tips may email you about new meeting cards, blog posts,
            platform news, and similar services. This choice does not affect account or purchase
            emails and can be changed later from your client profile.
          </p>
          <label className="flex items-start gap-3 rounded-md border bg-background/50 p-3">
            <input
              name="emailMarketingChoice"
              type="radio"
              value="yes"
              required
              className="mt-1 accent-primary"
            />
            <span>Yes, send me optional email announcements.</span>
          </label>
          <label className="flex items-start gap-3 rounded-md border bg-background/50 p-3">
            <input
              name="emailMarketingChoice"
              type="radio"
              value="no"
              required
              className="mt-1 accent-primary"
            />
            <span>No, do not send me optional email announcements.</span>
          </label>
          <p className="text-xs">
            See the <Link href="/privacy/" className="text-brand-cyan underline">privacy policy</Link>{" "}
            for details.
          </p>
        </fieldset>
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
                  : formState.kind === "uncertain"
                    ? "Check your registration"
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
            ) : formState.kind === "uncertain" ? (
              <>
                <Button type="button" variant="outline" onClick={handleDialogConfirmation}>
                  Try again
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
