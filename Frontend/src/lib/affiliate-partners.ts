export type AffiliatePartner = {
  name: string;
  image: string;
  href: string;
  primary?: boolean;
  impressionUrl?: string;
};

export const affiliatePartners = [
  {
    name: "Betfred",
    image: "/images/affiliates/betfred.webp",
    href: "https://betfredsa.click/o/jYTCha?lpage=pzQ7HH&site_id=1225&r_id=132",
    primary: true,
    impressionUrl: "https://betfredsa.click/i/jYTCha?r_id=132&site_id=1225",
  },
  {
    name: "Playabets",
    image: "/images/affiliates/playabets.webp",
    href: "https://playabets.ravn.click/o/amHwYe?lpage=lTbzxn",
  },
  {
    name: "10Bet",
    image: "/images/affiliates/10bet.webp",
    href: "https://partners.10betaffiliates.co.za/visit/?bta=36777&brand=10betza",
  },
  {
    name: "World Sports Betting",
    image: "/images/affiliates/world-sports-betting.webp",
    href: "https://trk.worldsportsbetting.co.za/click?o=1&a=1201&c=7&link_id=8",
  },
  {
    name: "Hollywoodbets",
    image: "/images/affiliates/hollywoodbets.webp",
    href: "https://hollywoodbetsaffs.click/o/43wGic?site_id=101050",
  },
] satisfies AffiliatePartner[];
