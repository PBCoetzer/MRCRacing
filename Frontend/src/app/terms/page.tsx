import Link from "next/link";
import { InfoPage } from "@/components/info-page";
import { businessDetails, registeredOffice } from "@/lib/business-details";

export default function TermsPage() {
  return (
    <InfoPage
      badge="Terms"
      title="Terms and conditions"
      description="Terms for accounts, Credits, digital racing content, and participation on MRC Racing Tips. Effective 18 August 2026."
      sections={[
        {
          title: "Website operator",
          body: <p>This website and the MRC Racing Tips service are operated by {businessDetails.legalName} (registration {businessDetails.registrationNumber}), trading as {businessDetails.tradingName}, from its registered office at {registeredOffice}. Support is available at <a href={`mailto:${businessDetails.supportEmail}`} className="text-brand-cyan underline">{businessDetails.supportEmail}</a> or <a href={businessDetails.telephoneHref} className="text-brand-cyan underline">{businessDetails.telephoneDisplay}</a>.</p>,
        },
        {
          title: "Service scope",
          body: <p>MRC Racing Tips provides horse-racing analysis, tipster content, ratings, selections, opinions, factual race information, and result history for informational purposes. MRC does not accept bets, hold betting deposits, or pay gambling winnings.</p>,
        },
        {
          title: "Credits",
          body: <p>Credits unlock eligible digital content. They have no cash value, cannot be withdrawn, transferred outside the platform, or used to place bets. Credits are issued only after a payment provider confirms payment.</p>,
        },
        {
          title: "No guarantee",
          body: <p>Past performance does not guarantee future outcomes. Users make decisions independently and at their own risk. You must be at least 18 years old and comply with the laws that apply to you.</p>,
        },
        {
          title: "Content availability and conduct",
          body: <p>Meeting-card sales close 30 minutes before Race 1. Access to valid purchased and settled cards remains in Card History. Accounts may not scrape, resell, copy, manipulate, harass, impersonate, evade security controls, or publish unlawful material.</p>,
        },
        {
          title: "Payments, refunds, and cancellations",
          body: <p>Provider-confirmed payments, duplicate charges, failed fulfilment, meeting cancellations, refunds, and cancellations are governed by our <Link href="/refund-policy/" className="text-brand-cyan underline">Refund Policy</Link> and <Link href="/cancellation-policy/" className="text-brand-cyan underline">Cancellation Policy</Link>. Nothing in these terms excludes rights that cannot lawfully be excluded.</p>,
        },
      ]}
    />
  );
}
