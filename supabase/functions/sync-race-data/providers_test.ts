import {
  extractStructured,
  groundedSearch,
  ollamaWebFetchOnly,
  ollamaWebSearchOnly,
  parseKnownRaceDetailEvidence,
  type GroundedSearchResult,
  type WorkerConfiguration,
} from "./providers.ts";

function assertEquals(actual: unknown, expected: unknown) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`Expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}.`);
  }
}

async function assertRejects(action: () => Promise<unknown>, message: string) {
  try {
    await action();
  } catch (error) {
    if (error instanceof Error && error.message.includes(message)) return;
    throw error;
  }
  throw new Error(`Expected rejection containing ${message}.`);
}

function configuration(): WorkerConfiguration {
  return {
    searchProvider: "ollama",
    extractionProvider: "groq",
    searchBaseUrl: "https://ollama.example/api",
    searchApiKey: "test-search-key",
    searchModel: "ollama-web-search",
    extractionBaseUrl: "https://groq.example/openai/v1",
    extractionApiKey: "test-extraction-key",
    extractionModel: "openai/gpt-oss-20b",
    responseMode: "json_schema",
    telemetry: {
      searchRequests: 0,
      fetchRequests: 0,
      extractionRequests: 0,
      inputTokens: 0,
      outputTokens: 0,
    },
  };
}

Deno.test("Ollama search filters blocked domains and fetches permitted evidence", async () => {
  const activeConfiguration = configuration();
  const fetcher = (async (input: string | URL | Request) => {
    const url = String(input);
    if (url.endsWith("/web_search")) {
      return Response.json({
        results: [
          { title: "Approved card", url: "https://approved.example/race/1", content: "Search snippet" },
          { title: "Evidence result", url: "https://evidence.example/race/1", content: "Second source" },
          { title: "Blocked result", url: "https://blocked.example/race/1", content: "Do not use" },
        ],
      });
    }
    if (url.endsWith("/web_fetch")) {
      return Response.json({ title: "Approved card", content: "Complete factual race card" });
    }
    return new Response("not found", { status: 404 });
  }) as typeof fetch;

  const result = await groundedSearch(
    activeConfiguration,
    "Find Race 1",
    "race_1",
    {
      preferredUrls: [],
      sourcePolicies: [
        { domain: "approved.example", status: "approved", directFetchAllowed: true },
        { domain: "evidence.example", status: "evidence_only", directFetchAllowed: false },
        { domain: "blocked.example", status: "blocked", directFetchAllowed: false },
      ],
    },
    fetcher,
  );

  assertEquals(result.evidence.map((item) => item.domain), ["approved.example", "evidence.example"]);
  assertEquals(result.evidence[0].excerpt, "Complete factual race card");
  assertEquals(activeConfiguration.telemetry.searchRequests, 1);
  assertEquals(activeConfiguration.telemetry.fetchRequests, 1);
});

Deno.test("Groq extraction uses strict schema and records provider token usage", async () => {
  const activeConfiguration = configuration();
  const evidence: GroundedSearchResult = {
    text: "Race evidence",
    evidence: [{
      domain: "approved.example",
      url: "https://approved.example/race/1",
      title: "Race 1",
      retrievedAt: new Date().toISOString(),
      excerpt: "Horse One",
      factScope: "race_1",
      factPayload: {},
      groundingPayload: {},
    }],
  };
  const fetcher = (async (_input: string | URL | Request, init?: RequestInit) => {
    const request = JSON.parse(String(init?.body)) as Record<string, unknown>;
    assertEquals(request.model, "openai/gpt-oss-20b");
    assertEquals((request.response_format as { type: string }).type, "json_schema");
    assertEquals(request.max_completion_tokens, 1_800);
    if (String(init?.body).includes("groundedSearchText")) {
      throw new Error("Extraction request duplicated grounded search text.");
    }
    return Response.json({
      choices: [{ message: { content: JSON.stringify({ value: "accepted" }) } }],
      usage: { prompt_tokens: 120, completion_tokens: 20 },
    });
  }) as typeof fetch;

  const result = await extractStructured<{ value: string }>(
    activeConfiguration,
    {
      name: "provider_test",
      strict: true,
      schema: {
        type: "object",
        additionalProperties: false,
        required: ["value"],
        properties: { value: { type: "string" } },
      },
    },
    "Extract the value.",
    evidence,
    {},
    fetcher,
  );

  assertEquals(result, { value: "accepted" });
  assertEquals(activeConfiguration.telemetry.extractionRequests, 1);
  assertEquals(activeConfiguration.telemetry.inputTokens, 120);
  assertEquals(activeConfiguration.telemetry.outputTokens, 20);
});

