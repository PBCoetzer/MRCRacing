import { Suspense } from "react";
import { BlogPostClient } from "@/components/blog/blog-post-client";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";

export default function BlogPostPage() {
  return (
    <div className="min-h-screen bg-background">
      <SiteHeader />
      <main className="mx-auto w-full max-w-7xl px-4 py-10 sm:px-6 lg:px-8">
        <Suspense fallback={<p>Loading article…</p>}><BlogPostClient /></Suspense>
      </main>
      <SiteFooter />
    </div>
  );
}
