import type { Metadata } from "next";
import { OldBlogPostRedirect } from "@/components/blog/old-blog-post-redirect";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { privatePageMetadata } from "@/lib/metadata";

export const metadata: Metadata = privatePageMetadata;

export default function BlogPostPage() {
  return (
    <div className="min-h-screen bg-background">
      <SiteHeader />
      <main className="mx-auto w-full max-w-7xl px-4 py-10 sm:px-6 lg:px-8">
        <OldBlogPostRedirect />
      </main>
      <SiteFooter />
    </div>
  );
}
