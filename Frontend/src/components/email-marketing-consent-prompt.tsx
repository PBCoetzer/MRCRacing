"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { AuthChangeEvent, Session } from "@supabase/supabase-js";
import { AlertTriangle, Loader2, MailCheck, ShieldCheck } from "lucide-react";
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
import {
  EMAIL_MARKETING_CONSENT_VERSION,
  type EmailMarketingConsentStatus,
  shouldShowEmailMarketingConsentPrompt,
} from "@/lib/email-marketing-consent";
import { createClient } from "@/lib/supabase/client";

function messageFrom(error: unknown) {
  return error instanceof Error
    ? error.message
    : "Your email preference could not be saved. Please try again.";
}

export function EmailMarketingConsentPrompt() {
  const [open, setOpen] = useState(false);
  const [savingChoice, setSavingChoice] = useState<boolean | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    const supabase = createClient();
    if (!supabase) return;

    let mounted = true;

    async function loadConsentStatus(userId?: string) {
      let resolvedUserId = userId;
      if (!resolvedUserId) {
        const { data } = await supabase.auth.getUser();
        resolvedUserId = data.user?.id;
      }

      if (!resolvedUserId) {
        if (mounted) setOpen(false);
        return;
      }

      const { data, error: statusError } = await supabase.rpc(
        "get_email_marketing_consent_status",
      );

      if (!mounted) return;
      if (statusError) {
        setOpen(false);
        return;
      }

      const status = data as EmailMarketingConsentStatus | null;
      setOpen(shouldShowEmailMarketingConsentPrompt(status));
    }

    void loadConsentStatus();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event: AuthChangeEvent, session: Session | null) => {
      if (!session) {
        setOpen(false);
        return;
      }

      window.setTimeout(() => {
        void loadConsentStatus(session.user.id);
      }, 0);
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, []);

  async function saveChoice(enabled: boolean) {
    const supabase = createClient();
    if (!supabase) {
      setError("The secure preference service is not configured.");
      return;
    }

    setSavingChoice(enabled);
    setError("");

    try {
      const { error: preferenceError } = await supabase.rpc(
        "respond_to_email_marketing_consent_prompt",
        {
          p_enabled: enabled,
          p_consent_version: EMAIL_MARKETING_CONSENT_VERSION,
        },
      );
      if (preferenceError) throw preferenceError;
      setOpen(false);
    } catch (preferenceError) {
      setError(messageFrom(preferenceError));
    } finally {
      setSavingChoice(null);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => nextOpen && setOpen(true)}>
      <DialogContent
        showCloseButton={false}
        className="max-h-[calc(100vh-2rem)] overflow-y-auto sm:max-w-lg"
        onEscapeKeyDown={(event) => event.preventDefault()}
        onPointerDownOutside={(event) => event.preventDefault()}
      >
        <DialogHeader>
          <div className="flex size-11 items-center justify-center rounded-full bg-brand-cyan/10 text-brand-cyan">
            <ShieldCheck className="size-6" />
          </div>
          <DialogTitle className="font-heading text-xl text-white">
            Privacy and email preference update
          </DialogTitle>
          <DialogDescription>
            We have improved how MRC Racing Tips records optional marketing consent to better
            align with POPIA and the Information Regulator&apos;s direct-marketing guidance.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 text-sm text-muted-foreground">
          <p>
            Please choose whether you want emails about new meeting cards, blog posts, platform
            news, and similar MRC Racing services.
          </p>
          <div className="rounded-lg border border-brand-cyan/25 bg-brand-cyan/5 p-3">
            <div className="flex gap-3">
              <MailCheck className="mt-0.5 size-5 shrink-0 text-brand-cyan" />
              <div className="space-y-2">
                <p>Your choice is optional and will not affect access to your account.</p>
                <p>
                  Purchase receipts, security alerts, password emails, and essential account
                  notices are separate from marketing announcements.
                </p>
              </div>
            </div>
          </div>
          <p>
            You can change this choice free of charge at any time from your client profile. Read
            our <Link href="/privacy/" className="text-brand-cyan underline">privacy policy</Link>{" "}
            for more information.
          </p>
        </div>

        {error ? (
          <Alert variant="destructive">
            <AlertTriangle className="size-4" />
            <AlertTitle>Preference not saved</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}

        <DialogFooter className="sm:justify-between">
          <Button
            type="button"
            variant="outline"
            disabled={savingChoice !== null}
            onClick={() => void saveChoice(false)}
          >
            {savingChoice === false ? <Loader2 className="size-4 animate-spin" /> : null}
            No, do not send announcements
          </Button>
          <Button
            type="button"
            disabled={savingChoice !== null}
            onClick={() => void saveChoice(true)}
          >
            {savingChoice === true ? <Loader2 className="size-4 animate-spin" /> : <MailCheck className="size-4" />}
            Yes, send me announcements
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
