import type { Metadata } from "next";
import { Bungee, JetBrains_Mono, Nunito_Sans } from "next/font/google";
import { Providers } from "@/components/providers";
import { JsonLd } from "@/lib/json-ld";
import { businessDetails } from "@/lib/business-details";
import { canonicalSiteUrl, defaultDescription, defaultShareImage, siteName } from "@/lib/metadata";
import "./globals.css";

const bungee = Bungee({
  variable: "--font-bungee",
  subsets: ["latin"],
  weight: "400",
});

const nunitoSans = Nunito_Sans({
  variable: "--font-nunito-sans",
  subsets: ["latin"],
});

const jetBrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  metadataBase: new URL(canonicalSiteUrl),
  title: { default: "MRC Racing Tips | South African Horse Racing", template: `%s | ${siteName}` },
  description: defaultDescription,
  applicationName: siteName,
  alternates: { canonical: "/" },
  openGraph: {
    type: "website", locale: "en_ZA", siteName,
    title: "MRC Racing Tips | South African Horse Racing",
    description: defaultDescription, url: "/",
    images: [{ url: defaultShareImage, width: 1200, height: 630, alt: "MRC Racing Tips — South African horse racing" }],
  },
  twitter: { card: "summary_large_image", title: "MRC Racing Tips", description: defaultDescription, images: [defaultShareImage] },
  verification: process.env.NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION
    ? { google: process.env.NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION }
    : undefined,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${bungee.variable} ${nunitoSans.variable} ${jetBrainsMono.variable} dark h-full antialiased`}
    >
      <body className="flex min-h-full flex-col">
        <JsonLd data={[
          {
            "@context": "https://schema.org",
            "@type": "Organization",
            name: siteName,
            legalName: businessDetails.legalName,
            identifier: businessDetails.registrationNumber,
            url: canonicalSiteUrl,
            logo: `${canonicalSiteUrl}/images/mrc-racing-tips-logo.webp`,
            email: businessDetails.supportEmail,
            telephone: businessDetails.telephoneInternational,
            address: {
              "@type": "PostalAddress",
              streetAddress: businessDetails.address.street,
              addressLocality: businessDetails.address.locality,
              addressRegion: businessDetails.address.region,
              postalCode: businessDetails.address.postalCode,
              addressCountry: businessDetails.address.countryCode,
            },
            contactPoint: {
              "@type": "ContactPoint",
              contactType: "customer support",
              email: businessDetails.supportEmail,
              telephone: businessDetails.telephoneInternational,
              areaServed: "ZA",
              availableLanguage: "English",
            },
          },
          { "@context": "https://schema.org", "@type": "WebSite", name: siteName, url: canonicalSiteUrl, inLanguage: "en-ZA" },
        ]} />
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
