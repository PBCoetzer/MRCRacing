import { InfoPage } from "@/components/info-page";

export default function AboutPage() {
  return (
    <InfoPage
      badge="About"
      title="Built for transparent horse-racing analysis"
      description="MRC Racing Tips is a dedicated horse-racing tipping platform for clients, tipsters, and administrators."
      sections={[
        {
          title: "Positioning",
          body: "The platform provides information, statistics, and digital tipping content. It is not a bookmaker and does not process betting deposits or payouts.",
        },
        {
          title: "Product focus",
          body: "The core product combines horse-racing tipster profiles, premium selections, credits, upcoming race cards, historical results, and responsible gambling controls.",
        },
      ]}
    />
  );
}
