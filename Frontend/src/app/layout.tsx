import type { Metadata } from "next";
import { Bungee, JetBrains_Mono, Nunito_Sans } from "next/font/google";
import { Providers } from "@/components/providers";
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
  title: "MRC Racing Tips | Premium Sports Tips",
  description:
    "A South African sports tipping platform for tipsters, racing tips, credits, race cards, and transparent betting analysis.",
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
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
