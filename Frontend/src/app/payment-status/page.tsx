import { PaymentStatusClient } from "@/components/pricing/payment-status-client";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";

export default function PaymentStatusPage() {
  return (
    <div className="min-h-screen bg-background">
      <SiteHeader />
      <main className="mx-auto flex min-h-[calc(100svh-8rem)] w-full max-w-xl items-center px-4 py-10 sm:px-6">
        <PaymentStatusClient />
      </main>
      <SiteFooter />
    </div>
  );
}
