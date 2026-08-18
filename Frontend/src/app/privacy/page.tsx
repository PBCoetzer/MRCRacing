import Link from "next/link";
import { InfoPage } from "@/components/info-page";

export default function PrivacyPage() {
  return (
    <InfoPage
      badge="Privacy"
      title="Privacy policy"
      description="How MRC Racing Tips collects, uses, safeguards, and shares personal information. Effective 18 August 2026."
      sections={[
        {
          title: "Who is responsible",
          body: <p>MRC Racing Tips operates this website and is responsible for the personal information processed through its accounts, Credits, content purchases, comments, support requests, and administration tools.</p>,
        },
        {
          title: "Information we collect",
          body: <p>We collect information you provide, including your name, display name, email address, telephone number, account role, profile content, comments, support messages, transaction references, Credit ledger entries, purchases, subscriptions, favourites, disputes, and audit events. We also process limited technical information needed for security, fraud prevention, session management, and service reliability.</p>,
        },
        {
          title: "Why we use it",
          body: <p>Information is used to create and secure accounts, deliver purchased digital content, maintain Credit balances, process and verify payments, prevent abuse, provide support, publish approved tipster or blog content, meet legal obligations, and improve the platform. We do not sell personal information.</p>,
        },
        {
          title: "Payments and service providers",
          body: <p>Card and banking details are entered with an approved payment provider and are not stored by MRC Racing Tips. We retain provider references, amounts, status, and verification records. Supabase provides authentication and database services; approved infrastructure, email, security, and payment providers process only the information required for their role.</p>,
        },
        {
          title: "Retention and security",
          body: <p>Records are retained for as long as needed to provide the service, maintain accurate financial and audit records, resolve disputes, prevent fraud, and comply with law. Access is role-restricted, protected routes are not indexed, sensitive credentials are kept out of the browser, and payment confirmation is accepted only from verified provider notifications.</p>,
        },
        {
          title: "Your choices and rights",
          body: <p>You may request access to, correction of, or deletion of eligible personal information, object to certain processing, withdraw optional analytics consent, or lodge a complaint with South Africa&apos;s Information Regulator. Some transaction, security, and audit records must be retained where law or legitimate fraud-prevention needs require it.</p>,
        },
        {
          title: "Contact and related policies",
          body: <p>Send a privacy request through the <Link href="/contact/" className="text-brand-cyan underline">contact page</Link>. Payment reversals and service cancellation are explained in the <Link href="/refund-policy/" className="text-brand-cyan underline">Refund Policy</Link> and <Link href="/cancellation-policy/" className="text-brand-cyan underline">Cancellation Policy</Link>.</p>,
        },
      ]}
    />
  );
}
