import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "@supabase/supabase-js";
import { Webhook } from "svix";

type ResendWebhookEvent = {
  type: string;
  created_at: string;
  data: {
    email_id?: string;
    message_id?: string;
    created_at?: string;
    from?: string;
    to?: string[];
    subject?: string;
    tags?: Record<string, string> | { name: string; value: string }[];
    bounce?: {
      message?: string;
      type?: string;
      subType?: string;
    };
  };
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function requiredEnvironment(name: string) {
  const value = Deno.env.get(name)?.trim();
  if (!value) throw new Error(`${name} is not configured.`);
  return value;
}

function cleanText(value: unknown, maximumLength: number) {
  return String(value ?? "")
    .replace(/[\r\n]+/g, " ")
    .trim()
    .slice(0, maximumLength);
}

function verifyResendEvent(rawBody: string, request: Request) {
  const eventId = request.headers.get("svix-id")?.trim() ?? "";
  const timestamp = request.headers.get("svix-timestamp")?.trim() ?? "";
  const signature = request.headers.get("svix-signature")?.trim() ?? "";

  if (!eventId || !timestamp || !signature) {
    throw new Error("Webhook signature headers are missing.");
  }

  const webhook = new Webhook(requiredEnvironment("RESEND_WEBHOOK_SECRET"));
  const event = webhook.verify(rawBody, {
    "svix-id": eventId,
    "svix-timestamp": timestamp,
    "svix-signature": signature,
  }) as ResendWebhookEvent;

  return { eventId, event };
}

Deno.serve(async (request: Request) => {
  if (request.method !== "POST") {
    return jsonResponse({ error: "Method not allowed." }, 405);
  }

  try {
    const rawBody = await request.text();
    const { eventId, event } = verifyResendEvent(rawBody, request);
    const providerMessageId = cleanText(event.data?.email_id, 200);
    const eventType = cleanText(event.type, 100);
    const eventAt = new Date(event.created_at);

    if (!providerMessageId || !eventType || Number.isNaN(eventAt.getTime())) {
      return jsonResponse({ error: "Webhook payload is incomplete." }, 400);
    }

    const serviceClient = createClient<any>(
      requiredEnvironment("SUPABASE_URL"),
      requiredEnvironment("SUPABASE_SERVICE_ROLE_KEY"),
      { auth: { persistSession: false, autoRefreshToken: false } },
    );
    const { error } = await serviceClient.rpc("record_auth_email_provider_event", {
      p_provider_event_id: eventId,
      p_provider_email_id: providerMessageId,
      p_event_type: eventType,
      p_event_at: eventAt.toISOString(),
      p_details: {
        messageId: cleanText(event.data?.message_id, 300) || null,
        from: cleanText(event.data?.from, 320) || null,
        recipients: Array.isArray(event.data?.to)
          ? event.data.to.slice(0, 5).map((recipient) => cleanText(recipient, 320))
          : [],
        subject: cleanText(event.data?.subject, 300) || null,
        tags: event.data?.tags ?? {},
        bounce: event.data?.bounce
          ? {
            message: cleanText(event.data.bounce.message, 500) || null,
            type: cleanText(event.data.bounce.type, 80) || null,
            subType: cleanText(event.data.bounce.subType, 80) || null,
          }
          : null,
      },
    });

    if (error) {
      console.error("Auth email delivery event could not be recorded", {
        eventId,
        eventType,
        code: error.code,
      });
      return jsonResponse({ error: "Delivery event could not be recorded." }, 500);
    }

    return jsonResponse({ received: true });
  } catch (error) {
    console.error("Auth email webhook verification failed", error);
    return jsonResponse({ error: "Invalid webhook request." }, 400);
  }
});
