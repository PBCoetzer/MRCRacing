import Link from "next/link";
import Image from "next/image";
import { businessDetails, publicBusinessLocation } from "@/lib/business-details";

const links = [
  { label: "MRC Blog", href: "/blog/" },
  { label: "Racecards & Results", href: "/horse-racing/" },
  { label: "Horse Care", href: "/horse-care/" },
  { label: "Privacy", href: "/privacy" },
  { label: "Refunds", href: "/refund-policy/" },
  { label: "Cancellations", href: "/cancellation-policy/" },
  { label: "Terms", href: "/terms" },
  { label: "Contact", href: "/contact" },
];

export function SiteFooter() {
  return (
    <footer className="border-t border-brand-gold/25 bg-brand-purple-deep/92">
      <div className="site-container grid gap-6 py-8 text-sm text-muted-foreground md:grid-cols-[1fr_auto]">
        <div className="flex gap-4">
          <Image
            src="/images/mrc-racing-tips-logo.webp"
            alt="MRC Racing Tips logo"
            width={84}
            height={66}
            className="h-16 w-20 rounded-md border border-brand-gold/50 object-cover object-top"
          />
          <div>
          <p className="font-heading text-sm text-white">MRC Racing Tips</p>
          <p className="mt-2 max-w-2xl">
            South African horse-racing analysis, factual racecards, result history, and
            independent digital tipster content.
          </p>
          <p className="mt-3 max-w-2xl text-xs">
            {businessDetails.legalName} · Registration {businessDetails.registrationNumber}<br />
            {publicBusinessLocation}<br />
            <a href={`mailto:${businessDetails.supportEmail}`} className="hover:text-foreground">{businessDetails.supportEmail}</a>
            {" · "}
            <a href={businessDetails.telephoneHref} className="hover:text-foreground">{businessDetails.telephoneDisplay}</a>
          </p>
          </div>
        </div>
        <nav className="flex flex-wrap gap-4 md:justify-end">
          {links.map((link) => (
            <Link key={link.href} href={link.href} className="hover:text-foreground">
              {link.label}
            </Link>
          ))}
        </nav>
      </div>
    </footer>
  );
}
