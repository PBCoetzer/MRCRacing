export const businessDetails = {
  tradingName: "MRC Racing Tips",
  legalName: "MRC Racing Tips (Pty) Ltd",
  registrationNumber: "2025/406293/07",
  supportEmail: "support@mrcracing.co.za",
  telephoneDisplay: "083 703 6174",
  telephoneInternational: "+27 83 703 6174",
  telephoneHref: "tel:+27837036174",
  address: {
    street: "9 Winston Crescent",
    suburb: "Newton Park",
    locality: "Gqeberha",
    region: "Eastern Cape",
    postalCode: "6055",
    country: "South Africa",
    countryCode: "ZA",
  },
} as const;

export const registeredOffice = [
  businessDetails.address.street,
  businessDetails.address.suburb,
  businessDetails.address.locality,
  businessDetails.address.region,
  businessDetails.address.postalCode,
  businessDetails.address.country,
].join(", ");
