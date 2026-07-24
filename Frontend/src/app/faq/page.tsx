import { InfoPage } from "@/components/info-page";

export default function FaqPage() {
  return (
    <InfoPage
      badge="FAQ"
      title="Frequently asked questions"
      description="Early product answers for the local MRC Racing Tips build."
      sections={[
        {
          title: "How do credits work?",
          body: "Users buy credits and spend them to unlock premium tips. Every movement is recorded in a transaction ledger.",
        },
        {
          title: "Does MRC Racing Tips accept bets?",
          body: "No. MRC Racing Tips provides analysis and digital tipping content only. Betting activity happens independently through licensed operators.",
        },
        {
          title: "How are tipsters ranked?",
          body: "The planned ranking model uses ROI, win rate, profit, sample size, recent form, and verified historical results.",
        },
      ]}
    />
  );
}
