"use client";

import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { CalendarDays, Loader2, MessageCircle, Newspaper } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { createClient } from "@/lib/supabase/client";
import { supabaseUrl } from "@/lib/supabase/config";

type PublicPost = {
  id: string;
  slug: string;
  title: string;
  excerpt: string;
  coverImagePath: string | null;
  publishedAt: string;
  author: string;
  commentCount: number;
};

function coverUrl(path: string) {
  return `${supabaseUrl}/storage/v1/object/public/blog-media/${path}`;
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en-ZA", {
    dateStyle: "long",
    timeZone: "Africa/Johannesburg",
  }).format(new Date(value));
}

export function BlogIndexClient() {
  const [posts, setPosts] = useState<PublicPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const loadPosts = useCallback(async () => {
    const supabase = createClient();
    if (!supabase) {
      setError("The MRC blog is temporarily unavailable.");
      setLoading(false);
      return;
    }
    const { data, error: loadError } = await supabase.rpc("list_public_blog_posts", { p_limit: 48 });
    if (loadError) setError(loadError.message);
    else setPosts((data ?? []) as PublicPost[]);
    setLoading(false);
  }, []);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => void loadPosts(), 0);
    return () => window.clearTimeout(timeoutId);
  }, [loadPosts]);

  if (loading) {
    return <div className="flex min-h-52 items-center justify-center gap-2"><Loader2 className="size-5 animate-spin" />Loading stories…</div>;
  }

  if (error) return <Alert variant="destructive"><AlertTitle>Blog unavailable</AlertTitle><AlertDescription>{error}</AlertDescription></Alert>;

  if (!posts.length) {
    return (
      <Alert>
        <Newspaper className="size-4" />
        <AlertTitle>First post coming soon</AlertTitle>
        <AlertDescription>Approved MRC tipsters will share public race analysis and educational racing articles here.</AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-3">
      {posts.map((post) => (
        <Card key={post.id} className="border-brand-gold/25 bg-card/85">
          {post.coverImagePath ? (
            <div className="relative aspect-[16/9] overflow-hidden">
              <Image src={coverUrl(post.coverImagePath)} alt="" fill sizes="(max-width: 768px) 100vw, 33vw" className="object-cover" />
            </div>
          ) : null}
          <CardHeader>
            <Badge className="w-fit">{post.author}</Badge>
            <CardTitle className="mt-2 text-2xl text-white">{post.title}</CardTitle>
            <CardDescription>{post.excerpt}</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-4 text-xs text-muted-foreground">
              <span className="flex items-center gap-1"><CalendarDays className="size-3" />{formatDate(post.publishedAt)}</span>
              <span className="flex items-center gap-1"><MessageCircle className="size-3" />{post.commentCount}</span>
            </div>
            <Button asChild className="mt-5 bg-brand-gold text-brand-purple-deep hover:bg-brand-gold/90">
              <Link href={`/blog/post/?slug=${encodeURIComponent(post.slug)}`}>Read article</Link>
            </Button>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
