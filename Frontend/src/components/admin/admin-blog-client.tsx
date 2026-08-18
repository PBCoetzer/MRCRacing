"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Eye, EyeOff, Loader2, MessageSquareWarning, Newspaper, RefreshCw, ShieldCheck } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createClient } from "@/lib/supabase/client";

type Tipster = { id: string; user_id: string; display_name: string; is_verified: boolean };
type Permission = { tipster_id: string; can_publish: boolean; reason: string | null; updated_at: string };
type Post = { id: string; tipster_id: string; title: string; status: string; published_at: string | null; moderation_note: string | null; updated_at: string };
type Comment = { id: string; post_id: string; body: string; status: string; moderation_note: string | null; created_at: string };
type Report = { id: string; comment_id: string; reason: string; status: string; created_at: string };

export function AdminBlogClient() {
  const [tipsters, setTipsters] = useState<Tipster[]>([]);
  const [permissions, setPermissions] = useState<Permission[]>([]);
  const [posts, setPosts] = useState<Post[]>([]);
  const [comments, setComments] = useState<Comment[]>([]);
  const [reports, setReports] = useState<Report[]>([]);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const load = useCallback(async () => {
    const supabase = createClient(); if (!supabase) return;
    setLoading(true); setError("");
    const [tipsterResult, permissionResult, postResult, commentResult, reportResult] = await Promise.all([
      supabase.from("tipsters").select("id,user_id,display_name,is_verified").eq("is_verified", true).order("display_name"),
      supabase.from("tipster_blog_permissions").select("tipster_id,can_publish,reason,updated_at"),
      supabase.from("blog_posts").select("id,tipster_id,title,status,published_at,moderation_note,updated_at").order("updated_at", { ascending: false }),
      supabase.from("blog_comments").select("id,post_id,body,status,moderation_note,created_at").order("created_at", { ascending: false }).limit(100),
      supabase.from("blog_comment_reports").select("id,comment_id,reason,status,created_at").order("created_at", { ascending: false }).limit(100),
    ]);
    const firstError = tipsterResult.error ?? permissionResult.error ?? postResult.error ?? commentResult.error ?? reportResult.error;
    if (firstError) setError(firstError.message);
    setTipsters((tipsterResult.data ?? []) as Tipster[]);
    setPermissions((permissionResult.data ?? []) as Permission[]);
    setPosts((postResult.data ?? []) as Post[]);
    setComments((commentResult.data ?? []) as Comment[]);
    setReports((reportResult.data ?? []) as Report[]);
    setLoading(false);
  }, []);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timeoutId);
  }, [load]);
  const permissionByTipster = useMemo(() => new Map(permissions.map((item) => [item.tipster_id, item])), [permissions]);
  const tipsterById = useMemo(() => new Map(tipsters.map((item) => [item.id, item])), [tipsters]);
  const postById = useMemo(() => new Map(posts.map((item) => [item.id, item])), [posts]);
  const openReportsByComment = useMemo(() => {
    const map = new Map<string, Report[]>();
    reports.filter((item) => item.status === "open").forEach((item) => map.set(item.comment_id, [...(map.get(item.comment_id) ?? []), item]));
    return map;
  }, [reports]);

  async function setPermission(tipster: Tipster, enabled: boolean) {
    const supabase = createClient(); if (!supabase) return;
    const reason = notes[`permission:${tipster.id}`]?.trim() || (enabled ? "Approved by administrator for direct blog publishing." : "Blog author permission revoked by administrator.");
    setBusy(`permission:${tipster.id}`); setError(""); setMessage("");
    const { error: actionError } = await supabase.rpc("admin_set_tipster_blog_permission", { p_user_id: tipster.user_id, p_can_publish: enabled, p_reason: reason });
    if (actionError) setError(actionError.message); else { setMessage(`${tipster.display_name} ${enabled ? "may now publish" : "can no longer create or edit"} blog posts.`); await load(); }
    setBusy("");
  }

  async function moderatePost(post: Post, action: "hide" | "restore" | "archive") {
    const supabase = createClient(); if (!supabase) return;
    const note = notes[`post:${post.id}`]?.trim() || `Administrator ${action} action after content review.`;
    setBusy(`post:${post.id}`); setError("");
    const { error: actionError } = await supabase.rpc("admin_moderate_blog_post", { p_post_id: post.id, p_action: action, p_note: note });
    if (actionError) setError(actionError.message); else await load();
    setBusy("");
  }

  async function moderateComment(comment: Comment, action: "hide" | "restore") {
    const supabase = createClient(); if (!supabase) return;
    const note = notes[`comment:${comment.id}`]?.trim() || `Administrator ${action} action after comment review.`;
    setBusy(`comment:${comment.id}`); setError("");
    const { error: actionError } = await supabase.rpc("admin_moderate_blog_comment", { p_comment_id: comment.id, p_action: action, p_note: note });
    if (actionError) setError(actionError.message); else await load();
    setBusy("");
  }

  if (loading) return <Card><CardContent className="flex min-h-52 items-center justify-center gap-2"><Loader2 className="size-5 animate-spin" />Loading blog controls…</CardContent></Card>;

  return <div className="space-y-6">
    {error ? <Alert variant="destructive"><AlertTitle>Blog administration failed</AlertTitle><AlertDescription>{error}</AlertDescription></Alert> : null}
    {message ? <Alert><AlertTitle>Permission updated</AlertTitle><AlertDescription>{message}</AlertDescription></Alert> : null}
    <div className="flex justify-end"><Button variant="outline" onClick={() => load()}><RefreshCw className="size-4" />Refresh</Button></div>

    <Card><CardHeader><CardTitle className="flex items-center gap-2"><ShieldCheck className="size-5 text-brand-cyan" />Approved blog authors</CardTitle><CardDescription>This permission is separate from tipster verification. Revocation blocks new posts and edits without silently hiding published work.</CardDescription></CardHeader><CardContent className="grid gap-4 lg:grid-cols-2">{tipsters.map((tipster) => { const enabled = permissionByTipster.get(tipster.id)?.can_publish === true; return <div key={tipster.id} className="rounded-lg border p-4"><div className="flex items-center justify-between gap-3"><div><p className="font-semibold text-white">{tipster.display_name}</p><Badge variant={enabled ? "default" : "outline"}>{enabled ? "May publish" : "Not approved"}</Badge></div><Button variant={enabled ? "destructive" : "default"} disabled={busy === `permission:${tipster.id}`} onClick={() => setPermission(tipster, !enabled)}>{enabled ? "Revoke" : "Approve"}</Button></div><Label htmlFor={`permission-${tipster.id}`} className="mt-3">Audit reason</Label><Input id={`permission-${tipster.id}`} value={notes[`permission:${tipster.id}`] ?? ""} onChange={(event) => setNotes((current) => ({ ...current, [`permission:${tipster.id}`]: event.target.value }))} placeholder="Optional custom reason" /></div>; })}</CardContent></Card>

    <Card><CardHeader><CardTitle className="flex items-center gap-2"><Newspaper className="size-5 text-brand-cyan" />Post moderation</CardTitle><CardDescription>Hide, restore, or archive without permanent deletion.</CardDescription></CardHeader><CardContent className="space-y-3">{posts.map((post) => <div key={post.id} className="rounded-lg border p-4"><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="font-semibold text-white">{post.title}</p><p className="text-xs text-muted-foreground">{tipsterById.get(post.tipster_id)?.display_name ?? "Tipster"} · {post.status}</p></div><div className="flex gap-2">{post.status === "hidden" ? <Button size="sm" onClick={() => moderatePost(post, "restore")}><Eye className="size-3" />Restore</Button> : <Button size="sm" variant="outline" onClick={() => moderatePost(post, "hide")}><EyeOff className="size-3" />Hide</Button>}<Button size="sm" variant="ghost" onClick={() => moderatePost(post, "archive")}>Archive</Button></div></div><Input className="mt-3" value={notes[`post:${post.id}`] ?? ""} onChange={(event) => setNotes((current) => ({ ...current, [`post:${post.id}`]: event.target.value }))} placeholder="Moderation note" /></div>)}{!posts.length ? <p className="text-sm text-muted-foreground">No blog posts yet.</p> : null}</CardContent></Card>

    <Card><CardHeader><CardTitle className="flex items-center gap-2"><MessageSquareWarning className="size-5 text-brand-cyan" />Comment moderation</CardTitle><CardDescription>Reported comments are highlighted. Authors cannot moderate comments on their own posts.</CardDescription></CardHeader><CardContent className="space-y-3">{comments.map((comment) => { const openReports = openReportsByComment.get(comment.id) ?? []; return <div key={comment.id} className={`rounded-lg border p-4 ${openReports.length ? "border-destructive/60" : ""}`}><div className="flex flex-wrap justify-between gap-3"><div><p className="text-sm leading-6">{comment.body}</p><p className="mt-1 text-xs text-muted-foreground">On “{postById.get(comment.post_id)?.title ?? "Unknown post"}” · {comment.status}{openReports.length ? ` · ${openReports.length} open report(s)` : ""}</p>{openReports.map((report) => <p key={report.id} className="mt-1 text-xs text-destructive">Report: {report.reason}</p>)}</div><div>{comment.status === "hidden" ? <Button size="sm" onClick={() => moderateComment(comment, "restore")}>Restore</Button> : <Button size="sm" variant="outline" onClick={() => moderateComment(comment, "hide")}>Hide</Button>}</div></div><Input className="mt-3" value={notes[`comment:${comment.id}`] ?? ""} onChange={(event) => setNotes((current) => ({ ...current, [`comment:${comment.id}`]: event.target.value }))} placeholder="Moderation note" /></div>; })}{!comments.length ? <p className="text-sm text-muted-foreground">No comments yet.</p> : null}</CardContent></Card>
  </div>;
}
