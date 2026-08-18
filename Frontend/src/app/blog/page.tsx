import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { CalendarDays, MessageCircle, Newspaper } from "lucide-react";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { publicMetadata } from "@/lib/metadata";
import { publicRpc, publicStorageUrl } from "@/lib/public-content";

export const metadata: Metadata = publicMetadata({ title: "South African Horse Racing Blog", description: "Race analysis, form notes, educational articles, and stories published by approved MRC tipsters.", path: "/blog" });

type PublicPost = { id: string; slug: string; title: string; excerpt: string; coverImagePath: string | null; publishedAt: string; author: string; commentCount: number };

function formatDate(value: string) { return new Intl.DateTimeFormat("en-ZA", { dateStyle: "long", timeZone: "Africa/Johannesburg" }).format(new Date(value)); }

export default async function BlogPage() {
  const posts = await publicRpc<PublicPost[]>("list_public_blog_posts", { p_limit: 48 });
  return (
    <div className="min-h-screen bg-background">
      <SiteHeader />
      <main className="mx-auto w-full max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
        <p className="font-mono text-xs uppercase tracking-[0.22em] text-brand-cyan">MRC Journal</p>
        <h1 className="mt-3 font-heading text-4xl text-white sm:text-5xl">Racing insight from verified tipsters</h1>
        <p className="mt-4 max-w-3xl text-lg leading-8 text-muted-foreground">Public race analysis, education, form notes, and stories from MRC authors who have separate administrator approval to publish.</p>
        <div className="mt-10">
          {!posts.length ? <Alert><Newspaper className="size-4" /><AlertTitle>First post coming soon</AlertTitle><AlertDescription>Approved MRC tipsters will share public race analysis and educational racing articles here.</AlertDescription></Alert> : (
            <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-3">{posts.map((post) => {
              const cover = publicStorageUrl("blog-media", post.coverImagePath);
              return <Card key={post.id} className="border-brand-gold/25 bg-card/85">
                {cover ? <div className="relative aspect-[16/9] overflow-hidden"><Image src={cover} alt={`Cover image for ${post.title}`} fill sizes="(max-width: 768px) 100vw, 33vw" className="object-cover" /></div> : null}
                <CardHeader><Badge className="w-fit">{post.author}</Badge><CardTitle className="mt-2 text-2xl text-white">{post.title}</CardTitle><CardDescription>{post.excerpt}</CardDescription></CardHeader>
                <CardContent><div className="flex flex-wrap gap-4 text-xs text-muted-foreground"><span className="flex items-center gap-1"><CalendarDays className="size-3" />{formatDate(post.publishedAt)}</span><span className="flex items-center gap-1"><MessageCircle className="size-3" />{post.commentCount}</span></div><Button asChild className="mt-5 bg-brand-gold text-brand-purple-deep hover:bg-brand-gold/90"><Link href={`/blog/${post.slug}/`}>Read article</Link></Button></CardContent>
              </Card>;
            })}</div>
          )}
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