Deno.test("Ollama search fails closed when every result is blocked", async () => {
  const activeConfiguration = configuration();
  const fetcher = (async () => Response.json({
    results: [{ title: "Blocked", url: "https://blocked.example/race/1", content: "Blocked content" }],
  })) as typeof fetch;

  await assertRejects(
    () => groundedSearch(
      activeConfiguration,
      "Find Race 1",
      "race_1",
      {
        preferredUrls: [],
        sourcePolicies: [{ domain: "blocked.example", status: "blocked", directFetchAllowed: false }],
      },
      fetcher,
    ),
    "no usable race evidence",
  );
});

Deno.test("Search Lab uses Ollama search without page fetches or extraction", async () => {
  const activeConfiguration = configuration();
  const requestedUrls: string[] = [];
  const requestBodies: Array<{ query: string; max_results: number }> = [];
  const manualQuery = "Find upcoming South African meetings exactly as requested: punctuation, dates 2026-08-11 to 2026-08-17.";
  const fetcher = (async (input: string | URL | Request, init?: RequestInit) => {
    requestedUrls.push(String(input));
    requestBodies.push(JSON.parse(String(init?.body)) as { query: string; max_results: number });
    return Response.json({
      results: [
        ...Array.from({ length: 12 }, (_, index) => ({
          title: `Calendar ${index + 1}`,
          url: `https://calendar-${index + 1}.example/za`,
          content: `Upcoming South African meeting ${index + 1}`,
        })),
        { title: "Blocked", url: "https://blocked.example/za", content: "Blocked source" },
        { title: "Invalid", url: "javascript:alert(1)", content: "Invalid URL" },
      ],
    });
  }) as typeof fetch;

  const result = await ollamaWebSearchOnly(
    activeConfiguration,
    manualQuery,
    "upcoming_calendar",
    {
      preferredUrls: [],
      sourcePolicies: [
        { domain: "blocked.example", status: "blocked", directFetchAllowed: false },
      ],
    },
    fetcher,
  );

  assertEquals(result.evidence.length, 10);
  assertEquals(requestedUrls, ["https://ollama.example/api/web_search"]);
  assertEquals(requestBodies, [{ query: manualQuery, max_results: 10 }]);
  assertEquals(activeConfiguration.telemetry.searchRequests, 1);
  assertEquals(activeConfiguration.telemetry.fetchRequests, 0);
  assertEquals(activeConfiguration.telemetry.extractionRequests, 0);
});

Deno.test("Extraction preview fetches only explicit non-blocked HTTPS pages", async () => {
  const activeConfiguration = configuration();
  const requestedPages: string[] = [];
  const fetcher = (async (input: string | URL | Request, init?: RequestInit) => {
    requestedPages.push((JSON.parse(String(init?.body)) as { url: string }).url);
    return Response.json({ title: "Complete racecard", content: "Race 1\n1 Horse One\n2 Horse Two" });
  }) as typeof fetch;

  const result = await ollamaWebFetchOnly(
    activeConfiguration,
    [
      "https://approved.example/race/1",
      "https://approved.example/race/1",
      "http://insecure.example/race/1",
      "https://blocked.example/race/1",
    ],
    "preview_race_1",
    {
      preferredUrls: [],
      sourcePolicies: [{ domain: "blocked.example", status: "blocked", directFetchAllowed: false }],
    },
    fetcher,
  );

  assertEquals(requestedPages, ["https://approved.example/race/1"]);
  assertEquals(result.evidence.map((item) => item.domain), ["approved.example"]);
  assertEquals(result.evidence[0].factPayload, { retrievalMethod: "admin_preview_web_fetch" });
  assertEquals(activeConfiguration.telemetry.fetchRequests, 1);
  assertEquals(activeConfiguration.telemetry.searchRequests, 0);
});

