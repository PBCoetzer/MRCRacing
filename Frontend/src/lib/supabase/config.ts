export const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
export const supabasePublishableKey =
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "";

const isDevelopmentDeployment =
  process.env.NEXT_PUBLIC_DEPLOYMENT_ENV === "development";
const developmentSupabaseHost = "api-dev.mrcracing.co.za";
const hasUnexpectedDevelopmentSupabaseUrl = (() => {
  if (!isDevelopmentDeployment || !supabaseUrl) return false;
  try {
    return new URL(supabaseUrl).hostname !== developmentSupabaseHost;
  } catch {
    return true;
  }
})();

export const isSupabaseConfigured = Boolean(
  supabaseUrl &&
    supabasePublishableKey &&
    !supabasePublishableKey.includes("PASTE_") &&
    !supabasePublishableKey.includes("<") &&
    !hasUnexpectedDevelopmentSupabaseUrl,
);

export const supabaseConfigMessage = hasUnexpectedDevelopmentSupabaseUrl
  ? "Development safety check blocked a non-development Supabase project. Use the self-hosted development API URL and rebuild."
  : "Supabase is not configured yet. Add NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY to the correct Frontend environment file, then rebuild the static Xneelo package.";
