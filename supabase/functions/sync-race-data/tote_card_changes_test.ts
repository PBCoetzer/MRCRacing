import {
  canonicalRaceVenue,
  parseToteCardChanges,
  parseToteFixtureCardChangeLinks,
} from "./tote-card-changes.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

Deno.test("discovers the Tote card-change URL for the requested meeting date", () => {
  const links = parseToteFixtureCardChangeLinks(
    `
    <div class="accordion-item">
      <button><img alt="South Africa">&nbsp;Hollywoodbets Scottsville&nbsp;<span>NTL</span></button>
      <a href="/fixtures/card-changes?date=20260921&amp;itw=XED">Card Changes</a>
    </div>
    <div class="accordion-item">
      <button>Vaal&nbsp;<span>GAU</span></button>
      <a href="/fixtures/card-changes?date=20260922&amp;itw=XVD">Card Changes</a>
    </div>
  `,
    "2026-09-21",
  );

  assert(links.length === 1, "Expected one matching Tote meeting link.");
  assert(
    canonicalRaceVenue(links[0].venue) === "scottsville",
    "Venue was not normalized.",
  );
  assert(
    links[0].url.includes("date=20260921"),
    "Meeting date was not preserved.",
  );
  assert(
    links[0].url.includes("itw=XED"),
    "Tote meeting code was not preserved.",
  );
});

Deno.test("parses fresh scratchings and jockey changes without guessing placeholders", () => {
  const parsed = parseToteCardChanges(`
    <h2><img alt="South Africa"> Hollywoodbets Scottsville on Monday 21/09/2026</h2>
    <h3>Card Scratchings</h3>
    <table><tbody>
      <tr><td>3</td><td>7</td><td>Kaz From Alcatraz</td><td>Temperature</td></tr>
      <tr><td>8</td><td>17</td><td>Vihaan&#039;s Web</td><td>Reserve Runner</td></tr>
    </tbody></table>
    <h3>Jockey Changes</h3>
    <table><tbody>
      <tr><td>1</td><td>4</td><td>Whitehall</td><td>* Q Ngcobo (-4.0kg)</td></tr>
      <tr><td>1</td><td>17</td><td>Roxbury Park (draw 2)</td><td>K de Melo</td></tr>
      <tr><td>8</td><td>8</td><td>Pop Chart</td><td>...............</td></tr>
    </tbody></table>
    <div>As at 21/09/2026 09:28:49</div>
  `);

  assert(parsed.meetingDate === "2026-09-21", "Meeting date was not parsed.");
  assert(
    parsed.observedAt === "2026-09-21T09:28:49+02:00",
    "Source timestamp was not normalized.",
  );
  assert(parsed.scratchings.length === 2, "Scratchings were not parsed.");
  assert(
    parsed.scratchings[0].status === "scratched",
    "Scratch status was not classified.",
  );
  assert(
    parsed.scratchings[1].status === "reserve",
    "Reserve runner was not classified.",
  );
  assert(
    parsed.scratchings[1].horseName === "Vihaan's Web",
    "HTML entities were not decoded.",
  );
  assert(
    parsed.jockeyChanges.length === 2,
    "Placeholder jockey should have been ignored.",
  );
  assert(
    parsed.jockeyChanges[0].jockeyName === "Q Ngcobo-4",
    "Claiming jockey was not normalized.",
  );
  assert(
    parsed.jockeyChanges[1].horseName === "Roxbury Park",
    "Draw suffix was not removed.",
  );
});
