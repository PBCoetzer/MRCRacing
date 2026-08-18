import Link from "next/link";
import { InfoPage } from "@/components/info-page";

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
          body: <p>New meeting-card purchases close 30 minutes before Race 1. If a purchased pre-publication card is not published before Race 1, or the meeting is cancelled or abandoned, the platform returns the affected Credits automatically. A reversal is recorded in the customer, tipster, and charity ledgers so the audit history remains accurate.</p>,
        },
        {
          title: "Delivered digital content and subscriptions",
          body: <p>Credits already spent on accessible digital content are normally not refundable merely because selections were unsuccessful or the customer changed their mind after access was supplied. Fixed-term tipster subscriptions do not auto-renew. We will still investigate duplicate fulfilment, material technical failure, misdescription, unauthorised transactions, and any refund right required by South African law.</p>,
        },
        {
          title: "How to request a review",
          body: <p>Use the <Link href="/contact/" className="text-brand-cyan underline">contact page</Link> and include your account email, payment or purchase reference, amount, date, and reason. Do not send card details, banking credentials, OTPs, or voucher PINs. Approved external-payment refunds are returned through the original provider where supported; provider and bank processing times apply.</p>,
        },
        {
          title: "Statutory rights",
          body: <p>This policy does not limit any non-excludable right under the Consumer Protection Act, the Electronic Communications and Transactions Act, or other applicable South African law.</p>,
        },
      ]}
    />
  );
}