Deno.test("Extraction preview retains a complete bounded racecard after its race marker", async () => {
  const activeConfiguration = configuration();
  const racecard = [
    "Navigation and unrelated page content",
    "### Vaal (SAF)",
    "| 11:15 Thu 13 August 2026 | |",
    "| 4RACING WELCOMES YOU MAIDEN PLATE | |",
    "| Runners : 6 runners | Distance : 1m 3f 205y |",
    "Race 1",
    "Pedigree",
    "Recent Form",
    "x".repeat(10_800),
    "| SPECIAL RUNNER ONE (SAF) | Jockey Zero | 4 | 9-6 | Bet |",
    "y".repeat(800),
    "| | | | 123 | | HORSE ONE (SAF) (10) | Jockey One | 4 | 9-6 | Bet |",
    "| 1 (2) | | J: Jockey One T: Trainer One, South Africa Age: 4 Wgt: 9-6 | |",
    "| | | | 456 | | RESERVE RUNNER (SAF) (11) | Jockey Six | 3 | 8-9 | Bet |",
    "| 6 (5) | | J: Jockey Six T: Trainer Six, South Africa Age: 3 Wgt: 8-9 | |",
    "Analyst Verdict",
    "Betting content that must not be retained",
  ].join("\n");
  const fetcher = (async () => Response.json({ title: "Complete racecard", content: racecard })) as typeof fetch;

  const result = await ollamaWebFetchOnly(
    activeConfiguration,
    ["https://approved.example/race/1"],
    "preview_race_1",
    { preferredUrls: [], sourcePolicies: [] },
    fetcher,
  );

  if (!result.evidence[0].excerpt?.includes("RESERVE RUNNER")) {
    throw new Error("Focused racecard evidence omitted a later runner.");
  }
  if (!result.evidence[0].excerpt?.includes("SPECIAL RUNNER ONE")) {
    throw new Error("Focused racecard evidence omitted the leading runner before the standard table marker.");
  }
  if (result.evidence[0].excerpt?.includes("x".repeat(1_500))) {
    throw new Error("Focused racecard evidence retained an unbounded form-history block.");
  }
  if (result.evidence[0].excerpt?.includes("Betting content")) {
    throw new Error("Focused racecard evidence retained content after the runner table.");
  }
  if ((result.evidence[0].excerpt?.length ?? 0) > 9_000) {
    throw new Error("Focused racecard evidence exceeded its bounded size.");
  }
});

Deno.test("Known Timeform racecards parse every runner deterministically", () => {
  const excerpt = [
    "# Vaal (SAF) 11:15",
    "| 11:15 Thu 13 August 2026 | |",
    "| 4RACING WELCOMES YOU MAIDEN PLATE | |",
    "| Purse : R6,849 Age : 3yo+ Surface: Turf Runners : 2 runners | Distance : 1m 3f 205y |",
    "Runner table",
    "| 123 | | 1 (4) EPIDAURUS (SAF) (7) |",
    "| 1 (4) | | J: Kyle Strydom T: W/W Marwing, South Africa Age: 4 Wgt: 9-6 | |",
    "| 456 | | 2 (5) PLACEHOLDER RUNNER (SAF) (8) |",
    "| 2 (5) | | J: Craig Zackey T: S. G. Tarry, South Africa Age: 3 Wgt: 8-9 | |",
  ].join("\n");
  const extraction = parseKnownRaceDetailEvidence({
    domain: "timeformracing.com",
    url: "https://www.timeformracing.com/race/1",
    title: "Vaal Race 1",
    retrievedAt: new Date().toISOString(),
    excerpt,
    factScope: "race_1",
    factPayload: {},
    groundingPayload: {},
  }, { venue: "Vaal", meetingDate: "2026-08-13", raceNumber: 1 });

  assertEquals(extraction?.race.distanceMetres, 2400);
  assertEquals(extraction?.race.runners, [
    {
      saddleNumber: 1,
      horseName: "EPIDAURUS",
      jockeyName: "Kyle Strydom",
      trainerName: "W/W Marwing, South Africa",
      draw: 4,
      carriedWeight: 59.9,
      status: "active",
      resultPosition: null,
    },
    {
      saddleNumber: 2,
      horseName: "PLACEHOLDER RUNNER",
      jockeyName: "Craig Zackey",
      trainerName: "S. G. Tarry, South Africa",
      draw: 5,
      carriedWeight: 54.9,
      status: "reserve",
      resultPosition: null,
    },
  ]);
});

