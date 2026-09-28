"use client";

import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Newspaper } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  publicStorageUrl,
  type PublicPinnedBlogPost,
} from "@/lib/public-content";
import { createClient } from "@/lib/supabase/client";

function formatPublishedDate(value: string) {
  return new Intl.DateTimeFormat("en-ZA", {
    dateStyle: "long",
    timeZone: "Africa/Johannesburg",
  }).format(new Date(value));
}

export function HomePinnedBlogPost() {
  const [post, setPost] = useState<PublicPinnedBlogPost | null>(null);

  const load = useCallback(async () => {
    const supabase = createClient();
    if (!supabase) return;

    const { data, error } = await supabase.rpc("get_pinned_blog_post");
    if (!error) setPost((data ?? null) as PublicPinnedBlogPost | null);
  }, []);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timeoutId);
  }, [load]);

  if (!post) return null;

  const cover = publicStorageUrl("blog-media", post.coverImagePath);

  return (
    <section className="marketing-container pb-10">
      <article className="grid overflow-hidden rounded-xl border border-brand-cyan/35 bg-[linear-gradient(120deg,rgba(0,212,231,0.12),rgba(54,24,89,0.96)_42%,rgba(30,12,56,0.98))] shadow-[0_20px_60px_rgba(0,0,0,0.2)] md:grid-cols-[minmax(22rem,0.48fr)_minmax(0,1fr)] xl:grid-cols-[20rem_minmax(0,1fr)]">
        {cover ? (
          <div className="relative aspect-[2/3] border-b border-brand-cyan/25 bg-brand-purple-deep/65 md:border-r md:border-b-0 xl:h-[30rem] xl:aspect-auto">
            <Image
              src={cover}
              alt=""
              fill
              sizes="(max-width: 768px) 100vw, (max-width: 1280px) 38vw, 320px"
              className="object-contain"
            />
          </div>
        ) : null}
        <div className={`flex flex-col justify-center p-6 sm:p-8 ${cover ? "" : "md:col-span-2"}`}>
          <Badge className="w-fit border border-brand-cyan/35 bg-brand-cyan/12 text-brand-cyan">
            <Newspaper className="size-3" />
            Pinned from the MRC Journal
          </Badge>
          <h2 className="mt-4 font-heading text-3xl leading-tight text-white sm:text-4xl">
            {post.title}
          </h2>
          <p className="mt-3 max-w-3xl leading-7 text-muted-foreground">{post.excerpt}</p>
          <p className="mt-4 font-mono text-xs text-brand-cyan">
            {post.author} · {formatPublishedDate(post.publishedAt)}
          </p>
          <div className="mt-5 flex flex-wrap gap-3">
            <Button asChild className="bg-brand-gold text-brand-purple-deep hover:bg-brand-gold/90">
              <Link href={`/blog/${post.slug}/`}>Read pinned article</Link>
            </Button>
            <Button asChild variant="outline">
              <Link href="/blog/">View all articles</Link>
            </Button>
          </div>
        </div>
      </article>
    </section>
  );
}
