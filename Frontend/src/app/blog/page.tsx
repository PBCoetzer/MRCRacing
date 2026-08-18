import { BlogIndexClient } from "@/components/blog/blog-index-client";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";

export default function BlogPage() {
  return (
    <div className="min-h-screen bg-background">
      <SiteHeader />
      <main className="mx-auto w-full max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
        <p className="font-mono text-xs uppercase tracking-[0.22em] text-brand-cyan">MRC Journal</p>
        <h1 className="mt-3 font-heading text-4xl text-white sm:text-5xl">Racing insight from verified tipsters</h1>
        <p className="mt-4 max-w-3xl text-lg leading-8 text-muted-foreground">Public race analysis, education, form notes, and stories from MRC authors who have separate administrator approval to publish.</p>
        <div className="mt-10"><BlogIndexClient /></div>
      </main>
      <SiteFooter />
    </div>
  );
}
