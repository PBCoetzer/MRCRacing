"use client";

import { useCallback, useEffect, useState } from "react";
import { Flag, Loader2, MessageCircle, Send } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { createClient } from "@/lib/supabase/client";

type PublicComment = { id: string; body: string; author: string; isMine: boolean; createdAt: string };

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en-ZA", { dateStyle: "long", timeStyle: "short", timeZone: "Africa/Johannesburg" }).format(new Date(value));
}

export function BlogCommentsClient({ slug, postId }: { slug: string; postId: string }) {
  const [comments, setComments] = useState<PublicComment[]>([]);
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const loadComments = useCallback(async () => {
    const supabase = createClient();
    if (!supabase) return;
    const { data, error: loadError } = await supabase.rpc("get_public_blog_post", { p_slug: slug });
    if (loadError) setError(loadError.message);
    else setComments(((data as { comments?: PublicComment[] } | null)?.comments ?? []));
    setLoading(false);
  }, [slug]);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => void loadComments(), 0);
    return () => window.clearTimeout(timeoutId);
  }, [loadComments]);

  async function submitComment() {
    const supabase = createClient();
    if (!supabase) return;
    setBusy("comment"); setError(""); setMessage("");
    const { error: submitError } = await supabase.rpc("create_blog_comment", { p_post_id: postId, p_body: comment });
    if (submitError) setError(submitError.message);
    else { setComment(""); setMessage("Your comment is now visible."); await loadComments(); }
    setBusy("");
  }

  async function withdrawComment(commentId: string) {
    const supabase = createClient();
    if (!supabase) return;
    setBusy(commentId); setError("");
    const { error: actionError } = await supabase.rpc("withdraw_blog_comment", { p_comment_id: commentId });
    if (actionError) setError(actionError.message); else await loadComments();
    setBusy("");
  }

  async function reportComment(commentId: string) {
    const supabase = createClient();
    if (!supabase) return;
    setBusy(`report:${commentId}`); setError("");
    const { error: actionError } = await supabase.rpc("report_blog_comment", {
      p_comment_id: commentId,
      p_reason: "Submitted for administrator review by an authenticated reader.",
    });
    if (actionError) setError(actionError.message); else setMessage("The comment was reported once for administrator review.");
    setBusy("");
  }

  return (
    <section className="mx-auto mt-8 max-w-4xl space-y-5" aria-labelledby="comments-heading">
      {error ? <Alert variant="destructive"><AlertTitle>Comment action failed</AlertTitle><AlertDescription>{error}</AlertDescription></Alert> : null}
      {message ? <Alert><AlertTitle>Done</AlertTitle><AlertDescription>{message}</AlertDescription></Alert> : null}
      <Card>
        <CardHeader><CardTitle id="comments-heading" className="flex items-center gap-2"><MessageCircle className="size-5 text-brand-cyan" />Join the conversation</CardTitle><CardDescription>Active client accounts may post plain-text comments. Three comments per ten minutes; maximum two links.</CardDescription></CardHeader>
        <CardContent>
          <Label htmlFor="blog-comment">Comment</Label>
          <Textarea id="blog-comment" value={comment} maxLength={1500} onChange={(event) => setComment(event.target.value)} className="mt-2 min-h-28" placeholder="Share a respectful racing-related comment…" />
          <div className="mt-3 flex items-center justify-between gap-3"><span className="text-xs text-muted-foreground">{comment.length}/1,500</span><Button onClick={submitComment} disabled={busy === "comment" || !comment.trim()}><Send className="size-4" />Post comment</Button></div>
        </CardContent>
      </Card>
      {loading ? <p className="flex justify-center gap-2 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" />Loading comments…</p> : null}
      {comments.map((item) => (
        <Card key={item.id} size="sm">
          <CardHeader><CardTitle>{item.author}</CardTitle><CardDescription>{formatDate(item.createdAt)}</CardDescription></CardHeader>
          <CardContent><p className="whitespace-pre-wrap leading-7">{item.body}</p><div className="mt-4 flex gap-2">{item.isMine ? <Button variant="outline" size="sm" disabled={busy === item.id} onClick={() => withdrawComment(item.id)}>Withdraw my comment</Button> : <Button variant="ghost" size="sm" disabled={busy === `report:${item.id}`} onClick={() => reportComment(item.id)}><Flag className="size-3" />Report</Button>}</div></CardContent>
        </Card>
      ))}
      {!loading && !comments.length ? <p className="text-center text-sm text-muted-foreground">No comments yet.</p> : null}
    </section>
  );
}
