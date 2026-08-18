import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Undo2 } from "lucide-react";
import { BlogCommentsClient } from "@/components/blog/blog-comments-client";
import { SafeMarkdown } from "@/components/blog/safe-markdown";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { JsonLd } from "@/lib/json-ld";
import { canonicalSiteUrl, publicMetadata } from "@/lib/metadata";
import { getPublicBlogArticle, getPublicManifest, publicStorageUrl } from "@/lib/public-content";

type PageProps = { params: Promise<{ slug: string }> };

export async function generateStaticParams() {
  const manifest = await getPublicManifest();
  return manifest.blogPosts.map(({ slug }) => ({ slug }));
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const post = await getPublicBlogArticle(slug);
  if (!post) return { robots: { index: false, follow: false } };
  return publicMetadata({
    title: post.title,
    description: post.excerpt,
    path: `/blog/${post.slug}`,
    image: publicStorageUrl("blog-media", post.coverImagePath) ?? undefined,
  });
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en-ZA", { dateStyle: "long", timeZone: "Africa/Johannesburg" }).format(new Date(value));
}

export default async function BlogArticlePage({ params }: PageProps) {
  const { slug } = await params;
  const post = await getPublicBlogArticle(slug);
  if (!post) notFound();
  const cover = publicStorageUrl("blog-media", post.coverImagePath);
  const url = `${canonicalSiteUrl}/blog/${post.slug}/`;
  return (
    <div className="min-h-screen bg-background">
      <SiteHeader />
      <JsonLd data={[
        { "@context": "https://schema.org", "@type": "BlogPosting", headline: post.title, description: post.excerpt, datePublished: post.publishedAt, dateModified: post.updatedAt, mainEntityOfPage: url, image: cover ?? `${canonicalSiteUrl}/images/mrc-racing-og.png`, author: { "@type": "Person", name: post.author, url: `${canonicalSiteUrl}/tipsters/${post.authorSlug}/` }, publisher: { "@type": "Organization", name: "MRC Racing Tips", url: canonicalSiteUrl } },
        { "@context": "https://schema.org", "@type": "BreadcrumbList", itemListElement: [{ "@type": "ListItem", position: 1, name: "Blog", item: `${canonicalSiteUrl}/blog/` }, { "@type": "ListItem", position: 2, name: post.title, item: url }] },
      ]} />
      <main className="mx-auto w-full max-w-7xl px-4 py-10 sm:px-6 lg:px-8">
        <Button asChild variant="ghost" className="mb-5"><Link href="/blog/"><Undo2 className="size-4" />Back to the blog</Link></Button>
        <article className="overflow-hidden rounded-2xl border border-brand-gold/25 bg-card/82">
          {cover ? <div className="relative aspect-[21/9] min-h-64"><Image src={cover} alt={`Cover image for ${post.title}`} fill priority sizes="100vw" className="object-cover" /></div> : null}
          <div className="mx-auto max-w-4xl px-5 py-9 sm:px-10 sm:py-12">
            <Badge><Link href={`/tipsters/${post.authorSlug}/`}>{post.author}</Link></Badge>
            <h1 className="mt-4 font-heading text-4xl leading-tight text-white sm:text-5xl">{post.title}</h1>
            <p className="mt-4 text-lg leading-8 text-muted-foreground">{post.excerpt}</p>
            <p className="mt-4 font-mono text-xs text-brand-cyan">Published {formatDate(post.publishedAt)}{post.updatedAt !== post.publishedAt ? ` · Updated ${formatDate(post.updatedAt)}` : ""}</p>
            <div className="mt-10 border-t border-border/70 pt-4"><SafeMarkdown value={post.bodyMarkdown} /></div>
          </div>
        </article>
        <BlogCommentsClient slug={post.slug} postId={post.id} />
      </main>
      <SiteFooter />
    </div>
  );
}
