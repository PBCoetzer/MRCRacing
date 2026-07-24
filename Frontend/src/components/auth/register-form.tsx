"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";
import { AlertCircle, CheckCircle2, Loader2 } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createClient } from "@/lib/supabase/client";
import { supabaseConfigMessage } from "@/lib/supabase/config";
import { getSiteUrl } from "@/lib/site-url";

type FormState = {
  kind: "idle" | "success" | "error";
  message: string;
};

export function RegisterForm() {
  const router = useRouter();
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
    const displayName = String(formData.get("displayName") ?? "").trim();
    const phone = String(formData.get("phone") ?? "").trim();
    const email = String(formData.get("email") ?? "").trim();
    const password = String(formData.get("password") ?? "");
    const acceptedTerms = formData.get("acceptedTerms") === "on";
    const confirmedOver18 = formData.get("confirmedOver18") === "on";

    if (!acceptedTerms || !confirmedOver18) {
      setFormState({
        kind: "error",
        message: "Please confirm the terms and 18+ responsible-use declaration.",
      });
      return;
    }

    setIsSubmitting(true);
    setFormState({ kind: "idle", message: "" });

    try {
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          emailRedirectTo: `${getSiteUrl()}/login/`,
          data: {
            accepted_terms: acceptedTerms,
            confirmed_over_18: confirmedOver18,
            display_name: displayName,
            phone,
          },
        },
      });

      if (error) {
        throw error;
      }

      if (data.session) {
        setFormState({
          kind: "success",
          message: "Account created. Your client dashboard is ready.",
        });
        router.push("/client/");
        router.refresh();
        return;
      }

      setFormState({
        kind: "success",
        message: "Account created. Please check your email to confirm your login.",
      });
    } catch (error) {
      setFormState({
        kind: "error",
        message:
          error instanceof Error
            ? error.message
            : "Registration failed. Please try again.",
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
          <AlertTitle>{formState.kind === "error" ? "Registration issue" : "Success"}</AlertTitle>
          <AlertDescription>{formState.message}</AlertDescription>
        </Alert>
      ) : null}
      <div className="grid gap-2">
        <Label htmlFor="name">Display name</Label>
        <Input id="name" name="displayName" placeholder="Your name" required />
      </div>
      <div className="grid gap-2">
        <Label htmlFor="phone">Cell number</Label>
        <Input id="phone" name="phone" placeholder="+27" />
      </div>
      <div className="grid gap-2">
        <Label htmlFor="email">Email</Label>
        <Input id="email" name="email" type="email" placeholder="you@example.com" required />
      </div>
      <div className="grid gap-2">
        <Label htmlFor="password">Password</Label>
        <Input
          id="password"
          name="password"
          type="password"
          placeholder="Create a password"
          required
          minLength={8}
        />
      </div>
      <label className="flex items-start gap-3 rounded-lg border border-brand-gold/25 bg-background/60 p-3 text-sm text-muted-foreground">
        <input name="confirmedOver18" type="checkbox" required className="mt-1 accent-primary" />
        I confirm that I am 18 or older and understand that betting decisions remain my responsibility.
      </label>
      <label className="flex items-start gap-3 rounded-lg border border-brand-gold/25 bg-background/60 p-3 text-sm text-muted-foreground">
        <input name="acceptedTerms" type="checkbox" required className="mt-1 accent-primary" />
        I accept the MRC Racing Tips terms, privacy policy, and responsible gambling guidance.
      </label>
      <Button type="submit" className="w-full" disabled={isSubmitting}>
        {isSubmitting ? (
          <>
            <Loader2 className="size-4 animate-spin" />
            Creating account
          </>
        ) : (
          "Create account"
        )}
      </Button>
      <p className="text-sm text-muted-foreground">
        Already registered?{" "}
        <Link href="/login" className="text-primary hover:underline">
          Login
        </Link>
      </p>
    </form>
  );
}
