import type {
  TelegramApprovalPayload,
  TelegramRace,
  TelegramRaceRunner,
} from "./telegram.ts";

export type RaceApprovalPdf = {
  bytes: Uint8Array;
  fileName: string;
  pageCount: number;
};

type RaceApprovalPdfOptions = {
  generatedAt?: Date;
  logoBytes?: Uint8Array;
};

type PdfColor = readonly [number, number, number];

type PageContext = {
  venue: string;
  meetingDate: string;
  confidence: string;
  sourceSummary: string;
  meetingSummary: string;
  proposalId: string;
  proposalVersion: string;
  generatedAt: string;
  singleSourceCap: boolean;
  hasLogo: boolean;
  logoWidth: number;
  logoHeight: number;
};

type PageRecord = {
  race: TelegramRace;
  raceIndex: number;
  runners: TelegramRaceRunner[];
  runnerStartIndex: number;
  part: number;
  partCount: number;
};

type JpegDetails = {
  width: number;
  height: number;
  colorSpace: "/DeviceGray" | "/DeviceRGB" | "/DeviceCMYK";
};

const encoder = new TextEncoder();
const pageWidth = 841.89;
const pageHeight = 595.28;
const margin = 30;
const footerHeight = 25;
const maximumRowsPerPage = 16;

const colors = {
  deepPurple: [0.10, 0.025, 0.20] as PdfColor,
  purple: [0.22, 0.07, 0.36] as PdfColor,
  purpleLight: [0.95, 0.92, 0.98] as PdfColor,
  gold: [1, 0.69, 0] as PdfColor,
  cyan: [0, 0.76, 0.88] as PdfColor,
  ink: [0.11, 0.08, 0.16] as PdfColor,
  muted: [0.39, 0.35, 0.43] as PdfColor,
  line: [0.82, 0.78, 0.86] as PdfColor,
  white: [1, 1, 1] as PdfColor,
  warning: [0.99, 0.94, 0.78] as PdfColor,
};

const columns = [
  { label: "NO.", x: 36, width: 30 },
  { label: "HORSE", x: 70, width: 181 },
  { label: "JOCKEY", x: 255, width: 154 },
  { label: "TRAINER", x: 413, width: 164 },
  { label: "DRAW", x: 581, width: 49 },
  { label: "WEIGHT", x: 634, width: 59 },
  { label: "STATUS", x: 697, width: 108 },
] as const;

function asciiText(value: unknown, fallback = "-") {
  const raw = String(value ?? "").trim() || fallback;
  return raw
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2013\u2014]/g, "-")
    .replace(/\u2026/g, "...")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\x20-\x7E]/g, "?");
}

function finiteNumber(value: unknown): number | null {
  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? numericValue : null;
}

function formatMeetingDate(value: unknown) {
  const normalized = asciiText(value, "Unknown date");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) return normalized;
  const date = new Date(`${normalized}T12:00:00+02:00`);
  if (Number.isNaN(date.getTime())) return normalized;
  return new Intl.DateTimeFormat("en-ZA", {
    day: "2-digit",
    month: "long",
    year: "numeric",
    timeZone: "Africa/Johannesburg",
  }).format(date);
}

function formatRaceTime(value: unknown) {
  const date = new Date(String(value ?? ""));
  if (Number.isNaN(date.getTime())) return "Time pending";
  return `${
    new Intl.DateTimeFormat("en-ZA", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
      timeZone: "Africa/Johannesburg",
    }).format(date)
  } SAST`;
}

function formatGeneratedAt(value: Date) {
  return new Intl.DateTimeFormat("en-ZA", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Africa/Johannesburg",
  }).format(value);
}

function formatWeight(value: unknown) {
  const numericValue = finiteNumber(value);
  if (numericValue === null) return "Pending";
  return `${
    numericValue.toLocaleString("en-ZA", { maximumFractionDigits: 1 })
  } kg`;
}

function number(value: number) {
  return Number(value.toFixed(3)).toString();
}

function color(value: PdfColor) {
  return value.map(number).join(" ");
}

