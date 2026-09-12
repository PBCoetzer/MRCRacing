import Link from "next/link";
import { InfoPage } from "@/components/info-page";
import { businessDetails, publicBusinessLocation } from "@/lib/business-details";

export default function ContactPage() {
  return (
    <InfoPage
      badge="Contact"
      title="Contact MRC Racing Tips"
      description="The right support route for account, payment, privacy, and racing-content enquiries."
      sections={[
        {
          title: "Business details and support",
          body: (
            <div className="space-y-2">
              <p><strong>{businessDetails.legalName}</strong> (registration {businessDetails.registrationNumber}), trading as {businessDetails.tradingName}.</p>
              <p>Business location: {publicBusinessLocation}.</p>
              <p>Email: <a href={`mailto:${businessDetails.supportEmail}`} className="text-brand-cyan underline">{businessDetails.supportEmail}</a><br />Telephone: <a href={businessDetails.telephoneHref} className="text-brand-cyan underline">{businessDetails.telephoneDisplay}</a></p>
            </div>
          ),
        },
        {
          title: "Account and payment support",
          body: <p>Registered clients can sign in to the <Link href="/client/" className="text-brand-cyan underline">client dashboard</Link> to review Payment Status, Credit history, purchases, and submit a purchase dispute, or email <a href={`mailto:${businessDetails.supportEmail}`} className="text-brand-cyan underline">{businessDetails.supportEmail}</a>. Include the payment or purchase reference, date, amount, and a concise explanation. Never send card details, banking credentials, OTPs, or voucher PINs.</p>,
        },
        {
          title: "Privacy and account closure",
          body: <p>Send privacy, correction, access, or account-closure requests to <a href={`mailto:${businessDetails.supportEmail}`} className="text-brand-cyan underline">{businessDetails.supportEmail}</a> from the email address associated with your account. Identity verification may be required before account information is disclosed or changed.</p>,
        },
        {
          title: "Refunds and cancellations",
          body: <p>Review the <Link href="/refund-policy/" className="text-brand-cyan underline">Refund Policy</Link> and <Link href="/cancellation-policy/" className="text-brand-cyan underline">Cancellation Policy</Link> first. Individual meeting-card refunds triggered by withdrawal, cancellation, or abandonment are recorded in the platform ledger. Subscription refunds require a client request and review.</p>,
        },
      ]}
    />
  );
}
