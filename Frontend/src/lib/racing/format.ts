const johannesburgDateTime = new Intl.DateTimeFormat("en-ZA", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Africa/Johannesburg",
});

const johannesburgDate = new Intl.DateTimeFormat("en-ZA", {
  dateStyle: "long",
  timeZone: "Africa/Johannesburg",
});

export function formatRaceDateTime(value: string) {
  return johannesburgDateTime.format(new Date(value));
}

export function formatRaceDate(value: string) {
  return johannesburgDate.format(new Date(value));
}

export function formatCoins(value: number | string) {
  return `${Number(value).toLocaleString("en-ZA", {
    maximumFractionDigits: 2,
  })} coins`;
}
