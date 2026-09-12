import { InfoPage } from "@/components/info-page";
import { JsonLd } from "@/lib/json-ld";

const faqItems = [
  { question: "How do credits work?", answer: "Users buy credits and spend them to unlock premium tips. Every movement is recorded in a transaction ledger." },
  { question: "What information is available?", answer: "MRC Racing Tips provides factual racecards, recorded results, tipster profiles, and independent digital selections." },
  { question: "How are tipsters ranked?", answer: "Public performance uses officially settled winner and place selections. Place strike rate counts official top-three finishes, and every displayed rate includes its settled sample size." },
];

export default function FaqPage() {
  return (<>
    <JsonLd data={{ "@context": "https://schema.org", "@type": "FAQPage", mainEntity: faqItems.map((item) => ({ "@type": "Question", name: item.question, acceptedAnswer: { "@type": "Answer", text: item.answer } })) }} />
    <InfoPage
      badge="FAQ"
      title="Frequently asked questions"
      description="Early product answers for the local MRC Racing Tips build."
      sections={faqItems.map((item) => ({ title: item.question, body: item.answer }))}
    />
  </>);
}
