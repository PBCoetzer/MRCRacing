"use client";

import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { AlertTriangle, Flag, Loader2, MessageCircle, Send, Undo2 } from "lucide-react";
import { SafeMarkdown } from "@/components/blog/safe-markdown";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { createClient } from "@/lib/supabase/client";
import { supabaseUrl } from "@/lib/supabase/config";

type PublicComment = { id: string; body: string; author: string; isMine: boolean; createdAt: string };
type PublicPost = {
  id: string;
  slug: string;
  title: string;
  excerpt: string;
  bodyMarkdown: string;
  coverImagePath: string | null;
  publishedAt: string;
  updatedAt: string;
  author: string;
  comments: PublicComment[];
};

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en-ZA", {
    dateStyle: "long",
    timeStyle: "short",
    timeZone: "Africa/Johannesburg",
  }).format(new Date(value));
}

export function BlogPostClient() {
  const searchParams = useSearchParams();
  const slug = searchParams.get("slug")?.trim() ?? "";
  const [post, setPost] = useState<PublicPost | null>(null);
  const [comment, setComment] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const loadPost = useCallback(async () => {
    const supabase = createClient();
    if (!supabase || !slug) {
      setError("Choose a valid MRC blog article.");
      setLoading(false);
      return;
    }
    const { data, error: loadError } = await supabase.rpc("get_public_blog_post", { p_slug: slug });
    if (loadError) setError(loadError.message);
    else if (!data) setError("This article is not published or no longer available.");
    else setPost(data as PublicPost);
    setLoading(false);
  }, [slug]);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => void loadPost(), 0);
    return () => window.clearTimeout(timeoutId);
  }, [loadPost]);

  async function submitComment() {
    const supabase = createClient();
    if (!supabase || !post) return;
    setBusy("comment"); setError(""); setMessage("");
    const { error: submitError } = await supabase.rpc("create_blog_comment", {
      p_post_id: post.id,
      p_body: comment,
    });
    if (submitError) setError(submitError.message);
    else {
      setComment("");
      setMessage("Your comment is now visible.");
      await loadPost();
    }
    setBusy("");
  }

  async function withdrawComment(commentId: string) {
    const supabase = createClient();
    if (!supabase) return;
    setBusy(commentId); setError("");
    const { error: withdrawError } = await supabase.rpc("withdraw_blog_comment", { p_comment_id: commentId });
    if (withdrawError) setError(withdrawError.message);
    else await loadPost();
    setBusy("");
  }

  async function reportComment(commentId: string) {
    const supabase = createClient();
    if (!supabase) return;
    setBusy(`report:${commentId}`); setError("");
    const { error: reportError } = await supabase.rpc("report_blog_comment", {
      p_comment_id: commentId,
      p_reason: "Submitted for administrator review by an authenticated reader.",
    });
    if (reportError) setError(reportError.message);
    else setMessage("The comment was reported once for administrator review.");
    setBusy("");
  }

  if (loading) return <div className="flex min-h-64 items-center justify-center gap-2"><Loader2 className="size-5 animate-spin" />Loading article…</div>;
  if (!post) return <Alert variant="destructive"><AlertTriangle className="size-4" /><AlertTitle>Article unavailable</AlertTitle><AlertDescription>{error}</AlertDescription></Alert>;

  return (
    <>
      {error ? <Alert variant="destructive"><AlertTitle>Action failed</AlertTitle><AlertDescription>{error}</AlertDescription></Alert> : null}
      {message ? <Alert><AlertTitle>Done</AlertTitle><AlertDescription>{message}</AlertDescription></Alert> : null}
      <Button asChild variant="ghost" className="mb-5"><Link href="/blog/"><Undo2 className="size-4" />Back to the blog</Link></Button>
      <article className="overflow-hidden rounded-2xl border border-brand-gold/25 bg-card/82">
        {post.coverImagePath ? (
          <div className="relative aspect-[21/9] min-h-64">
            <Image src={`${supabaseUrl}/storage/v1/object/public/blog-media/${post.coverImagePath}`} alt="" fill priority sizes="100vw" className="object-cover" />
          </div>
        ) : null}
        <div className="mx-auto max-w-4xl px-5 py-9 sm:px-10 sm:py-12">
          <Badge>{post.author}</Badge>
          <h1 className="mt-4 font-heading text-4xl leading-tight text-white sm:text-5xl">{post.title}</h1>
          <p className="mt-4 text-lg leading-8 text-muted-foreground">{post.excerpt}</p>
          <p className="mt-4 font-mono text-xs text-brand-cyan">Published {formatDate(post.publishedAt)}</p>
          <div className="mt-10 border-t border-border/70 pt-4"><SafeMarkdown value={post.bodyMarkdown} /></div>
        </div>
      </article>

      <section className="mx-auto mt-8 max-w-4xl space-y-5">
        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2"><MessageCircle className="size-5 text-brand-cyan" />Join the conversation</CardTitle><CardDescription>Active client accounts may post plain-text comments. Three comments per ten minutes; maximum two links.</CardDescription></CardHeader>
          <CardContent>
            <Label htmlFor="blog-comment">Comment</Label>
            <Textarea id="blog-comment" value={comment} maxLength={1500} onChange={(event) => setComment(event.target.value)} className="mt-2 min-h-28" placeholder="Share a respectful racing-related comment…" />
            <div className="mt-3 flex items-center justify-between gap-3"><span className="text-xs text-muted-foreground">{comment.length}/1,500</span><Button onClick={submitComment} disabled={busy === "comment" || !comment.trim()}><Send className="size-4" />Post comment</Button></div>
          </CardContent>
        </Card>

        {post.comments.map((item) => (
          <Card key={item.id} size="sm">
            <CardHeader><CardTitle>{item.author}</CardTitle><CardDescription>{formatDate(item.createdAt)}</CardDescription></CardHeader>
            <CardContent><p className="whitespace-pre-wrap leading-7">{item.body}</p><div className="mt-4 flex gap-2">{item.isMine ? <Button variant="outline" size="sm" disabled={busy === item.id} onClick={() => withdrawComment(item.id)}>Withdraw my comment</Button> : <Button variant="ghost" size="sm" disabled={busy === `report:${item.id}`} onClick={() => reportComment(item.id)}><Flag className="size-3" />Report</Button>}</div></CardContent>
          </Card>
        ))}
        {!post.comments.length ? <p className="text-center text-sm text-muted-foreground">No comments yet.</p> : null}
      </section>
    </>
  );
}
