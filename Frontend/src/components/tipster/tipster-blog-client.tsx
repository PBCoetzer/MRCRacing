"use client";

import Image from "next/image";
import { useCallback, useEffect, useState } from "react";
import { Archive, FileImage, Loader2, Newspaper, Plus, Save, Send, UserRoundCheck, Video } from "lucide-react";
import { BlogVideo } from "@/components/blog/blog-video";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { createClient } from "@/lib/supabase/client";
import { supabaseUrl } from "@/lib/supabase/config";

type BlogPost = {
  id: string;
  title: string;
  excerpt: string;
  body_markdown: string;
  cover_image_path: string | null;
  video_url: string | null;
  slug: string | null;
  status: "draft" | "published" | "hidden" | "archived";
  published_at: string | null;
  updated_at: string;
};

type BlogAuthorAccess = {
  requestId: string | null;
  status: "not_requested" | "requested" | "approved" | "rejected" | "revoked";
  requestReason: string | null;
  reviewNote: string | null;
  requestedAt: string | null;
  reviewedAt: string | null;
  tipsterId: string | null;
  canPublish: boolean;
  displayName: string;
};

const emptyDraft = { title: "", excerpt: "", body: "", coverPath: "", videoUrl: "" };
const supportedCoverTypes = new Set(["image/jpeg", "image/png", "image/webp"]);
const maxSourceCoverBytes = 20 * 1024 * 1024;

async function edgeFunctionErrorMessage(error: unknown, fallback: string) {
  if (error && typeof error === "object" && "context" in error) {
    const context = (error as { context?: unknown }).context;
    if (context instanceof Response) {
      try {
        const payload = await context.clone().json() as { error?: unknown; requestId?: unknown };
        const message = typeof payload.error === "string" ? payload.error : fallback;
        const requestId = typeof payload.requestId === "string" ? ` Reference: ${payload.requestId}.` : "";
        return `${message}${requestId}`;
      } catch {
        // Fall through to the SDK error when the response is not JSON.
      }
    }
  }
  return error instanceof Error ? error.message : fallback;
}

async function toWebp(file: File) {
  if (!supportedCoverTypes.has(file.type)) {
    throw new Error("Choose a JPEG, PNG, or WebP cover image.");
  }
  if (file.size <= 0 || file.size > maxSourceCoverBytes) {
    throw new Error("The original cover image must be no larger than 20 MB.");
  }
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 1600 / bitmap.width);
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const context = canvas.getContext("2d");
  if (!context) throw new Error("This browser cannot prepare the cover image.");
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/webp", 0.86));
  if (!blob) throw new Error("The cover image could not be converted to WebP.");
  if (blob.size > 5 * 1024 * 1024) throw new Error("The optimized cover exceeds 5 MB.");
  return new File([blob], "cover.webp", { type: "image/webp" });
}

