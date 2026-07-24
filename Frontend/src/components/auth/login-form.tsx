"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";
import { AlertCircle, CheckCircle2, Loader2 } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabaseConfigMessage } from "@/lib/supabase/config";
import { createClient } from "@/lib/supabase/client";

type FormState = {
  kind: "idle" | "success" | "error";
  message: string;
};

type RoleRow = {
  role: string;
};

function dashboardForRoles(roles: string[]) {
  if (roles.includes("administrator")) {
    return "/admin/";
  }

  if (roles.includes("tipster")) {
    return "/tipster/";
  }

  return "/client/";
}

export function LoginForm() {
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
    const email = String(formData.get("email") ?? "").trim();
    const password = String(formData.get("password") ?? "");

    setIsSubmitting(true);
    setFormState({ kind: "idle", message: "" });

    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (error) {
        throw error;
      }

      const { data: roles, error: roleError } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", data.user.id);

      if (roleError) {
        throw roleError;
      }

      const roleRows = (roles ?? []) as RoleRow[];

      setFormState({
        kind: "success",
        message: "Login successful. Taking you to your dashboard.",
      });

      router.push(dashboardForRoles(roleRows.map((row) => row.role)));
      router.refresh();
    } catch (error) {
      setFormState({
        kind: "error",
        message:
          error instanceof Error
            ? error.message
            : "Login failed. Please check your details and try again.",
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
          <AlertTitle>{formState.kind === "error" ? "Login issue" : "Success"}</AlertTitle>
          <AlertDescription>{formState.message}</AlertDescription>
        </Alert>
      ) : null}
      <div className="grid gap-2">
        <Label htmlFor="email">Email</Label>
        <Input id="email" name="email" type="email" placeholder="you@example.com" required />
      </div>
      <div className="grid gap-2">
        <Label htmlFor="password">Password</Label>
        <Input id="password" name="password" type="password" placeholder="Your password" required />
      </div>
      <Button type="submit" className="w-full" disabled={isSubmitting}>
        {isSubmitting ? (
          <>
            <Loader2 className="size-4 animate-spin" />
            Logging in
          </>
        ) : (
          "Login"
        )}
      </Button>
      <div className="flex items-center justify-between text-sm">
        <Link href="/register" className="text-primary hover:underline">
          Create account
        </Link>
        <Link href="/forgot-password" className="text-muted-foreground hover:text-foreground">
          Forgot password?
        </Link>
      </div>
    </form>
  );
}
