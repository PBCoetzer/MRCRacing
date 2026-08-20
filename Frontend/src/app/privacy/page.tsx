import Link from "next/link";
import { InfoPage } from "@/components/info-page";
import { businessDetails, publicBusinessLocation } from "@/lib/business-details";

export default function PrivacyPage() {
  return (
    <InfoPage
      badge="Privacy"
      title="Privacy policy"
      description="How MRC Racing Tips collects, uses, safeguards, and shares personal information. Effective 20 August 2026."
      sections={[
        {
          title: "Who is responsible",
          body: <p>{businessDetails.legalName} (registration {businessDetails.registrationNumber}), trading as {businessDetails.tradingName}, operates this website and is responsible for the personal information processed through its accounts, Credits, content purchases, comments, support requests, and administration tools. Its public business location is {publicBusinessLocation}.</p>,
        },
        {
          title: "Information we collect",
          body: <p>We collect information you provide, including your name, display name, email address, telephone number, account role, profile content, comments, support messages, transaction references, Credit ledger entries, purchases, subscriptions, favourites, disputes, terms acceptance, and audit events. A person applying to become a Tipster also provides their legal name, racing experience, identity document, proof of address, electronic signature, and contract acceptance record. When entitled users open premium meeting cards, we record a pseudonymous visible access code, account and card identifiers, access time, accepted terms version, and limited context such as language, screen dimensions, and time zone.</p>,
        },
        {
          title: "Why we use it",
          body: <p>Information is used to create and secure accounts, deliver purchased digital content, maintain Credit balances, process and verify payments, trace unauthorised premium-content sharing, investigate fraud or abuse, provide support, publish approved tipster or blog content, meet legal obligations, and improve the platform. A visible access code can be resolved to the licensed account only by authorised administrators. We do not sell personal information.</p>,
        },
        {
          title: "Payments and service providers",
          body: <p>Card and banking details are entered with an approved payment provider and are not stored by MRC Racing Tips. We retain provider references, amounts, status, and verification records. Supabase provides authentication and database services; approved infrastructure, email, security, and payment providers process only the information required for their role.</p>,
        },
        {
          title: "Retention and security",
          body: <p>Records are retained for as long as needed to provide the service, assess Tipster applications, maintain accurate financial and audit records, resolve disputes, prevent fraud or unauthorised content sharing, and comply with law. Tipster identity and address documents are stored in a private application vault and are available only to the applicant and authorised administrators; they are never published as part of a Tipster profile. Access is role-restricted, protected routes are not indexed, sensitive credentials are kept out of the browser, and payment confirmation is accepted only from verified provider notifications. Premium-card access records are immutable security records and are not displayed publicly.</p>,
        },
        {
          title: "Your choices and rights",
          body: <p>You may request access to, correction of, or deletion of eligible personal information, object to certain processing, withdraw optional analytics consent, or lodge a complaint with South Africa&apos;s Information Regulator. Some transaction, security, and audit records must be retained where law or legitimate fraud-prevention needs require it.</p>,
        },
        {
          title: "Contact and related policies",
          body: <p>Send a privacy request to <a href={`mailto:${businessDetails.supportEmail}`} className="text-brand-cyan underline">{businessDetails.supportEmail}</a>, telephone <a href={businessDetails.telephoneHref} className="text-brand-cyan underline">{businessDetails.telephoneDisplay}</a>, or use the <Link href="/contact/" className="text-brand-cyan underline">contact page</Link>. Payment reversals and service cancellation are explained in the <Link href="/refund-policy/" className="text-brand-cyan underline">Refund Policy</Link> and <Link href="/cancellation-policy/" className="text-brand-cyan underline">Cancellation Policy</Link>.</p>,
        },
      ]}
    />
  );
}