function estimateTextWidth(value: string, size: number, bold: boolean) {
  let units = 0;
  for (const character of value) {
    if (character === " ") units += 0.278;
    else if (/[ilI.,:;'!|]/.test(character)) units += 0.278;
    else if (/[MW@%]/.test(character)) units += 0.86;
    else if (/[A-Z]/.test(character)) units += 0.64;
    else if (/[0-9]/.test(character)) units += 0.556;
    else units += 0.52;
  }
  return units * size * (bold ? 1.04 : 1);
}

function fitText(
  value: unknown,
  size: number,
  maximumWidth: number,
  bold = false,
) {
  const text = asciiText(value);
  if (estimateTextWidth(text, size, bold) <= maximumWidth) return text;
  const suffix = "...";
  let end = text.length;
  while (
    end > 1 &&
    estimateTextWidth(`${text.slice(0, end)}${suffix}`, size, bold) >
      maximumWidth
  ) {
    end -= 1;
  }
  return `${text.slice(0, end)}${suffix}`;
}

function escapePdfText(value: string) {
  return value.replace(/([\\()])/g, "\\$1");
}

function textCommand(
  value: unknown,
  x: number,
  y: number,
  size: number,
  maximumWidth: number,
  textColor: PdfColor = colors.ink,
  bold = false,
) {
  const fitted = fitText(value, size, maximumWidth, bold);
  return `BT /${bold ? "F2" : "F1"} ${number(size)} Tf ${
    color(textColor)
  } rg 1 0 0 1 ${number(x)} ${number(y)} Tm (${escapePdfText(fitted)}) Tj ET\n`;
}

function rectangleCommand(
  x: number,
  y: number,
  width: number,
  height: number,
  fillColor: PdfColor,
  borderColor?: PdfColor,
  borderWidth = 0,
) {
  const fill = `${color(fillColor)} rg ${number(x)} ${number(y)} ${
    number(width)
  } ${number(height)} re f\n`;
  if (!borderColor || borderWidth <= 0) return fill;
  return `${fill}${color(borderColor)} RG ${number(borderWidth)} w ${
    number(x)
  } ${number(y)} ${number(width)} ${number(height)} re S\n`;
}

function lineCommand(
  startX: number,
  startY: number,
  endX: number,
  endY: number,
  lineColor: PdfColor,
  width: number,
) {
  return `${color(lineColor)} RG ${number(width)} w ${number(startX)} ${
    number(startY)
  } m ${number(endX)} ${number(endY)} l S\n`;
}

function parseJpeg(bytes: Uint8Array): JpegDetails | null {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  const startOfFrameMarkers = new Set([
    0xc0,
    0xc1,
    0xc2,
    0xc3,
    0xc5,
    0xc6,
    0xc7,
    0xc9,
    0xca,
    0xcb,
    0xcd,
    0xce,
    0xcf,
  ]);
  let offset = 2;
  while (offset + 4 < bytes.length) {
    while (offset < bytes.length && bytes[offset] === 0xff) offset += 1;
    const marker = bytes[offset];
    offset += 1;
    if (
      marker === 0xd8 || marker === 0xd9 || marker === 0x01 ||
      (marker >= 0xd0 && marker <= 0xd7)
    ) {
      continue;
    }
    if (offset + 1 >= bytes.length) return null;
    const segmentLength = (bytes[offset] << 8) + bytes[offset + 1];
    if (segmentLength < 2 || offset + segmentLength > bytes.length) return null;
    if (startOfFrameMarkers.has(marker) && segmentLength >= 8) {
      const height = (bytes[offset + 3] << 8) + bytes[offset + 4];
      const width = (bytes[offset + 5] << 8) + bytes[offset + 6];
      const components = bytes[offset + 7];
      if (!width || !height) return null;
      return {
        width,
        height,
        colorSpace: components === 1
          ? "/DeviceGray"
          : components === 4
          ? "/DeviceCMYK"
          : "/DeviceRGB",
      };
    }
    offset += segmentLength;
  }
  return null;
}

function drawBrandHeader(context: PageContext) {
  let output = rectangleCommand(
    0,
    pageHeight - 82,
    pageWidth,
    82,
    colors.deepPurple,
  );
  output += textCommand(
    "MRC RACING TIPS",
    margin,
    pageHeight - 34,
    20,
    210,
    colors.white,
    true,
  );
  output += textCommand(
    "RACE DATA APPROVAL",
    margin,
    pageHeight - 54,
    10,
    190,
    colors.cyan,
    true,
  );
  output += textCommand(
    "PROPOSED DATABASE RECORD - NOT YET PUBLISHED",
    255,
    pageHeight - 49,
    10,
    450,
    colors.gold,
    true,
  );
  output += rectangleCommand(0, pageHeight - 85, pageWidth, 3, colors.gold);
  if (context.hasLogo) {
    output += `q ${number(context.logoWidth)} 0 0 ${
      number(context.logoHeight)
    } ${number(pageWidth - margin - context.logoWidth)} ${
      number(pageHeight - 68)
    } cm /Im1 Do Q\n`;
  }
  return output;
}

function drawMeetingSummary(context: PageContext) {
  let output = textCommand(
    `${context.venue.toUpperCase()} - ${context.meetingDate.toUpperCase()}`,
    margin,
    pageHeight - 114,
    17,
    560,
    colors.ink,
    true,
  );
  output += textCommand(
    `${context.meetingSummary} | ${context.confidence}% confidence | ${context.sourceSummary}`,
    margin,
    pageHeight - 134,
    9.5,
    760,
    colors.muted,
  );
  if (context.singleSourceCap) {
    output += rectangleCommand(
      margin,
      pageHeight - 163,
      pageWidth - margin * 2,
      20,
      colors.warning,
      colors.gold,
      0.7,
    );
    output += textCommand(
      "MANUAL REVIEW REQUIRED - One approved source was available, so confidence is capped for safety.",
      margin + 8,
      pageHeight - 157,
      8.5,
      745,
      colors.ink,
      true,
    );
  }
  return output;
}

function drawRaceTitle(record: PageRecord) {
  const raceNumber = finiteNumber(record.race.raceNumber) ??
    record.raceIndex + 1;
  const distance = finiteNumber(record.race.distanceMetres);
  const title = asciiText(
    record.race.title ?? record.race.raceClass,
    "Race details pending",
  );
  const continuation = record.partCount > 1
    ? ` - PART ${record.part} OF ${record.partCount}`
    : "";
  let output = rectangleCommand(
    margin,
    pageHeight - 196,
    pageWidth - margin * 2,
    26,
    colors.purple,
  );
  output += textCommand(
    `RACE ${raceNumber}${continuation}`,
    margin + 9,
    pageHeight - 187,
    11,
    150,
    colors.white,
    true,
  );
  output += textCommand(
    `${formatRaceTime(record.race.startsAt)} | ${title}${
      distance === null ? "" : ` | ${distance}m`
    }`,
    margin + 165,
    pageHeight - 187,
    10,
    585,
    colors.white,
    true,
  );
  return output;
}

function drawTableHeader() {
  const y = pageHeight - 220;
  let output = rectangleCommand(
    margin,
    y,
    pageWidth - margin * 2,
    22,
    colors.purpleLight,
    colors.line,
    0.5,
  );
  for (const column of columns) {
    output += textCommand(
      column.label,
      column.x,
      y + 7,
      8,
      column.width,
      colors.purple,
      true,
    );
  }
  return output;
}

function drawRunnerRows(record: PageRecord) {
  const rowHeight = 20;
  const firstRowY = pageHeight - 240;
  let output = "";
  record.runners.forEach((runner, index) => {
    const y = firstRowY - index * rowHeight;
    if (index % 2 === 1) {
      output += rectangleCommand(
        margin,
        y,
        pageWidth - margin * 2,
        rowHeight,
        [0.985, 0.975, 0.995],
      );
    }
    output += lineCommand(margin, y, pageWidth - margin, y, colors.line, 0.35);
    const saddleNumber = finiteNumber(runner.saddleNumber) ??
      record.runnerStartIndex + index + 1;
    const draw = finiteNumber(runner.draw);
    const status = asciiText(runner.status, "active").toUpperCase();
    const values = [
      String(saddleNumber),
      asciiText(runner.horseName, "Unnamed runner"),
      asciiText(runner.jockeyName, "Pending"),
      asciiText(runner.trainerName, "Pending"),
      draw === null ? "-" : String(draw),
      formatWeight(runner.carriedWeight),
      status,
    ];
    columns.forEach((column, columnIndex) => {
      output += textCommand(
        values[columnIndex],
        column.x,
        y + 6.5,
        8.2,
        column.width,
        columnIndex === 6 && status !== "ACTIVE" ? colors.purple : colors.ink,
        columnIndex === 1,
      );
    });
  });
  return output;
}

function drawFooter(
  context: PageContext,
  pageNumber: number,
  pageCount: number,
) {
  let output = rectangleCommand(
    0,
    0,
    pageWidth,
    footerHeight,
    colors.deepPurple,
  );
  output += textCommand(
    `Proposal ${context.proposalId} | Version ${context.proposalVersion} | Generated ${context.generatedAt}`,
    margin,
    8,
    7.5,
    690,
    colors.white,
  );
  output += textCommand(
    `Page ${pageNumber} of ${pageCount}`,
    pageWidth - 82,
    8,
    7.5,
    60,
    colors.white,
    true,
  );
  return output;
}

function safeFileSegment(value: unknown, fallback: string) {
  return asciiText(value, fallback)
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || fallback;
}

function pdfDate(value: Date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    timeZone: "Africa/Johannesburg",
  }).formatToParts(value);
  const pick = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "00";
  return `D:${pick("year")}${pick("month")}${pick("day")}${pick("hour")}${
    pick("minute")
  }${pick("second")}+02'00'`;
}

