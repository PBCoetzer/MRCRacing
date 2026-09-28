import type { Metadata } from "next";
import { BlogIndexClient } from "@/components/blog/blog-index-client";
import { TipsterBlogClient } from "@/components/tipster/tipster-blog-client";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { publicMetadata } from "@/lib/metadata";

export const metadata: Metadata = publicMetadata({ title: "South African Horse Racing Blog", description: "Race analysis, form notes, educational articles, and stories published by approved MRC authors.", path: "/blog" });

export default function BlogPage() {
  return (
    <div className="min-h-screen bg-background">
      <SiteHeader />
      <main className="site-container py-12">
        <p className="font-mono text-xs uppercase tracking-[0.22em] text-brand-cyan">MRC Journal</p>
        <h1 className="mt-3 font-heading text-4xl text-white sm:text-5xl">Racing insight from approved authors</h1>
        <p className="mt-4 max-w-3xl text-lg leading-8 text-muted-foreground">Public race analysis, education, form notes, and stories from MRC authors who have separate administrator approval to publish.</p>
        <div className="mt-10"><TipsterBlogClient /></div>
        <section className="mt-12" aria-labelledby="published-blog-posts">
          <h2 id="published-blog-posts" className="font-heading text-3xl text-white">Published articles</h2>
          <div className="mt-6"><BlogIndexClient /></div>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
