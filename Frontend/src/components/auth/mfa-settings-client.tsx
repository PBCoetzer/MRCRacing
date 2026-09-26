"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  CheckCircle2,
  Clipboard,
  KeyRound,
  Loader2,
  Plus,
  RefreshCcw,
  ShieldCheck,
  Smartphone,
  Trash2,
} from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { safeInternalDestination } from "@/lib/auth/mfa-routing";
import { resolveMfaVerificationError } from "@/lib/auth/mfa-status";
import { createClient } from "@/lib/supabase/client";

type TotpFactor = {
  id: string;
  friendly_name?: string;
  factor_type: "totp";
  status: "verified" | "unverified";
  created_at: string;
  updated_at: string;
};

type Enrollment = {
  factorId: string;
  qrCode: string;
  secret: string;
};

type BrowserSupabaseClient = NonNullable<ReturnType<typeof createClient>>;

function qrCodeSource(value: string) {
  return value.startsWith("data:")
    ? value
    : `data:image/svg+xml;utf-8,${encodeURIComponent(value)}`;
}

function factorName(factor: TotpFactor, index: number) {
  return factor.friendly_name?.trim() || `Authenticator app ${index + 1}`;
}

export function MfaSettingsClient() {
  const router = useRouter();
  const [requestedMode] = useState<"challenge" | "setup" | null>(() => {
    if (typeof window === "undefined") return null;
    const mode = new URLSearchParams(window.location.search).get("mode");
    return mode === "challenge" || mode === "setup" ? mode : null;
  });
  const [nextDestination] = useState(() => {
    if (typeof window === "undefined") return "/account/security/";
    return safeInternalDestination(
      new URLSearchParams(window.location.search).get("next"),
      "/account/security/",
    );
  });
  const [factors, setFactors] = useState<TotpFactor[]>([]);
  const [selectedFactorId, setSelectedFactorId] = useState("");
  const [currentLevel, setCurrentLevel] = useState<string | null>(null);
  const [isAdministrator, setIsAdministrator] = useState(false);
  const [enrollment, setEnrollment] = useState<Enrollment | null>(null);
  const [unfinishedFactorIds, setUnfinishedFactorIds] = useState<string[]>([]);
  const [verificationCode, setVerificationCode] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const verifiedFactors = useMemo(
    () => factors.filter((factor) => factor.status === "verified"),
    [factors],
  );

  const loadSecurityState = useCallback(async () => {
    const supabase = createClient();
    if (!supabase) {
      setError("Account security is temporarily unavailable.");
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser();
      if (userError) throw userError;
      if (!user) throw new Error("Please log in to manage two-factor authentication.");

      const [factorResult, assuranceResult, roleResult] = await Promise.all([
        supabase.auth.mfa.listFactors(),
        supabase.auth.mfa.getAuthenticatorAssuranceLevel(),
        supabase.from("user_roles").select("role").eq("user_id", user.id),
      ]);

      if (factorResult.error) throw factorResult.error;
      if (assuranceResult.error) throw assuranceResult.error;
      if (roleResult.error) throw roleResult.error;

      const totpFactors = (factorResult.data.all as TotpFactor[]).filter(
        (factor) => factor.factor_type === "totp",
      );
      const verified = totpFactors.filter(
        (factor: TotpFactor) => factor.status === "verified",
      );

      setFactors(totpFactors);
      setUnfinishedFactorIds(
        totpFactors
          .filter((factor) => factor.status === "unverified")
          .map((factor) => factor.id),
      );
      setCurrentLevel(assuranceResult.data.currentLevel);
      setIsAdministrator(
        (roleResult.data ?? []).some((row: { role: string }) => row.role === "administrator"),
      );
      setSelectedFactorId((current) =>
        verified.some((factor) => factor.id === current) ? current : (verified[0]?.id ?? ""),
      );
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Account security could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => void loadSecurityState(), 0);
    return () => window.clearTimeout(timeoutId);
  }, [loadSecurityState]);

  async function enrollNewFactor(supabase: BrowserSupabaseClient) {
    const { data, error: enrollmentError } = await supabase.auth.mfa.enroll({
      factorType: "totp",
      friendlyName:
        verifiedFactors.length > 0
          ? `MRC backup authenticator ${verifiedFactors.length + 1}`
          : "MRC primary authenticator",
      issuer: "MRC Racing Tips",
    });
    if (enrollmentError) throw enrollmentError;

    setEnrollment({
      factorId: data.id,
      qrCode: qrCodeSource(data.totp.qr_code),
      secret: data.totp.secret,
    });
    setVerificationCode("");
  }

  async function startEnrollment() {
    const supabase = createClient();
    if (!supabase) return;

    setBusy("enroll");
    setError("");
    setMessage("");
    try {
      const factorResult = await supabase.auth.mfa.listFactors();
      if (factorResult.error) throw factorResult.error;

      const totpFactors = (factorResult.data.all as TotpFactor[]).filter(
        (factor) => factor.factor_type === "totp",
      );
      const unfinishedIds = totpFactors
        .filter((factor) => factor.status === "unverified")
        .map((factor) => factor.id);

      setFactors(totpFactors);
      setUnfinishedFactorIds(unfinishedIds);
      if (unfinishedIds.length > 0) {
        return;
      }

      await enrollNewFactor(supabase);
    } catch (enrollmentError) {
      setError(
        enrollmentError instanceof Error
          ? enrollmentError.message
          : "Two-factor enrollment could not be started.",
      );
    } finally {
      setBusy("");
    }
  }

  async function replaceUnfinishedEnrollment() {
    const supabase = createClient();
    if (!supabase || unfinishedFactorIds.length === 0) return;

    const notificationText =
      unfinishedFactorIds.length === 1
        ? "Supabase will send a security email confirming that this unfinished verification method was removed."
        : `Supabase may send a security email for each of the ${unfinishedFactorIds.length} unfinished verification methods removed.`;
    if (
      !window.confirm(
        `Remove the unfinished authenticator setup and generate a fresh QR code? ${notificationText}`,
      )
    ) {
      return;
    }

    setBusy("replace-unfinished");
    setError("");
    setMessage("");
    try {
      for (const factorId of unfinishedFactorIds) {
        const { error: removalError } = await supabase.auth.mfa.unenroll({ factorId });
        if (removalError) throw removalError;
      }

      setFactors((current) =>
        current.filter((factor) => !unfinishedFactorIds.includes(factor.id)),
      );
      setUnfinishedFactorIds([]);
      await enrollNewFactor(supabase);
      setMessage(
        "The unfinished setup was removed and a fresh QR code was generated. The security email confirms that requested removal.",
      );
    } catch (replacementError) {
      setError(
        replacementError instanceof Error
          ? replacementError.message
          : "The unfinished authenticator setup could not be replaced.",
      );
      await loadSecurityState();
    } finally {
      setBusy("");
    }
  }

  async function verifyFactor(factorId: string, successMessage: string) {
    const supabase = createClient();
    if (!supabase) return;
    if (!/^\d{6,8}$/.test(verificationCode)) {
      setError("Enter the 6-digit code shown in your authenticator app.");
      return;
    }

    setBusy("verify");
    setError("");
    setMessage("");
    try {
      const { error: verificationError } = await supabase.auth.mfa.challengeAndVerify({
        factorId,
        code: verificationCode,
      });
      if (verificationError) throw verificationError;

      setEnrollment(null);
      setVerificationCode("");
      setMessage(successMessage);
      await loadSecurityState();

      if (nextDestination !== "/account/security/") {
        router.replace(nextDestination);
        router.refresh();
      }
    } catch (verificationError) {
      const resolvedError = resolveMfaVerificationError(verificationError);
      if (resolvedError.invalidCode) setVerificationCode("");
      setError(resolvedError.message);
    } finally {
      setBusy("");
    }
  }

  async function restartEnrollment() {
    const supabase = createClient();
    if (!supabase || !enrollment) return;
    if (
      !window.confirm(
        "Generate a new QR code? This removes the current unfinished verification method, and Supabase will send a security email confirming that removal.",
      )
    ) {
      return;
    }

    setBusy("restart");
    setError("");
    setMessage("");
    try {
      const { error: removalError } = await supabase.auth.mfa.unenroll({
        factorId: enrollment.factorId,
      });
      if (removalError) throw removalError;
      setEnrollment(null);
      await enrollNewFactor(supabase);
      setMessage(
        "A new QR code was generated. The security email confirms removal of the previous unfinished setup. Remove the old MRC entry from your authenticator app and scan this one.",
      );
    } catch (restartError) {
      setError(
        restartError instanceof Error
          ? restartError.message
          : "A new authenticator QR code could not be generated.",
      );
    } finally {
      setBusy("");
    }
  }

  async function cancelEnrollment() {
    const supabase = createClient();
    if (!supabase || !enrollment) return;
    if (
      !window.confirm(
        "Cancel and remove this unfinished authenticator setup? Supabase will send a security email confirming that removal.",
      )
    ) {
      return;
    }
    setBusy("cancel");
    setError("");
    const { error: cancelError } = await supabase.auth.mfa.unenroll({
      factorId: enrollment.factorId,
    });
    if (cancelError) setError(cancelError.message);
    else {
      setEnrollment(null);
      setVerificationCode("");
      await loadSecurityState();
    }
    setBusy("");
  }

  async function removeFactor(factorId: string) {
    const supabase = createClient();
    if (!supabase) return;
    if (currentLevel !== "aal2") {
      setError("Verify an authenticator code in this session before removing a device.");
      return;
    }
    if (isAdministrator && verifiedFactors.length <= 1) {
      setError("Administrators must add and verify a backup factor before removing this device.");
      return;
    }
    if (
      !window.confirm(
        "Remove this authenticator device? Supabase will send a security email confirming the removal.",
      )
    ) {
      return;
    }

    setBusy(`remove:${factorId}`);
    setError("");
    setMessage("");
    const { error: removeError } = await supabase.auth.mfa.unenroll({ factorId });
    if (removeError) setError(removeError.message);
    else {
      await supabase.auth.refreshSession();
      setMessage("Authenticator removed from this account.");
      await loadSecurityState();
    }
    setBusy("");
  }

  async function copySecret() {
    if (!enrollment) return;
    try {
      await navigator.clipboard.writeText(enrollment.secret);
      setMessage("Setup key copied. Keep it private.");
    } catch {
      setError("The setup key could not be copied. Select and copy it manually.");
    }
  }

  if (loading) {
    return (
      <Card>
        <CardContent className="flex min-h-52 items-center justify-center gap-2">
          <Loader2 className="size-5 animate-spin" />
          Loading account security…
        </CardContent>
      </Card>
    );
  }

  const needsChallenge = currentLevel !== "aal2" && verifiedFactors.length > 0;
  const requiresSetup =
    currentLevel !== "aal2" && verifiedFactors.length === 0 &&
    (requestedMode === "setup" || isAdministrator);

  return (
    <div className="space-y-6">
      {error ? (
        <Alert variant="destructive">
          <AlertTitle>Security action failed</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      {message ? (
        <Alert>
          <CheckCircle2 className="size-4" />
          <AlertTitle>Security updated</AlertTitle>
          <AlertDescription>{message}</AlertDescription>
        </Alert>
      ) : null}
      {requiresSetup ? (
        <Alert variant="destructive">
          <ShieldCheck className="size-4" />
          <AlertTitle>Administrator 2FA setup required</AlertTitle>
          <AlertDescription>
            Administrator and payment-management access requires a verified authenticator app.
            Set it up below before continuing.
          </AlertDescription>
        </Alert>
      ) : needsChallenge ? (
        <Alert>
          <KeyRound className="size-4" />
          <AlertTitle>Two-factor verification required</AlertTitle>
          <AlertDescription>
            Enter a current code from one of your enrolled authenticator apps to finish signing in.
          </AlertDescription>
        </Alert>
      ) : currentLevel === "aal2" ? (
        <Alert>
          <ShieldCheck className="size-4" />
          <AlertTitle>Two-factor session verified</AlertTitle>
          <AlertDescription>
            This browser session is authenticated at AAL2 and remains verified until sign-out,
            session expiry, or an account-security event invalidates it.
          </AlertDescription>
        </Alert>
      ) : null}

      {needsChallenge ? (
        <Card className="border-brand-gold/35">
          <CardHeader>
            <CardTitle>Verify your authenticator</CardTitle>
            <CardDescription>
              Codes refresh every 30 seconds and can be used only once. Successful verification
              is remembered for this signed-in browser session.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {verifiedFactors.length > 1 ? (
              <div className="grid gap-2">
                <Label htmlFor="mfa-factor">Authenticator device</Label>
                <select
                  id="mfa-factor"
                  value={selectedFactorId}
                  onChange={(event) => setSelectedFactorId(event.target.value)}
                  className="h-10 rounded-md border border-input bg-input/30 px-3 text-sm text-foreground"
                >
                  {verifiedFactors.map((factor, index) => (
                    <option key={factor.id} value={factor.id}>
                      {factorName(factor, index)}
                    </option>
                  ))}
                </select>
              </div>
            ) : null}
            <div className="grid gap-2">
              <Label htmlFor="mfa-challenge-code">Authenticator code</Label>
              <Input
                id="mfa-challenge-code"
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="[0-9]*"
                maxLength={8}
                value={verificationCode}
                onChange={(event) => setVerificationCode(event.target.value.replace(/\D/g, ""))}
                placeholder="123456"
              />
            </div>
            <Button
              disabled={busy === "verify" || !selectedFactorId}
              onClick={() => void verifyFactor(selectedFactorId, "Two-factor sign-in completed.")}
            >
              {busy === "verify" ? <Loader2 className="size-4 animate-spin" /> : <KeyRound className="size-4" />}
              Verify and continue
            </Button>
          </CardContent>
        </Card>
      ) : null}

      {!enrollment && !needsChallenge && unfinishedFactorIds.length > 0 ? (
        <Card className="border-brand-gold/45">
          <CardHeader>
            <CardTitle>Unfinished authenticator setup found</CardTitle>
            <CardDescription>
              A previous QR-code setup was started but never verified. MRC will not remove it
              automatically. Removing it is required before a fresh QR code can be generated.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Alert>
              <ShieldCheck className="size-4" />
              <AlertTitle>Security email expected</AlertTitle>
              <AlertDescription>
                Supabase sends “A verification method was removed from your account” whenever an
                unfinished or verified authenticator factor is deleted. This is a genuine security
                notification, not a registration or account error.
              </AlertDescription>
            </Alert>
            <Button
              variant="outline"
              disabled={Boolean(busy)}
              onClick={() => void replaceUnfinishedEnrollment()}
            >
              {busy === "replace-unfinished" ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <RefreshCcw className="size-4" />
              )}
              Remove unfinished setup and generate new QR
            </Button>
          </CardContent>
        </Card>
      ) : null}

      {enrollment ? (
        <Card className="border-brand-cyan/45">
          <CardHeader>
            <CardTitle>Connect an authenticator app</CardTitle>
            <CardDescription>
              Scan this QR code with Google Authenticator, Microsoft Authenticator, Authy,
              1Password, or another TOTP-compatible app.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <Alert>
              <Smartphone className="size-4" />
              <AlertTitle>Use the newest code</AlertTitle>
              <AlertDescription>
                Enable automatic date, time, and time zone on the device running your
                authenticator app. If the app already contains an MRC entry, remove the old
                entry before scanning this QR code. Wait for a fresh code and submit it well
                before it changes.
              </AlertDescription>
            </Alert>
            <div className="w-fit rounded-xl bg-white p-4">
              <Image
                src={enrollment.qrCode}
                alt="QR code for MRC Racing Tips two-factor authentication"
                width={240}
                height={240}
                unoptimized
              />
            </div>
            <div className="space-y-2">
              <Label>Manual setup key</Label>
              <div className="flex flex-col gap-2 sm:flex-row">
                <code className="min-w-0 flex-1 break-all rounded-md border bg-background/60 p-3 text-sm">
                  {enrollment.secret}
                </code>
                <Button type="button" variant="outline" onClick={() => void copySecret()}>
                  <Clipboard className="size-4" />
                  Copy key
                </Button>
              </div>
            </div>
            <div className="grid max-w-sm gap-2">
              <Label htmlFor="mfa-enrollment-code">Code from the app</Label>
              <Input
                id="mfa-enrollment-code"
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="[0-9]*"
                maxLength={8}
                value={verificationCode}
                onChange={(event) => setVerificationCode(event.target.value.replace(/\D/g, ""))}
                placeholder="123456"
              />
            </div>
            <div className="flex flex-wrap gap-3">
              <Button
                disabled={Boolean(busy)}
                onClick={() => void verifyFactor(enrollment.factorId, "Two-factor authentication is now active.")}
              >
                {busy === "verify" ? <Loader2 className="size-4 animate-spin" /> : <ShieldCheck className="size-4" />}
                Verify and enable 2FA
              </Button>
              <Button
                variant="outline"
                disabled={Boolean(busy)}
                onClick={() => void cancelEnrollment()}
              >
                Cancel and remove setup
              </Button>
              <Button
                variant="outline"
                disabled={Boolean(busy)}
                onClick={() => void restartEnrollment()}
              >
                {busy === "restart" ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <RefreshCcw className="size-4" />
                )}
                Generate new QR code
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Smartphone className="size-5 text-brand-cyan" />
            Authenticator devices
          </CardTitle>
          <CardDescription>
            2FA is optional for clients, tipsters, and blog authors, and mandatory for
            administrators. Once enabled, it is required for later private account actions.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {verifiedFactors.map((factor, index) => (
            <div
              key={factor.id}
              className="flex flex-col gap-3 rounded-lg border p-4 sm:flex-row sm:items-center sm:justify-between"
            >
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium text-white">{factorName(factor, index)}</span>
                  <Badge variant="outline">Verified</Badge>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  Added {new Date(factor.created_at).toLocaleString("en-ZA")}
                </p>
              </div>
              <Button
                variant="outline"
                disabled={busy === `remove:${factor.id}`}
                onClick={() => void removeFactor(factor.id)}
              >
                {busy === `remove:${factor.id}` ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Trash2 className="size-4" />
                )}
                Remove
              </Button>
            </div>
          ))}
          {!verifiedFactors.length ? (
            <p className="text-sm text-muted-foreground">No authenticator app is connected yet.</p>
          ) : null}
          {!enrollment && !needsChallenge ? (
            <Button variant="outline" disabled={busy === "enroll"} onClick={() => void startEnrollment()}>
              {busy === "enroll" ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
              {verifiedFactors.length ? "Add backup authenticator" : "Set up authenticator app"}
            </Button>
          ) : null}
          <p className="text-xs leading-5 text-muted-foreground">
            Supabase does not issue recovery codes. Add a backup authenticator on a separate
            device before replacing or losing your primary device. Never share a setup key or
            one-time code with MRC support.
          </p>
          <p className="text-xs leading-5 text-muted-foreground">
            MRC relies on the authenticated Supabase session instead of creating a permanent
            trusted-device bypass. You will not be asked again on every page, but signing out,
            session expiry, or an account-security change requires another code.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
