import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "@supabase/supabase-js";

const maxBytes = 5 * 1024 * 1024;
const allowedOrigins = new Set([
  "https://mrcracing.co.za",
  "https://www.mrcracing.co.za",
  "http://localhost:3000",
]);

function headers(request: Request) {
  const origin = request.headers.get("origin") ?? "";
  return {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Vary": "Origin",
    ...(allowedOrigins.has(origin)
      ? { "Access-Control-Allow-Origin": origin }
      : {}),
    "Access-Control-Allow-Headers": "authorization, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };
}

function json(request: Request, body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: headers(request),
  });
}

function isWebp(bytes: Uint8Array) {
  return bytes.length >= 12 &&
    new TextDecoder().decode(bytes.slice(0, 4)) === "RIFF" &&
    new TextDecoder().decode(bytes.slice(8, 12)) === "WEBP";
}

function safeError(error: unknown) {
  return (error instanceof Error ? error.message : "Cover upload failed.")
    .replace(/[\r\n]+/g, " ")
    .slice(0, 500);
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: headers(request) });
  }
  if (request.method !== "POST") {
    return json(request, { error: "Method not allowed." }, 405);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const accessToken = (request.headers.get("authorization") ?? "").replace(
    /^Bearer\s+/i,
    "",
  );
  if (!supabaseUrl || !anonKey || !serviceRoleKey || !accessToken) {
    return json(request, {
      error: "Authenticated upload configuration is incomplete.",
    }, 401);
  }

  const authClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const serviceClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  try {
    const { data: authData, error: authError } = await authClient.auth.getUser(
      accessToken,
    );
    if (authError || !authData.user) {
      return json(request, { error: "Authentication required." }, 401);
    }

    const form = await request.formData();
    const postId = String(form.get("postId") ?? "").trim();
    const file = form.get("file");
    if (!/^[0-9a-f-]{36}$/i.test(postId) || !(file instanceof File)) {
      return json(request, {
        error: "A draft post and WebP cover file are required.",
      }, 400);
    }
    if (file.type !== "image/webp" || file.size <= 0 || file.size > maxBytes) {
      return json(request, {
        error: "Cover images must be WebP and no larger than 5 MB.",
      }, 400);
    }

    const bytes = new Uint8Array(await file.arrayBuffer());
    if (!isWebp(bytes)) {
      return json(request, {
        error: "The file signature is not a valid WebP image.",
      }, 400);
    }

    const { data: tipster, error: tipsterError } = await serviceClient
      .from("tipsters")
      .select("id,is_verified,tipster_blog_permissions(can_publish)")
      .eq("user_id", authData.user.id)
      .maybeSingle();
    if (tipsterError) throw tipsterError;

    const { data: accountControl, error: accountError } = await serviceClient
      .from("user_account_controls")
      .select("status,suspension_until")
      .eq("user_id", authData.user.id)
      .maybeSingle();
    if (accountError) throw accountError;

    const permission = Array.isArray(tipster?.tipster_blog_permissions)
      ? tipster.tipster_blog_permissions[0]
      : tipster?.tipster_blog_permissions;
    const accountActive = !accountControl ||
      ["active", "flagged"].includes(accountControl.status) ||
      (accountControl.status === "suspended" &&
        accountControl.suspension_until &&
        Date.parse(accountControl.suspension_until) <= Date.now());
    if (
      !tipster?.id || tipster.is_verified !== true ||
      permission?.can_publish !== true || !accountActive
    ) {
      return json(
        request,
        { error: "Blog publishing permission is required." },
        403,
      );
    }

    const { data: post, error: postError } = await serviceClient
      .from("blog_posts")
      .select("id,tipster_id,status")
      .eq("id", postId)
      .eq("tipster_id", tipster.id)
      .maybeSingle();
    if (postError) throw postError;
    if (!post || !["draft", "published"].includes(post.status)) {
      return json(request, {
        error: "An editable draft owned by this tipster is required.",
      }, 403);
    }

    const path = `${tipster.id}/${post.id}/cover-${Date.now()}.webp`;
    const { error: uploadError } = await serviceClient.storage
      .from("blog-media")
      .upload(path, bytes, {
        contentType: "image/webp",
        upsert: false,
        cacheControl: "31536000",
      });
    if (uploadError) throw uploadError;

    const { data: publicUrl } = serviceClient.storage.from("blog-media")
      .getPublicUrl(path);
    return json(request, {
      status: "succeeded",
      path,
      publicUrl: publicUrl.publicUrl,
    });
  } catch (error) {
    return json(request, { status: "failed", error: safeError(error) }, 500);
  }
});