function concatenate(chunks: Uint8Array[]) {
  const length = chunks.reduce((total, chunk) => total + chunk.length, 0);
  const output = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.length;
  }
  return output;
}

function ascii(value: string) {
  return encoder.encode(value);
}

function buildPdf(
  pageContents: string[],
  metadata: { title: string; generatedAt: Date },
  logoBytes?: Uint8Array,
  jpeg?: JpegDetails | null,
) {
  const hasLogo = Boolean(logoBytes?.length && jpeg);
  const imageObject = hasLogo ? 6 : null;
  const firstPageObject = hasLogo ? 7 : 6;
  const pageObjects = pageContents.map((_, index) =>
    firstPageObject + index * 2
  );
  const totalObjects = firstPageObject - 1 + pageContents.length * 2;
  const objects: Array<Uint8Array[] | undefined> = new Array(totalObjects + 1);

  objects[1] = [ascii("<< /Type /Catalog /Pages 2 0 R >>")];
  objects[2] = [
    ascii(
      `<< /Type /Pages /Count ${pageContents.length} /Kids [${
        pageObjects.map((id) => `${id} 0 R`).join(" ")
      }] >>`,
    ),
  ];
  objects[3] = [
    ascii(
      "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
    ),
  ];
  objects[4] = [
    ascii(
      "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>",
    ),
  ];
  objects[5] = [ascii(
    `<< /Title (${
      escapePdfText(asciiText(metadata.title))
    }) /Author (MRC Racing Tips) /Subject (Race data proposal approval copy) /Creator (MRC Racing Tips notification service) /Producer (MRC Racing Tips) /CreationDate (${
      pdfDate(metadata.generatedAt)
    }) /ModDate (${pdfDate(metadata.generatedAt)}) >>`,
  )];

  if (hasLogo && imageObject && logoBytes && jpeg) {
    const decode = jpeg.colorSpace === "/DeviceCMYK"
      ? " /Decode [1 0 1 0 1 0 1 0]"
      : "";
    objects[imageObject] = [
      ascii(
        `<< /Type /XObject /Subtype /Image /Width ${jpeg.width} /Height ${jpeg.height} /ColorSpace ${jpeg.colorSpace} /BitsPerComponent 8 /Filter /DCTDecode${decode} /Length ${logoBytes.length} >>\nstream\n`,
      ),
      logoBytes,
      ascii("\nendstream"),
    ];
  }

  pageContents.forEach((content, index) => {
    const pageObject = pageObjects[index];
    const contentObject = pageObject + 1;
    const resources = hasLogo && imageObject
      ? `/Resources << /Font << /F1 3 0 R /F2 4 0 R >> /XObject << /Im1 ${imageObject} 0 R >> >>`
      : "/Resources << /Font << /F1 3 0 R /F2 4 0 R >> >>";
    objects[pageObject] = [ascii(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${number(pageWidth)} ${
        number(pageHeight)
      }] ${resources} /Contents ${contentObject} 0 R >>`,
    )];
    const contentBytes = ascii(content);
    objects[contentObject] = [
      ascii(`<< /Length ${contentBytes.length} >>\nstream\n`),
      contentBytes,
      ascii("endstream"),
    ];
  });

  const chunks: Uint8Array[] = [ascii("%PDF-1.4\n%MRC\n")];
  const offsets = new Array<number>(totalObjects + 1).fill(0);
  let currentOffset = chunks[0].length;
  for (let objectId = 1; objectId <= totalObjects; objectId += 1) {
    const body = objects[objectId];
    if (!body) throw new Error(`PDF object ${objectId} was not created.`);
    offsets[objectId] = currentOffset;
    const objectChunks = [
      ascii(`${objectId} 0 obj\n`),
      ...body,
      ascii("\nendobj\n"),
    ];
    chunks.push(...objectChunks);
    currentOffset += objectChunks.reduce(
      (total, chunk) => total + chunk.length,
      0,
    );
  }

  const xrefOffset = currentOffset;
  let xref = `xref\n0 ${totalObjects + 1}\n0000000000 65535 f \n`;
  for (let objectId = 1; objectId <= totalObjects; objectId += 1) {
    xref += `${String(offsets[objectId]).padStart(10, "0")} 00000 n \n`;
  }
  xref += `trailer\n<< /Size ${
    totalObjects + 1
  } /Root 1 0 R /Info 5 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  chunks.push(ascii(xref));
  return concatenate(chunks);
}

export async function generateRaceApprovalPdf(
  payload: TelegramApprovalPayload,
  options: RaceApprovalPdfOptions = {},
): Promise<RaceApprovalPdf> {
  const meeting = payload.raceSnapshot?.meetings?.[0];
  const races = Array.isArray(meeting?.races) ? meeting.races : [];
  if (!meeting || !races.length) {
    throw new Error(
      "The race proposal does not contain a complete meeting for PDF review.",
    );
  }

  const generatedAt = options.generatedAt ?? new Date();
  const jpeg = options.logoBytes?.length ? parseJpeg(options.logoBytes) : null;
  const logoMaximumWidth = 68;
  const logoMaximumHeight = 54;
  const logoScale = jpeg
    ? Math.min(logoMaximumWidth / jpeg.width, logoMaximumHeight / jpeg.height)
    : 0;
  const venue = asciiText(
    payload.meetingVenue ?? meeting.venue,
    "Unknown venue",
  );
  const rawMeetingDate = asciiText(
    payload.meetingDate ?? meeting.meetingDate,
    "Unknown date",
  );
  const meetingDate = formatMeetingDate(rawMeetingDate);
  const runnerCount = races.reduce(
    (total, race) =>
      total + (Array.isArray(race.runners) ? race.runners.length : 0),
    0,
  );
  const context: PageContext = {
    venue,
    meetingDate,
    confidence: String(Math.round(finiteNumber(payload.confidenceScore) ?? 0)),
    sourceSummary: `${
      Math.max(0, finiteNumber(payload.approvedSourceCount) ?? 0)
    }/${
      Math.max(0, finiteNumber(payload.distinctSourceCount) ?? 0)
    } approved sources`,
    meetingSummary: `${races.length} races | ${runnerCount} runners`,
    proposalId: asciiText(payload.proposalId, "Unavailable"),
    proposalVersion: String(
      Math.max(1, finiteNumber(payload.proposalVersion) ?? 1),
    ),
    generatedAt: formatGeneratedAt(generatedAt),
    singleSourceCap: payload.confidenceBreakdown?.oneSourceCapApplied === true,
    hasLogo: Boolean(jpeg),
    logoWidth: jpeg ? jpeg.width * logoScale : 0,
    logoHeight: jpeg ? jpeg.height * logoScale : 0,
  };

  const pageRecords: PageRecord[] = [];
  races.forEach((race, raceIndex) => {
    const runners = Array.isArray(race.runners) ? race.runners : [];
    const partCount = Math.max(
      1,
      Math.ceil(runners.length / maximumRowsPerPage),
    );
    for (let partIndex = 0; partIndex < partCount; partIndex += 1) {
      const runnerStartIndex = partIndex * maximumRowsPerPage;
      pageRecords.push({
        race,
        raceIndex,
        runners: runners.slice(
          runnerStartIndex,
          (partIndex + 1) * maximumRowsPerPage,
        ),
        runnerStartIndex,
        part: partIndex + 1,
        partCount,
      });
    }
  });

  const pageContents = pageRecords.map((record, pageIndex) =>
    drawBrandHeader(context) +
    drawMeetingSummary(context) +
    drawRaceTitle(record) +
    drawTableHeader() +
    drawRunnerRows(record) +
    drawFooter(context, pageIndex + 1, pageRecords.length)
  );
  const title = `MRC Racing Tips - ${venue} ${meetingDate} Race Data Approval`;
  const bytes = buildPdf(
    pageContents,
    { title, generatedAt },
    options.logoBytes,
    jpeg,
  );

  return {
    bytes,
    fileName: `MRC-${safeFileSegment(venue, "Meeting")}-${
      safeFileSegment(rawMeetingDate, "Date")
    }-Race-Data-Approval.pdf`,
    pageCount: pageRecords.length,
  };
}
