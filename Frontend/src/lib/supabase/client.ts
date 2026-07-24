import { createBrowserClient } from "@supabase/ssr";
import {
  isSupabaseConfigured,
  supabaseConfigMessage,
  supabasePublishableKey,
  supabaseUrl,
} from "@/lib/supabase/config";

type BrowserClient = ReturnType<typeof createBrowserClient>;

export function createClient(): BrowserClient | null {
  if (!isSupabaseConfigured) {
    return null;
  }

  return createBrowserClient(supabaseUrl, supabasePublishableKey);
}

export function createRequiredClient() {
  const client = createClient();

  if (!client) {
    throw new Error(supabaseConfigMessage);
  }

  return client;
}
