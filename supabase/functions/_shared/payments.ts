import { createClient, SupabaseClient } from "@supabase/supabase-js";
import SparkMD5 from "spark-md5";

export type PaymentProvider = "payfast" | "ozow";

export const allowedOrigins = new Set([
  "https://mrcracing.co.za",
  "https://www.mrcracing.co.za",
  "http://localhost:3000",
]);

export function corsHeaders(request: Request) {
  const origin = request.headers.get("origin") ?? "";

  return {
    "Access-Control-Allow-Origin": allowedOrigins.has(origin)
      ? origin
      : "https://www.mrcracing.co.za",
    "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-idempotency-key",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    Vary: "Origin",
  };
}

export function jsonResponse(request: Request, body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders(request),
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
  });
}

export function textResponse(body: string, status = 200) {
  return new Response(body, {
    status,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

export function createServiceClient() {
  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("Supabase payment configuration is incomplete.");
  }

  return createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}

export async function requireUser(
  request: Request,
  serviceClient: SupabaseClient,
) {
  const accessToken = (request.headers.get("authorization") ?? "")
    .replace(/^Bearer\s+/i, "");

  if (!accessToken) {
    throw new Error("Authentication required.");
  }

  const { data, error } = await serviceClient.auth.getUser(accessToken);

  if (error || !data.user) {
    throw new Error("Invalid authenticated session.");
  }

  return data.user;
}

export function isPaymentsEnabled() {
  return (Deno.env.get("PAYMENTS_ENABLED") ?? "").toLowerCase() === "true";
}

export function phpUrlEncode(value: string) {
  return encodeURIComponent(value)
    .replace(/%20/g, "+")
    .replace(/[!'()*~]/g, (character) =>
      `%${character.charCodeAt(0).toString(16).toUpperCase()}`
    );
}

export function signPayFast(
  fields: Array<[string, string]>,
  passphrase: string,
) {
  const signatureFields = fields
    .filter(([key, value]) => key !== "signature" && value !== "")
    .map(([key, value]) => `${key}=${phpUrlEncode(value.trim())}`);

  if (passphrase) {
    signatureFields.push(`passphrase=${phpUrlEncode(passphrase.trim())}`);
  }

  return SparkMD5.hash(signatureFields.join("&"));
}

export async function sha512Hex(value: string) {
  const digest = await crypto.subtle.digest(
    "SHA-512",
    new TextEncoder().encode(value),
  );

  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export async function signOzow(
  orderedValues: string[],
  privateKey: string,
) {
  return sha512Hex(`${orderedValues.join("")}${privateKey}`.toLowerCase());
}

export function safeMoney(cents: number) {
  return (cents / 100).toFixed(2);
}

export function sanitizeProviderEvent(
  event: Record<string, unknown>,
  allowedKeys: string[],
) {
  return Object.fromEntries(
    allowedKeys
      .filter((key) => event[key] !== undefined)
      .map((key) => [key, String(event[key] ?? "").slice(0, 300)]),
  );
}

export function safeEqual(left: string, right: string) {
  const leftBytes = new TextEncoder().encode(left.toLowerCase());
  const rightBytes = new TextEncoder().encode(right.toLowerCase());

  if (leftBytes.length !== rightBytes.length) {
    return false;
  }

  let difference = 0;

  for (let index = 0; index < leftBytes.length; index += 1) {
    difference |= leftBytes[index] ^ rightBytes[index];
  }

  return difference === 0;
}

function ipToInteger(ipAddress: string) {
  const octets = ipAddress.split(".").map(Number);

  if (
    octets.length !== 4 ||
    octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)
  ) {
    return null;
  }

  return octets.reduce(
    (result, octet) => ((result << 8) | octet) >>> 0,
    0,
  );
}

function isIpInCidr(ipAddress: string, cidr: string) {
  const [networkAddress, prefixValue = "32"] = cidr.split("/");
  const ip = ipToInteger(ipAddress);
  const network = ipToInteger(networkAddress);
  const prefix = Number(prefixValue);

  if (
    ip === null ||
    network === null ||
    !Number.isInteger(prefix) ||
    prefix < 0 ||
    prefix > 32
  ) {
    return false;
  }

  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  return (ip & mask) === (network & mask);
}

export function isPayFastSource(request: Request) {
  const forwardedFor = request.headers.get("x-forwarded-for") ?? "";
  const connectingIp = request.headers.get("cf-connecting-ip") ?? "";
  const remoteIp = (connectingIp || forwardedFor.split(",")[0] || "").trim();
  const ranges = [
    "197.97.145.144/28",
    "41.74.179.192/27",
    "102.216.36.0/28",
    "102.216.36.128/28",
    "144.126.193.139/32",
  ];

  return Boolean(remoteIp && ranges.some((range) => isIpInCidr(remoteIp, range)));
}

export function paymentReturnUrl(
  functionUrl: string,
  paymentId: string,
  outcome: "success" | "cancelled" | "error",
) {
  const url = new URL(functionUrl);
  url.searchParams.set("payment", paymentId);
  url.searchParams.set("outcome", outcome);
  return url.toString();
}

export function providerReferenceFromPayload(
  payload: Record<string, string>,
) {
  return payload.pf_payment_id ||
    payload.TransactionId ||
    payload.transactionId ||
    "";
}
