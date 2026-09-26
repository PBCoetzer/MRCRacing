export const EMAIL_MARKETING_CONSENT_VERSION = "2026-09-16-email-announcements";

export type EmailMarketingConsentStatus = {
  enabled: boolean;
  confirmedAt: string | null;
  consentVersion: string | null;
  consentSource: string | null;
  currentVersion: string;
  requiresConfirmation: boolean;
};

export function shouldShowEmailMarketingConsentPrompt(
  status: EmailMarketingConsentStatus | null,
) {
  if (!status?.requiresConfirmation) {
    return false;
  }

  return !status.confirmedAt || status.consentVersion !== status.currentVersion;
}
