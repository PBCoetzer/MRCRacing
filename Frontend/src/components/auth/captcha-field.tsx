"use client";

import { forwardRef } from "react";
import { Turnstile, type TurnstileInstance } from "@marsidev/react-turnstile";
import { AlertCircle, ShieldCheck } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

export const turnstileSiteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? "";

type CaptchaFieldProps = {
  action: "forgot_password" | "login" | "register";
  onTokenChange: (token: string) => void;
};

export const CaptchaField = forwardRef<TurnstileInstance, CaptchaFieldProps>(
  function CaptchaField({ action, onTokenChange }, ref) {
    if (!turnstileSiteKey) {
      return (
        <Alert variant="destructive">
          <AlertCircle className="size-4" />
          <AlertTitle>Authentication temporarily unavailable</AlertTitle>
          <AlertDescription>
            Human verification must be configured before this request can be submitted.
          </AlertDescription>
        </Alert>
      );
    }

    return (
      <div className="rounded-lg border border-brand-cyan/25 bg-background/60 p-3">
        <div className="mb-2 flex items-center gap-2 text-sm font-semibold">
          <ShieldCheck className="size-4 text-brand-cyan" />
          Human verification
        </div>
        <Turnstile
          ref={ref}
          siteKey={turnstileSiteKey}
          options={{ action, size: "flexible", theme: "dark" }}
          onSuccess={onTokenChange}
          onExpire={() => onTokenChange("")}
          onError={() => onTokenChange("")}
        />
      </div>
    );
  },
);
