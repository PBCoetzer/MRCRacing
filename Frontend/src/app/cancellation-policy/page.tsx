import Link from "next/link";
import { InfoPage } from "@/components/info-page";

export default function CancellationPolicyPage() {
  return (
    <InfoPage
      badge="Payments"
      title="Cancellation policy"
      description="How checkout cancellation, fixed-term subscriptions, meeting changes, and account closure are handled. Effective 18 August 2026."
      sections={[
        {
          title: "Checkout cancellation",
          body: <p>You may leave or cancel a provider checkout before payment is confirmed. No Credits are issued for a cancelled or unconfirmed checkout. Do not repeat a checkout while your bank is still processing the first attempt; check Payment Status or contact support first.</p>,
        },
        {
          title: "Tipster subscriptions",
          body: <p>MRC tipster subscriptions are prepaid for the selected fixed term and do not renew automatically. They therefore require no recurring-payment cancellation. Access ends on the recorded end date unless it is lawfully refunded or revoked for a terms breach.</p>,
        },
        {
          title: "Meeting cards",
          body: <p>Purchases close 30 minutes before Race 1. Customers cannot cancel a card after its premium digital content has been supplied merely because the selections later lose. If the card is never published before Race 1, or the meeting is cancelled or abandoned, the automatic Credit-return rules in the <Link href="/refund-policy/" className="text-brand-cyan underline">Refund Policy</Link> apply.</p>,
        },
        {
          title: "Account closure",
          body: <p>You may request account closure through the <Link href="/contact/" className="text-brand-cyan underline">contact page</Link>. Identity verification may be required. Closure does not erase financial, fraud-prevention, dispute, or audit records that MRC must lawfully retain, and it does not convert Credits into cash.</p>,
        },
        {
          title: "Provider or voucher cancellation",
          body: <p>Payment instruments are also governed by the issuing provider&apos;s rules. Never send voucher PINs through comments, email, Telegram, or the contact form. Voucher acceptance will be enabled only after a provider-approved server integration is active.</p>,
        },
      ]}
    />
  );
}
