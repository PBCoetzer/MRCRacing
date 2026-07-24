export const fixtures = [
  {
    sport: "Horse Racing",
    league: "Vaal Work Riders",
    fixture: "Race 4 - 1600m Handicap",
    startsAt: "Today 14:35",
    market: "Win / Place",
    status: "Open",
  },
  {
    sport: "Soccer",
    league: "Premier Soccer League",
    fixture: "Cape Town City vs Pirates",
    startsAt: "Today 19:30",
    market: "Match Result",
    status: "Open",
  },
  {
    sport: "Rugby",
    league: "United Rugby Championship",
    fixture: "Stormers vs Bulls",
    startsAt: "Sat 17:05",
    market: "Handicap",
    status: "Preview",
  },
];

export const latestResults = [
  {
    event: "Hollywoodbets Scottsville",
    result: "6 winners from 9 races",
    strikeRate: "66.67%",
    highlight: "Value selection landed in the closing race",
  },
  {
    event: "Turffontein Standside",
    result: "6 winners from 10 races",
    strikeRate: "60%",
    highlight: "Two blackbook runners converted",
  },
  {
    event: "Greyville Polytrack",
    result: "Pick 6 caught",
    strikeRate: "Major exotic",
    highlight: "Exotic structure carried the card",
  },
];

export const tipsters = [
  {
    name: "Marco Rail",
    sport: "Horse Racing",
    roi: "+18.4%",
    winRate: "41%",
    profit: "+126.5u",
    followers: "2,184",
    badge: "Verified",
  },
  {
    name: "Nandi Edge",
    sport: "Soccer",
    roi: "+13.2%",
    winRate: "57%",
    profit: "+84.1u",
    followers: "1,612",
    badge: "Rising",
  },
  {
    name: "Kobus Card",
    sport: "Rugby",
    roi: "+10.8%",
    winRate: "54%",
    profit: "+63.7u",
    followers: "936",
    badge: "Verified",
  },
];

export const premiumTips = [
  {
    tipster: "Marco Rail",
    fixture: "Vaal Race 4",
    prediction: "Bright Comet each-way",
    confidence: 8,
    odds: "5.50",
    credits: 2,
    status: "Locked",
  },
  {
    tipster: "Nandi Edge",
    fixture: "Cape Town City vs Pirates",
    prediction: "Under 2.5 goals",
    confidence: 7,
    odds: "1.92",
    credits: 1,
    status: "Locked",
  },
  {
    tipster: "Kobus Card",
    fixture: "Stormers vs Bulls",
    prediction: "Bulls +6.5",
    confidence: 6,
    odds: "1.86",
    credits: 1,
    status: "Preview",
  },
];

export const creditPackages = [
  { name: "Starter", credits: 10, price: "R49", value: "R4.90 per credit" },
  { name: "Sharp Card", credits: 40, price: "R169", value: "R4.22 per credit" },
  { name: "Syndicate", credits: 150, price: "R579", value: "R3.86 per credit" },
];

export const adminMetrics = [
  { label: "Active users", value: "1,284", change: "+12%" },
  { label: "Credits issued", value: "48,920", change: "+8%" },
  { label: "Tips unlocked", value: "7,418", change: "+19%" },
  { label: "Pending payments", value: "23", change: "Review" },
];

export const transactions = [
  { user: "client-142", type: "purchase", amount: "+40", status: "Paid" },
  { user: "client-918", type: "unlock", amount: "-2", status: "Settled" },
  { user: "client-311", type: "refund", amount: "+10", status: "Admin" },
];
