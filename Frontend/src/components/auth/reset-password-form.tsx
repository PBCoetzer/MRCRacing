"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";
import { AlertCircle, CheckCircle2, Loader2 } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createClient } from "@/lib/supabase/client";
import { supabaseConfigMessage } from "@/lib/supabase/config";

type FormState = {
  kind: "idle" | "success" | "error";
  message: string;
};

export function ResetPasswordForm() {
  const [formState, setFormState] = useState<FormState>({
    kind: "idle",
    message: "",
  });
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const supabase = createClient();

    if (!supabase) {
      setFormState({ kind: "error", message: supabaseConfigMessage });
      return;
    }

    const formData = new FormData(event.currentTarget);
    const password = String(formData.get("password") ?? "");
    const confirmPassword = String(formData.get("confirmPassword") ?? "");

    if (password !== confirmPassword) {
      setFormState({ kind: "error", message: "Passwords do not match." });
      return;
    }

    setIsSubmitting(true);
    setFormState({ kind: "idle", message: "" });

    try {
      const { error } = await supabase.auth.updateUser({ password });

      if (error) {
        throw error;
      }

      await supabase.auth.signOut();
      setFormState({
        kind: "success",
        message: "Password updated. You can now log in with your new password.",
      });
    } catch (error) {
      setFormState({
        kind: "error",
        message:
          error instanceof Error
            ? error.message
            : "Could not update your password. Please request a fresh reset link.",
      });
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <form className="grid gap-4" onSubmit={handleSubmit}>
      {formState.kind !== "idle" ? (
        <Alert variant={formState.kind === "error" ? "destructive" : "default"}>
          {formState.kind === "error" ? (
            <AlertCircle className="size-4" />
          ) : (
            <CheckCircle2 className="size-4" />
          )}
          <AlertTitle>{formState.kind === "error" ? "Password issue" : "Password updated"}</AlertTitle>
          <AlertDescription>{formState.message}</AlertDescription>
        </Alert>
      ) : null}
      <div className="grid gap-2">
        <Label htmlFor="password">New password</Label>
        <Input id="password" name="password" type="password" minLength={8} required />
      </div>
      <div className="grid gap-2">
        <Label htmlFor="confirmPassword">Confirm password</Label>
        <Input id="confirmPassword" name="confirmPassword" type="password" minLength={8} required />
      </div>
      <Button type="submit" disabled={isSubmitting}>
        {isSubmitting ? (
          <>
            <Loader2 className="size-4 animate-spin" />
            Updating password
          </>
        ) : (
          "Update password"
        )}
      </Button>
      <Button asChild type="button" variant="ghost">
        <Link href="/login">Back to login</Link>
      </Button>
    </form>
  );
}
