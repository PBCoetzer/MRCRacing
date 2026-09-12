import Link from "next/link";
import { InfoPage } from "@/components/info-page";
import { businessDetails } from "@/lib/business-details";

export default function RefundPolicyPage() {
  return (
    <InfoPage
      badge="Payments"
      title="Refund policy"
      description="Clear treatment of failed payments, unused Credits, digital content, cancelled meetings, and approved refunds. Effective 18 August 2026."
      sections={[
        {
          title: "Before Credits are issued",
          body: <p>A checkout return page never issues Credits. Credits are issued only after MRC receives and validates the payment provider&apos;s server notification. A failed, cancelled, or unconfirmed payment does not create a Credit balance. If your bank shows a debit but MRC remains pending, contact us with the provider reference so it can be reconciled.</p>,
        },
        {
          title: "Duplicate or incorrect charges",
          body: <p>Verified duplicate charges, incorrect amounts, or confirmed payments that did not issue the purchased Credits will be corrected. Depending on the circumstances, this may be by issuing the missing Credits or refunding the affected payment through the original provider.</p>,
        },
        {
          title: "Meeting-card protection",
          body: <p>A meeting card can be purchased individually only after the tipster has published its tips, and purchases close 30 minutes before Race 1. If a paid card is later withdrawn, or its meeting is cancelled or abandoned, the client may request a refund review. Credits are returned only after an administrator approves the request, and the reversal is recorded in the customer, tipster, and charity ledgers.</p>,
        },
        {
          title: "Delivered digital content and subscriptions",
          body: <p>Credits already spent on accessible digital content are normally not refundable merely because selections were unsuccessful or the customer changed their mind after access was supplied. Fixed-term tipster subscriptions do not auto-renew and are not automatically refunded when a meeting has no tips. They remain active for the purchased term unless the client requests a refund review. We will still investigate duplicate fulfilment, material technical failure, misdescription, unauthorised transactions, and any refund right required by South African law.</p>,
        },
        {
          title: "How to request a review",
          body: <p>Use the refund-request control in your Client dashboard, email <a href={`mailto:${businessDetails.supportEmail}`} className="text-brand-cyan underline">{businessDetails.supportEmail}</a>, telephone <a href={businessDetails.telephoneHref} className="text-brand-cyan underline">{businessDetails.telephoneDisplay}</a>, or use the <Link href="/contact/" className="text-brand-cyan underline">contact page</Link>. Include your purchase reference and reason. Do not send card details, banking credentials, OTPs, or voucher PINs. A request does not guarantee a refund; only an administrator approval confirms it.</p>,
        },
        {
          title: "Statutory rights",
          body: <p>This policy does not limit any non-excludable right under the Consumer Protection Act, the Electronic Communications and Transactions Act, or other applicable South African law.</p>,
        },
      ]}
    />
  );
}