Deno.test("Known Timeform search snippets parse their compact repeated runner rows", () => {
  const excerpt = [
    "# Vaal (SAF) 13:00",
    "## 13:00 Thu 13 August 2026",
    "### #YOUCANBETONUS! MAIDEN PLATE (3-year-olds)",
    "Purse : R6,849 Age : 3yo Surface: Turf Runners : 1",
    "Distance : 7f 210y",
    "Runners : 1 runner",
    "| 733 | | CRIMSON RANGER (SAF) (14) | Gavin Lerena | 3 | 9-6 | Bet |",
    "| 1 (4) | b c DECLARATIONOFPEACE (USA) | J: Gavin Lerena T: R. R. Magner, South Africa |",
    "| 733 | | 1 (4) CRIMSON RANGER (SAF) (14) | Bet |",
    "| 1 (4) | J: Gavin Lerena T: R. R. Magner, South Africa Age: 3 Wgt: 9-6 |",
  ].join("\n");
  const extraction = parseKnownRaceDetailEvidence({
    domain: "timeformracing.com",
    url: "https://www.timeformracing.com/race/4",
    title: "13:00 Vaal",
    retrievedAt: new Date().toISOString(),
    excerpt,
    factScope: "meeting_schedule",
    factPayload: {},
    groundingPayload: {},
  }, { venue: "Vaal", meetingDate: "2026-08-13", raceNumber: 4 });

  assertEquals(extraction?.race.title, "#YOUCANBETONUS! MAIDEN PLATE (3-year-olds)");
  assertEquals(extraction?.race.distanceMetres, 1600);
  assertEquals(extraction?.race.runners.length, 1);
  assertEquals(extraction?.race.runners[0].horseName, "CRIMSON RANGER");
  assertEquals(parseKnownRaceDetailEvidence({
    domain: "timeformracing.com",
    url: "https://www.timeformracing.com/race/3",
    title: "13:00 Vaal",
    retrievedAt: new Date().toISOString(),
    excerpt,
    factScope: "meeting_schedule",
    factPayload: {},
    groundingPayload: {},
  }, { venue: "Vaal", meetingDate: "2026-08-13", raceNumber: 4, startTime: "13:00" }), null);
  assertEquals(parseKnownRaceDetailEvidence({
    domain: "timeformracing.com",
    url: "https://www.timeformracing.com/race/4",
    title: "13:00 Vaal",
    retrievedAt: new Date().toISOString(),
    excerpt,
    factScope: "meeting_schedule",
    factPayload: {},
    groundingPayload: {},
  }, { venue: "Vaal", meetingDate: "2026-08-13", raceNumber: 4, startTime: "13:35" }), null);
});

Deno.test("Groq extraction falls back to validated JSON after strict schema failure", async () => {
  const activeConfiguration = configuration();
  const formats: string[] = [];
  const fetcher = (async (_input: string | URL | Request, init?: RequestInit) => {
    const request = JSON.parse(String(init?.body)) as { response_format: { type: string } };
    formats.push(request.response_format.type);
    if (formats.length === 1) {
      return Response.json({ error: { message: "Generated JSON does not match the expected schema." } }, {
        status: 400,
      });
    }
    if (!String(init?.body).includes("The required JSON Schema is")) {
      throw new Error("Fallback request omitted the validation schema.");
    }
    return Response.json({
      choices: [{ message: { content: JSON.stringify({ value: "accepted" }) } }],
      usage: { prompt_tokens: 20, completion_tokens: 5 },
    });
  }) as typeof fetch;

  const result = await extractStructured<{ value: string }>(
    activeConfiguration,
    {
      name: "fallback_test",
      strict: true,
      schema: {
        type: "object",
        additionalProperties: false,
        required: ["value"],
        properties: { value: { type: "string" } },
      },
    },
    "Extract the value.",
    {
      text: "Evidence",
      evidence: [{
        domain: "approved.example",
        url: "https://approved.example/value",
        title: "Value",
        retrievedAt: new Date().toISOString(),
        excerpt: "accepted",
        factScope: "fallback_test",
        factPayload: {},
        groundingPayload: {},
      }],
    },
    {},
    fetcher,
  );

  assertEquals(result, { value: "accepted" });
  assertEquals(formats, ["json_schema", "json_object"]);
});

Deno.test("Groq extraction performs one bounded retry after HTTP 429", async () => {
  const activeConfiguration = configuration();
  let attempts = 0;
  const fetcher = (async () => {
    attempts += 1;
    if (attempts === 1) {
      return Response.json({ error: { message: "Rate limited; try again in 0.01s" } }, { status: 429 });
    }
    return Response.json({
      choices: [{ message: { content: JSON.stringify({ value: "accepted" }) } }],
      usage: { prompt_tokens: 20, completion_tokens: 5 },
    });
  }) as typeof fetch;

  const result = await extractStructured<{ value: string }>(
    activeConfiguration,
    {
      name: "retry_test",
      strict: true,
      schema: {
        type: "object",
        additionalProperties: false,
        required: ["value"],
        properties: { value: { type: "string" } },
      },
    },
    "Extract the value.",
    {
      text: "Evidence",
      evidence: [{
        domain: "approved.example",
        url: "https://approved.example/value",
        title: "Value",
        retrievedAt: new Date().toISOString(),
        excerpt: "accepted",
        factScope: "retry_test",
        factPayload: {},
        groundingPayload: {},
      }],
    },
    {},
    fetcher,
  );

  assertEquals(result, { value: "accepted" });
  assertEquals(attempts, 2);
  assertEquals(activeConfiguration.telemetry.extractionRequests, 2);
});
