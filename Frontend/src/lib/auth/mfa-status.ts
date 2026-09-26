import type { AuthenticatorLevel } from "@/lib/auth/mfa-routing";

type MfaProfileStatusOptions = {
  currentLevel: AuthenticatorLevel;
  verifiedFactorCount: number;
  required: boolean;
};

export function resolveMfaVerificationError(error: unknown) {
  const fallback = "The authenticator code could not be verified.";
  const originalMessage = error instanceof Error ? error.message : fallback;

  if (/invalid totp code/i.test(originalMessage)) {
    return {
      invalidCode: true,
      message:
        "That code did not match this QR code. On the authenticator device, enable automatic date/time and time zone, select the newest MRC Racing Tips entry, wait for a fresh code, and enter it before it changes. If it still fails, generate a new QR code below.",
    };
  }

  return { invalidCode: false, message: originalMessage };
}

export function resolveMfaProfileStatus({
  currentLevel,
  verifiedFactorCount,
  required,
}: MfaProfileStatusOptions) {
  if (verifiedFactorCount === 0) {
    return {
      badge: required ? "Required" : "Not enabled",
      action: "Enable 2FA",
      description: required
        ? "Set up an authenticator app before using administrator and payment controls."
        : "Add an authenticator app to protect this account from password or email compromise.",
      protected: false,
    };
  }

  if (currentLevel === "aal2") {
    return {
      badge: "Enabled · browser verified",
      action: "Manage 2FA",
      description:
        "This browser session remains verified until sign-out, session expiry, or an account-security event.",
      protected: true,
    };
  }

  return {
    badge: "Enabled · verification required",
    action: "Verify this browser",
    description: "Enter a current authenticator code to finish verifying this browser session.",
    protected: false,
  };
}
