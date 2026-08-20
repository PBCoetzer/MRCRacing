import Link from "next/link";
import { InfoPage } from "@/components/info-page";
import { businessDetails, publicBusinessLocation } from "@/lib/business-details";

export default function TermsPage() {
  return (
    <InfoPage
      badge="Terms"
      title="Terms and conditions"
      description="Terms for accounts, Credits, digital racing content, and participation on MRC Racing Tips. Effective 20 August 2026."
      sections={[
        {
          title: "Website operator",
          body: <p>This website and the MRC Racing Tips service are operated by {businessDetails.legalName} (registration {businessDetails.registrationNumber}), trading as {businessDetails.tradingName}, with its public business location in {publicBusinessLocation}. Support is available at <a href={`mailto:${businessDetails.supportEmail}`} className="text-brand-cyan underline">{businessDetails.supportEmail}</a> or <a href={businessDetails.telephoneHref} className="text-brand-cyan underline">{businessDetails.telephoneDisplay}</a>.</p>,
        },
        {
          title: "Service scope",
          body: <p>MRC Racing Tips provides horse-racing analysis, tipster content, ratings, selections, opinions, factual race information, and result history for informational purposes. MRC does not accept bets, hold betting deposits, or pay gambling winnings.</p>,
        },
        {
          title: "Credits",
          body: <p>Purchased Credits and promotional Reward Credits unlock eligible digital content. They have no cash value, cannot be withdrawn, transferred outside the platform, or used to place bets. Purchased Credits are issued only after a payment provider confirms payment. Reward Credits may be issued through an advertised package or promotion, remain separately recorded, and do not create tipster earnings or horse-care contribution accrual.</p>,
        },
        {
          title: "No guarantee",
          body: <p>Past performance does not guarantee future outcomes. Users make decisions independently and at their own risk. You must be at least 18 years old and comply with the laws that apply to you.</p>,
        },
        {
          title: "Content availability and conduct",
          body: <p>Meeting-card sales close 30 minutes before Race 1. Access to valid purchased and settled cards remains in Card History. Accounts may not scrape, resell, manipulate, harass, impersonate, evade security controls, share credentials, or publish unlawful material.</p>,
        },
        {
          title: "Becoming an MRC Tipster",
          body: <p>A Client does not become a Tipster merely by creating an account. The Client must submit the dedicated Tipster application, provide the required identity and address documents, accept and electronically sign the current Tipster Platform Agreement, and receive administrator approval. The agreement records the applicable MRC platform commission, Horse Care contribution structure, treatment of Purchased and Reward Credits, refunds, content duties, and termination rules. MRC may request corrections, reject an incomplete application, or revoke Tipster access in accordance with the agreement and applicable law.</p>,
        },
        {
          title: "Personal premium-content licence",
          body: <p>Paid meeting cards and selections are licensed to the entitled account for personal, non-transferable use. You may not copy, screenshot for distribution, republish, forward, upload, broadcast, resell, or give another person access to premium selections. Premium views may show a user-specific access code and watermark, and each opening may create an immutable security record. These controls deter and help trace unauthorised sharing; they do not guarantee that every recording method can be technically blocked. MRC may investigate misuse and, subject to applicable law and a fair review, suspend access, revoke affected content access, or pursue available remedies.</p>,
        },
        {
          title: "Payments, refunds, and cancellations",
          body: <p>Provider-confirmed payments, duplicate charges, failed fulfilment, meeting cancellations, refunds, and cancellations are governed by our <Link href="/refund-policy/" className="text-brand-cyan underline">Refund Policy</Link> and <Link href="/cancellation-policy/" className="text-brand-cyan underline">Cancellation Policy</Link>. Nothing in these terms excludes rights that cannot lawfully be excluded.</p>,
        },
      ]}
    />
  );
}