export function TipsterBlogClient() {
  const [tipsterId, setTipsterId] = useState("");
  const [canPublish, setCanPublish] = useState(false);
  const [authorAccess, setAuthorAccess] = useState<BlogAuthorAccess | null>(null);
  const [requestReason, setRequestReason] = useState("");
  const [posts, setPosts] = useState<BlogPost[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState(emptyDraft);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const load = useCallback(async () => {
    const supabase = createClient();
    if (!supabase) return;
    setLoading(true); setError("");
    const { data: accessData, error: accessError } = await supabase.rpc(
      "get_my_blog_author_access",
    );
    if (accessError || !accessData) {
      setError(accessError?.message ?? "Could not load the blog author workspace.");
      setLoading(false);
      return;
    }
    const loadedAccess = accessData as BlogAuthorAccess;
    const postResult = loadedAccess.tipsterId
      ? await supabase
          .from("blog_posts")
          .select("id,title,excerpt,body_markdown,cover_image_path,video_url,slug,status,published_at,updated_at")
          .eq("tipster_id", loadedAccess.tipsterId)
          .order("updated_at", { ascending: false })
      : { data: [], error: null };
    if (postResult.error) setError(postResult.error.message);
    setAuthorAccess(loadedAccess);
    setRequestReason(loadedAccess.requestReason ?? "");
    setTipsterId(loadedAccess.tipsterId ?? "");
    setCanPublish(loadedAccess.canPublish === true);
    setPosts((postResult.data ?? []) as BlogPost[]);
    setLoading(false);
  }, []);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timeoutId);
  }, [load]);

  function selectPost(post: BlogPost) {
    setSelectedId(post.id);
    setDraft({ title: post.title, excerpt: post.excerpt, body: post.body_markdown, coverPath: post.cover_image_path ?? "", videoUrl: post.video_url ?? "" });
    setMessage(""); setError("");
  }

  function newPost() { setSelectedId(null); setDraft(emptyDraft); setMessage(""); setError(""); }

  async function requestAuthorAccess() {
    const supabase = createClient();
    if (!supabase) return;
    setBusy("request");
    setError("");
    setMessage("");
    const { error: requestError } = await supabase.rpc("request_blog_author_access", {
      p_reason: requestReason,
    });
    if (requestError) {
      setError(requestError.message);
    } else {
      setMessage("Your blog author request was sent to the administrators for review.");
      await load();
    }
    setBusy("");
  }

  async function saveDraft() {
    const supabase = createClient();
    if (!supabase || !tipsterId) throw new Error("Blog workspace is unavailable.");
    const { data, error: saveError } = await supabase.rpc("save_blog_post", {
      p_post_id: selectedId,
      p_title: draft.title,
      p_excerpt: draft.excerpt,
      p_body_markdown: draft.body,
      p_cover_image_path: draft.coverPath || null,
      p_video_url: draft.videoUrl || null,
    });
    if (saveError) throw saveError;
    const saved = data as BlogPost;
    setSelectedId(saved.id);
    return saved;
  }

  async function handleSave() {
    setBusy("save"); setError(""); setMessage("");
    try { await saveDraft(); setMessage("Draft saved and audit logged."); await load(); }
    catch (saveError) { setError(saveError instanceof Error ? saveError.message : "Draft could not be saved."); }
    setBusy("");
  }

  async function uploadCover(file: File) {
    const supabase = createClient();
    if (!supabase) return;
    setBusy("cover"); setError(""); setMessage("");
    try {
      const saved = selectedId ? { id: selectedId } : await saveDraft();
      const webp = await toWebp(file);
      const form = new FormData();
      form.append("postId", saved.id);
      form.append("file", webp);
      const { data, error: uploadError } = await supabase.functions.invoke("blog-media-upload", { body: form });
      if (uploadError) throw new Error(await edgeFunctionErrorMessage(uploadError, "Cover upload failed."));
      if (!data?.path) throw new Error(data?.error ?? "The cover upload returned no path.");
      setDraft((current) => ({ ...current, coverPath: String(data.path) }));
      const { error: attachError } = await supabase.rpc("save_blog_post", {
        p_post_id: saved.id,
        p_title: draft.title,
        p_excerpt: draft.excerpt,
        p_body_markdown: draft.body,
        p_cover_image_path: data.path,
        p_video_url: draft.videoUrl || null,
      });
      if (attachError) throw attachError;
      setMessage("Cover image optimized, versioned, and attached.");
      await load();
    } catch (uploadError) { setError(uploadError instanceof Error ? uploadError.message : "Cover upload failed."); }
    setBusy("");
  }

  async function publish() {
    const supabase = createClient();
    if (!supabase) return;
    setBusy("publish"); setError(""); setMessage("");
    try {
      const saved = await saveDraft();
      const { error: publishError } = await supabase.rpc("publish_blog_post", { p_post_id: saved.id });
      if (publishError) throw publishError;
      setMessage("Article published directly under your approved author permission.");
      await load();
    } catch (publishError) { setError(publishError instanceof Error ? publishError.message : "Article could not be published."); }
    setBusy("");
  }

  async function archive(postId: string) {
    const supabase = createClient(); if (!supabase) return;
    setBusy(`archive:${postId}`); setError("");
    const { error: archiveError } = await supabase.rpc("archive_blog_post", { p_post_id: postId });
    if (archiveError) setError(archiveError.message); else { newPost(); await load(); }
    setBusy("");
  }

  if (loading) return <Card><CardContent className="flex min-h-52 items-center justify-center gap-2"><Loader2 className="size-5 animate-spin" />Loading author workspace…</CardContent></Card>;

  return (
    <div className="space-y-6">
      {error ? <Alert variant="destructive"><AlertTitle>Blog action failed</AlertTitle><AlertDescription>{error}</AlertDescription></Alert> : null}
      {message ? <Alert><AlertTitle>Blog updated</AlertTitle><AlertDescription>{message}</AlertDescription></Alert> : null}
      {!canPublish ? <Alert><Newspaper className="size-4" /><AlertTitle>Blog author approval required</AlertTitle><AlertDescription>Any registered client may request access. An administrator must verify and approve the request before articles can be created, edited, or published.</AlertDescription></Alert> : null}

      {!canPublish ? (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><UserRoundCheck className="size-5 text-brand-cyan" />Request blog author access</CardTitle>
            <CardDescription>This permission is independent from Tipster access. Approval does not automatically create a public Tipster profile.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={authorAccess?.status === "requested" ? "default" : "outline"} className="capitalize">{(authorAccess?.status ?? "not_requested").replaceAll("_", " ")}</Badge>
              {authorAccess?.requestedAt ? <span className="text-xs text-muted-foreground">Requested {new Date(authorAccess.requestedAt).toLocaleString("en-ZA")}</span> : null}
            </div>
            {authorAccess?.reviewNote ? <Alert><AlertTitle>Administrator review</AlertTitle><AlertDescription>{authorAccess.reviewNote}</AlertDescription></Alert> : null}
            {authorAccess?.status !== "requested" ? (
              <>
                <div><Label htmlFor="blog-author-reason">Why would you like to publish?</Label><Textarea id="blog-author-reason" minLength={10} maxLength={1000} value={requestReason} onChange={(event) => setRequestReason(event.target.value)} placeholder="Describe the racing knowledge or information you plan to share." /></div>
                <Button disabled={busy === "request" || requestReason.trim().length < 10} onClick={() => void requestAuthorAccess()}>{busy === "request" ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}{authorAccess?.status === "rejected" || authorAccess?.status === "revoked" ? "Request review again" : "Send request"}</Button>
              </>
            ) : <p className="text-sm text-muted-foreground">Your request is waiting for administrator review. You can return here to see the decision.</p>}
          </CardContent>
        </Card>
      ) : null}

      <div className="grid gap-6 xl:grid-cols-[320px_1fr]">
        <Card>
          <CardHeader><CardTitle>My articles</CardTitle><CardDescription>Published articles remain visible if permission is later revoked; edits stop immediately.</CardDescription></CardHeader>
          <CardContent className="space-y-3">
            <Button className="w-full" variant="outline" onClick={newPost} disabled={!canPublish}><Plus className="size-4" />New article</Button>
            {posts.map((post) => <button key={post.id} type="button" onClick={() => selectPost(post)} className="w-full rounded-lg border p-3 text-left hover:border-brand-cyan/60"><div className="flex items-center justify-between gap-2"><span className="font-medium text-white">{post.title}</span><Badge variant="outline">{post.status}</Badge></div><p className="mt-1 text-xs text-muted-foreground">Updated {new Date(post.updated_at).toLocaleDateString("en-ZA")}</p></button>)}
            {!posts.length ? <p className="text-sm text-muted-foreground">No articles yet.</p> : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>{selectedId ? "Edit article" : "New article"}</CardTitle><CardDescription>Safe Markdown supports headings, paragraphs, lists, and HTTP/HTTPS links. Add one approved YouTube or Vimeo video using its public link; raw HTML remains blocked.</CardDescription></CardHeader>
          <CardContent className="space-y-5">
            <div><Label htmlFor="post-title">Title</Label><Input id="post-title" maxLength={160} value={draft.title} disabled={!canPublish} onChange={(event) => setDraft((current) => ({ ...current, title: event.target.value }))} /></div>
            <div><Label htmlFor="post-excerpt">Public summary</Label><Textarea id="post-excerpt" maxLength={400} value={draft.excerpt} disabled={!canPublish} onChange={(event) => setDraft((current) => ({ ...current, excerpt: event.target.value }))} /></div>
            <div><Label htmlFor="post-body">Article (Markdown)</Label><Textarea id="post-body" maxLength={30000} className="min-h-80 font-mono" value={draft.body} disabled={!canPublish} onChange={(event) => setDraft((current) => ({ ...current, body: event.target.value }))} /></div>
            <div>
              <Label htmlFor="post-video">Video link (optional)</Label>
              <div className="relative mt-2">
                <Video className="pointer-events-none absolute left-3 top-2.5 size-4 text-muted-foreground" />
                <Input id="post-video" type="url" inputMode="url" maxLength={500} className="pl-9" placeholder="https://www.youtube.com/watch?v=… or https://vimeo.com/…" value={draft.videoUrl} disabled={!canPublish} onChange={(event) => setDraft((current) => ({ ...current, videoUrl: event.target.value }))} />
              </div>
              <p className="mt-2 text-xs text-muted-foreground">Only HTTPS YouTube, YouTube Shorts, and Vimeo links are accepted.</p>
            </div>
            {draft.coverPath ? <div className="relative aspect-[16/9] overflow-hidden rounded-lg border"><Image src={`${supabaseUrl}/storage/v1/object/public/blog-media/${draft.coverPath}`} alt="Current article cover" fill sizes="800px" className="object-cover" /></div> : null}
            {draft.videoUrl ? <BlogVideo title={draft.title || "Article preview"} url={draft.videoUrl} /> : null}
            <div className="flex flex-wrap gap-3">
              <Button variant="outline" disabled={!canPublish || busy === "cover"}>
                <label className="flex cursor-pointer items-center gap-2">
                  <FileImage className="size-4" />
                  {busy === "cover" ? "Preparing…" : "Choose cover"}
                  <input
                    type="file"
                    accept="image/*"
                    className="sr-only"
                    onChange={(event) => {
                      const file = event.currentTarget.files?.[0];
                      event.currentTarget.value = "";
                      if (file) void uploadCover(file);
                    }}
                  />
                </label>
              </Button>
              <Button variant="outline" disabled={!canPublish || Boolean(busy)} onClick={handleSave}><Save className="size-4" />Save draft</Button>
              <Button disabled={!canPublish || Boolean(busy)} onClick={publish}><Send className="size-4" />Publish</Button>
              {selectedId ? <Button variant="ghost" disabled={Boolean(busy)} onClick={() => archive(selectedId)}><Archive className="size-4" />Archive</Button> : null}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
