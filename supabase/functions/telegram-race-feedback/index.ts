import "edge-runtime";
import { createClient } from "@supabase/supabase-js";
import {
  formatFeedbackAcknowledgement,
  parseRaceFeedback,
} from "./feedback.ts";

type TelegramUpdate = {
  action?: string;
  update_id?: number;
  message?: {
    message_id?: number;
    text?: string;
    chat?: { id?: number };
    from?: {
      id?: number;
      username?: string;
      first_name?: string;
      last_name?: string;
    };
    reply_to_message?: { message_id?: number };
  };
};

async function registerTelegramWebhook(
  botToken: string,
  webhookUrl: string,
  webhookSecret: string,
) {
  const response = await fetch(
    `https://api.telegram.org/bot${encodeURIComponent(botToken)}/setWebhook`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        url: webhookUrl,
        secret_token: webhookSecret,
        allowed_updates: ["message"],
        drop_pending_updates: false,
      }),
      signal: AbortSignal.timeout(15_000),
    },
  );
  const result = await response.json().catch(() => null) as {
    ok?: boolean;
    description?: string;
  } | null;
  if (!response.ok || result?.ok !== true) {
    throw new Error(
      result?.description ||
        `Telegram webhook registration failed with HTTP ${response.status}.`,
    );
  }
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function secureEqual(left: string, right: string) {
  const leftBytes = new TextEncoder().encode(left);
  const rightBytes = new TextEncoder().encode(right);
  const maximumLength = Math.max(leftBytes.length, rightBytes.length);
  let mismatch = leftBytes.length ^ rightBytes.length;
  for (let index = 0; index < maximumLength; index += 1) {
    mismatch |= (leftBytes[index] ?? 0) ^ (rightBytes[index] ?? 0);
  }
  return mismatch === 0;
}

async function sendTelegramReply(
  botToken: string,
  chatId: string,
  messageId: number,
  text: string,
) {
  const response = await fetch(
    `https://api.telegram.org/bot${encodeURIComponent(botToken)}/sendMessage`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        reply_parameters: { message_id: messageId },
        link_preview_options: { is_disabled: true },
      }),
      signal: AbortSignal.timeout(15_000),
    },
  );
  const result = await response.json().catch(() => null) as {
    ok?: boolean;
  } | null;
  if (!response.ok || result?.ok !== true) {
    throw new Error(
      `Telegram acknowledgement failed with HTTP ${response.status}.`,
    );
  }
}

Deno.serve(async (request: Request) => {
  if (request.method !== "POST") {
    return jsonResponse({ error: "Method not allowed." }, 405);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const botToken = Deno.env.get("MRC_TELEGRAM_BOT_TOKEN") ?? "";
  const configuredChatId = (Deno.env.get("MRC_TELEGRAM_ADMIN_CHAT_ID") ?? "")
    .trim();
  const webhookSecret = Deno.env.get("MRC_TELEGRAM_WEBHOOK_SECRET") ?? "";
  if (
    !supabaseUrl || !serviceRoleKey || !botToken || !configuredChatId ||
    !webhookSecret
  ) {
    return jsonResponse({
      error: "Telegram feedback configuration is incomplete.",
    }, 500);
  }

  const suppliedSecret = request.headers.get(
    "x-telegram-bot-api-secret-token",
  ) ?? "";
  if (!secureEqual(suppliedSecret, webhookSecret)) {
    return jsonResponse({ error: "Invalid webhook signature." }, 401);
  }

  const update = await request.json().catch(() => null) as
    | TelegramUpdate
    | null;
  if (update?.action === "register_webhook") {
    const webhookUrl = `${supabaseUrl.replace(/\/$/, "")}/functions/v1/telegram-race-feedback`;
    try {
      await registerTelegramWebhook(botToken, webhookUrl, webhookSecret);
      return jsonResponse({ ok: true, registered: true, webhookUrl });
    } catch (error) {
      console.error("Telegram webhook registration failed", {
        message: error instanceof Error ? error.message : "Unknown error.",
      });
      return jsonResponse({ error: "Telegram webhook registration failed." }, 502);
    }
  }
  const message = update?.message;
  const chatId = message?.chat?.id;
  const incomingMessageId = message?.message_id;
  const replyToMessageId = message?.reply_to_message?.message_id;
  if (
    !Number.isSafeInteger(update?.update_id) || !Number.isSafeInteger(chatId) ||
    !Number.isSafeInteger(incomingMessageId) ||
    !Number.isSafeInteger(replyToMessageId) || !message?.text
  ) {
    return jsonResponse({ ok: true, ignored: true });
  }
  if (String(chatId) !== configuredChatId) {
    return jsonResponse({ ok: true, ignored: true });
  }

  let parsed;
  try {
    parsed = parseRaceFeedback(message.text);
  } catch (error) {
    await sendTelegramReply(
      botToken,
      configuredChatId,
      incomingMessageId!,
      error instanceof Error ? error.message : "Feedback could not be read.",
    ).catch(() => undefined);
    return jsonResponse({ ok: true, ignored: true });
  }

  const serviceClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const displayName = [message.from?.first_name, message.from?.last_name]
    .filter(Boolean)
    .join(" ")
    .slice(0, 160);
  const { data, error } = await serviceClient.rpc(
    "record_telegram_race_feedback",
    {
      p_telegram_update_id: update!.update_id,
      p_incoming_message_id: incomingMessageId,
      p_reply_to_message_id: replyToMessageId,
      p_chat_id: chatId,
      p_telegram_user_id: message.from?.id ?? null,
      p_telegram_username: message.from?.username?.slice(0, 80) ?? null,
      p_telegram_display_name: displayName || null,
      p_feedback_text: parsed.text,
      p_parsed_hint: parsed.hint,
      p_metadata: {
        receivedAt: new Date().toISOString(),
        updateType: "message_reply",
      },
    },
  );
  if (error) {
    console.error("Telegram feedback recording failed", {
      updateId: update?.update_id,
      code: error.code,
    });
    return jsonResponse({ error: "Feedback could not be recorded." }, 500);
  }

  const outcome = data as { status?: string } | null;
  if (outcome?.status === "recorded") {
    await sendTelegramReply(
      botToken,
      configuredChatId,
      incomingMessageId!,
      formatFeedbackAcknowledgement(parsed.hint),
    ).catch((acknowledgementError) => {
      console.error("Telegram feedback acknowledgement failed", {
        updateId: update?.update_id,
        message: acknowledgementError instanceof Error
          ? acknowledgementError.message
          : "Unknown acknowledgement error.",
      });
    });
  } else if (outcome?.status === "ignored") {
    await sendTelegramReply(
      botToken,
      configuredChatId,
      incomingMessageId!,
      "⚠️ This reply could not be linked to a current MRC race-change alert. Reply directly to the alert you want reviewed.",
    ).catch(() => undefined);
  }

  return jsonResponse({ ok: true, status: outcome?.status ?? "duplicate" });
});
