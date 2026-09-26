import { AnalyticsConsent } from "@/components/analytics-consent";
import { EmailMarketingConsentPrompt } from "@/components/email-marketing-consent-prompt";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <>
      {children}
      <EmailMarketingConsentPrompt />
      <AnalyticsConsent />
    </>
  );
}
