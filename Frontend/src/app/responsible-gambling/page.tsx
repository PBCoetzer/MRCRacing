import { InfoPage } from "@/components/info-page";

export default function ResponsibleGamblingPage() {
  return (
    <InfoPage
      badge="18+ only"
      title="Responsible gambling"
      description="MRC Racing Tips promotes responsible betting behavior and clearly separates analysis from gambling operations."
      sections={[
        {
          title: "Entertainment only",
          body: "Betting should be treated as entertainment, not as a guaranteed income source. No tip, system, or analysis can guarantee a profit.",
        },
        {
          title: "User responsibility",
          body: "Users should never bet more than they can afford to lose. MRC Racing Tips does not place bets, hold betting funds, or pay out winnings.",
        },
        {
          title: "Age restriction",
          body: "The service is intended only for users aged 18 or older. Registration should require explicit age confirmation.",
        },
      ]}
    />
  );
}
