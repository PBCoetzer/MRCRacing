import { AnalyticsConsent } from "@/components/analytics-consent";

export function Providers({ children }: { children: React.ReactNode }) {
  return <>{children}<AnalyticsConsent /></>;
}
