import { InfoPage } from "@/components/info-page";

export default function PrivacyPage() {
  return (
    <InfoPage
      badge="Privacy"
      title="Privacy policy"
      description="A production privacy policy must be reviewed for POPIA alignment before launch."
      sections={[
        {
          title: "Data collected",
          body: "The platform expects to collect account details, profile details, payment references, credit history, unlock history, notifications, and audit events.",
        },
        {
          title: "Payment data",
          body: "Payment card and banking details should be handled by trusted payment providers. MRC Racing Tips should store payment references and verification status, not raw card data.",
        },
      ]}
    />
  );
}
