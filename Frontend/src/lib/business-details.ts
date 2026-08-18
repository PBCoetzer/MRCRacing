export const businessDetails = {
  tradingName: "MRC Racing Tips",
  legalName: "MRC Racing Tips (Pty) Ltd",
  registrationNumber: "2025/406293/07",
  supportEmail: "support@mrcracing.co.za",
  telephoneDisplay: "083 703 6174",
  telephoneInternational: "+27 83 703 6174",
  telephoneHref: "tel:+27837036174",
  address: {
    region: "Eastern Cape",
    country: "South Africa",
    countryCode: "ZA",
  },
} as const;

export const publicBusinessLocation = [
  businessDetails.address.region,
  businessDetails.address.country,
].join(", ");
