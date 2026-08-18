import { InfoPage } from "@/components/info-page";
import { JsonLd } from "@/lib/json-ld";

const faqItems = [
  { question: "How do credits work?", answer: "Users buy credits and spend them to unlock premium tips. Every movement is recorded in a transaction ledger." },
  { question: "Does MRC Racing Tips accept bets?", answer: "No. MRC Racing Tips provides analysis and digital tipping content only. Betting activity happens independently through licensed operators." },
  { question: "How are tipsters ranked?", answer: "Public performance uses officially settled winner selections and shows the settled sample. ROI remains hidden until authoritative dividends support it." },
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
