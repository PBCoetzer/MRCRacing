import { InfoPage } from "@/components/info-page";

export default function TermsPage() {
  return (
    <InfoPage
      badge="Terms"
      title="Terms and conditions"
      description="Starter terms content for the local build. Legal review is required before production."
      sections={[
        {
          title: "Service scope",
          body: "MRC Racing Tips provides sports analysis, tipster content, ratings, selections, opinions, and result history for informational purposes.",
        },
        {
          title: "Credits",
          body: "Credits unlock digital content. They have no cash value, cannot be withdrawn, and cannot be used to place bets.",
        },
        {
          title: "No guarantee",
          body: "Past performance does not guarantee future outcomes. Users make betting decisions independently and at their own risk.",
        },
      ]}
    />
  );
}
