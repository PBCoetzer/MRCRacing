"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, Loader2, Save, UserRound } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createClient } from "@/lib/supabase/client";

type ProfileDraft = {
  firstName: string;
  lastName: string;
  displayName: string;
  phone: string;
};

type ProfileSettingsClientProps = {
  onSaved?: (profile: ProfileDraft) => void;
};

function errorMessage(error: unknown, fallback: string) {
  if (typeof error === "object" && error && "message" in error) {
    return String(error.message);
  }

  return fallback;
}

function formatLastSignIn(value: string | undefined) {
  if (!value) {
    return "No previous sign-in recorded";
  }

  return new Intl.DateTimeFormat("en-ZA", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Africa/Johannesburg",
  }).format(new Date(value));
}

export function ProfileSettingsClient({ onSaved }: ProfileSettingsClientProps) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [email, setEmail] = useState("");
  const [lastSignInAt, setLastSignInAt] = useState<string>();
  const [userId, setUserId] = useState("");
  const [draft, setDraft] = useState<ProfileDraft>({
    firstName: "",
    lastName: "",
    displayName: "",
    phone: "",
  });

  const loadProfile = useCallback(async () => {
    const supabase = createClient();

    if (!supabase) {
      setError("Account services are not configured.");
      setLoading(false);
      return;
    }

    setLoading(true);
    setError("");

    try {
      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser();

      if (userError || !user) {
        throw new Error(userError?.message ?? "Please sign in again.");
      }

      const { data, error: profileError } = await supabase
        .from("profiles")
        .select("first_name,last_name,display_name,phone")
        .eq("id", user.id)
        .maybeSingle();

      if (profileError) {
        throw profileError;
      }

      setUserId(user.id);
      setEmail(user.email ?? "");
      setLastSignInAt(user.last_sign_in_at);
      setDraft({
        firstName: data?.first_name ?? "",
        lastName: data?.last_name ?? "",
        displayName: data?.display_name ?? "",
        phone: data?.phone ?? "",
      });
    } catch (loadError) {
      setError(errorMessage(loadError, "Your profile could not be loaded."));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => void loadProfile(), 0);

    return () => window.clearTimeout(timeoutId);
  }, [loadProfile]);

  async function saveProfile() {
    const supabase = createClient();

    if (!supabase || !userId) {
      setError("Your signed-in account could not be verified.");
      return;
    }

    const displayName = draft.displayName.trim();
    if (!displayName) {
      setError("Please enter a display name.");
      return;
    }

    setSaving(true);
    setError("");
    setMessage("");

    const updatedProfile = {
      firstName: draft.firstName.trim(),
      lastName: draft.lastName.trim(),
      displayName,
      phone: draft.phone.trim(),
    };
    const { error: updateError } = await supabase
      .from("profiles")
      .update({
        first_name: updatedProfile.firstName || null,
        last_name: updatedProfile.lastName || null,
        display_name: updatedProfile.displayName,
        phone: updatedProfile.phone || null,
      })
      .eq("id", userId);

    if (updateError) {
      setError(updateError.message);
      setSaving(false);
      return;
    }

    setDraft(updatedProfile);
    setMessage("Your profile details were saved.");
    setSaving(false);
    onSaved?.(updatedProfile);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <UserRound className="size-5 text-brand-cyan" />
          My profile
        </CardTitle>
        <CardDescription>
          Review your account identity and update the contact details used across MRC Racing.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {error ? (
          <Alert variant="destructive">
            <AlertTriangle className="size-4" />
            <AlertTitle>Profile update failed</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}
        {message ? (
          <Alert>
            <CheckCircle2 className="size-4" />
            <AlertTitle>Profile updated</AlertTitle>
            <AlertDescription>{message}</AlertDescription>
          </Alert>
        ) : null}
        {loading ? (
          <div className="flex min-h-40 items-center justify-center gap-2 text-muted-foreground">
            <Loader2 className="size-5 animate-spin" />
            Loading your profile…
          </div>
        ) : (
          <>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="profile-first-name">First name</Label>
                <Input
                  id="profile-first-name"
                  value={draft.firstName}
                  onChange={(event) => setDraft((current) => ({ ...current, firstName: event.target.value }))}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="profile-last-name">Surname</Label>
                <Input
                  id="profile-last-name"
                  value={draft.lastName}
                  onChange={(event) => setDraft((current) => ({ ...current, lastName: event.target.value }))}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="profile-display-name">Display name</Label>
                <Input
                  id="profile-display-name"
                  required
                  value={draft.displayName}
                  onChange={(event) => setDraft((current) => ({ ...current, displayName: event.target.value }))}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="profile-phone">Cell number</Label>
                <Input
                  id="profile-phone"
                  inputMode="tel"
                  placeholder="+27"
                  value={draft.phone}
                  onChange={(event) => setDraft((current) => ({ ...current, phone: event.target.value }))}
                />
              </div>
            </div>
            <div className="grid gap-3 rounded-lg border bg-background/40 p-4 text-sm sm:grid-cols-2">
              <div>
                <p className="text-muted-foreground">Account email</p>
                <p className="mt-1 break-all font-medium">{email}</p>
              </div>
              <div>
                <p className="text-muted-foreground">Last successful login</p>
                <p className="mt-1 font-medium">{formatLastSignIn(lastSignInAt)}</p>
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              Email changes require a separate verified authentication flow and are not changed by this form.
            </p>
            <Button type="button" disabled={saving} onClick={() => void saveProfile()}>
              {saving ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
              Save profile
            </Button>
          </>
        )}
      </CardContent>
    </Card>
  );
}

