import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { BlogPostClient } from "@/components/blog/blog-post-client";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
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
        { "@context": "https://schema.org", "@type": "BlogPosting", headline: post.title, description: post.excerpt, datePublished: post.publishedAt, dateModified: post.updatedAt, mainEntityOfPage: url, image: cover ?? `${canonicalSiteUrl}/images/mrc-racing-og.png`, author: { "@type": "Person", name: post.author, ...(post.authorSlug ? { url: `${canonicalSiteUrl}/tipsters/${post.authorSlug}/` } : {}) }, publisher: { "@type": "Organization", name: "MRC Racing Tips", url: canonicalSiteUrl } },
        { "@context": "https://schema.org", "@type": "BreadcrumbList", itemListElement: [{ "@type": "ListItem", position: 1, name: "Blog", item: `${canonicalSiteUrl}/blog/` }, { "@type": "ListItem", position: 2, name: post.title, item: url }] },
      ]} />
      <main className="marketing-container py-10">
        <BlogPostClient initialPost={post} slug={slug} />
      </main>
      <SiteFooter />
    </div>
  );
}
