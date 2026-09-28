import {
  betfredAffiliateUrl,
  betfredBannerUrl,
  buildMeetingCardAffiliateFooter,
} from "./meeting-card-affiliate.ts";

Deno.test("meeting-card affiliate footer includes the Betfred creative and CTA", () => {
  const footer = buildMeetingCardAffiliateFooter();

  if (!footer.html.includes(betfredAffiliateUrl)) {
    throw new Error("Affiliate click URL is missing from the HTML footer.");
  }
  if (!footer.html.includes(betfredBannerUrl)) {
    throw new Error("Betfred banner is missing from the HTML footer.");
  }
  if (!footer.html.includes("CREATE ACCOUNT NOW")) {
    throw new Error("Affiliate CTA is missing from the HTML footer.");
  }
  if (!footer.html.includes("Open Betfred here")) {
    throw new Error("Mobile-safe fallback affiliate link is missing.");
  }
  if (footer.html.includes("min-width:")) {
    throw new Error("Affiliate footer must not force a desktop-only minimum width.");
  }
  if (!footer.html.includes('width="100%"')) {
    throw new Error("Affiliate CTA must remain fluid on narrow mobile screens.");
  }
  if (!footer.html.includes("18+")) {
    throw new Error(
      "Responsible-gambling notice is missing from the HTML footer.",
    );
  }
  if (!footer.text.includes(betfredAffiliateUrl)) {
    throw new Error("Plain-text emails must include the affiliate URL.");
  }
});
