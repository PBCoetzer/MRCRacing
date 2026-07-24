import { InfoPage } from "@/components/info-page";

export default function ContactPage() {
  return (
    <InfoPage
      badge="Contact"
      title="Contact MRC Racing Tips"
      description="Contact details will be finalized before production launch."
      sections={[
        {
          title: "Support",
          body: "The production site should include email support, WhatsApp support, payment support, and responsible gambling support routes.",
        },
        {
          title: "Admin operations",
          body: "Administrators should be able to manage announcements and support notices from the admin dashboard.",
        },
      ]}
    />
  );
}
