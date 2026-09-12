import { InfoPage } from "@/components/info-page";

export default function AboutPage() {
  return (
    <InfoPage
      badge="About"
      title="Built for transparent horse-racing analysis"
      description="MRC Racing Tips is a premium digital-content platform for clients, independent tipsters, and administrators."
      sections={[
        {
          title: "How MRC works",
          body: "MRC Racing Tips is not a gambling website. It publishes premium digital horse-racing analysis, factual race information, statistics, historical results, and independent tipster selections. Clients purchase Credits and use them to unlock digital content or time-limited access to a tipster's published content.",
        },
        {
          title: "What clients receive",
          body: "A purchase provides access to analysis and information only. MRC does not accept or place transactions on racing outcomes, hold client funds for racing activity, or promise a financial return. Every purchase, content unlock, subscription period, correction, and result record remains visible through transparent account controls.",
        },
        {
          title: "Independent contributors",
          body: "Verified tipsters publish their own selections and commentary as independent digital contributors. MRC records publication revisions and settled performance so clients can assess each contributor's history before choosing which premium content to access.",
        },
      ]}
    />
  );
}
