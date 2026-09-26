import { BlogAuthorRedirect } from "@/components/blog/blog-author-redirect";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";

export default function TipsterBlogPage() {
  return (
    <div className="min-h-screen bg-background">
      <SiteHeader />
      <main className="mx-auto min-h-[calc(100svh-8rem)] w-full max-w-3xl px-4 py-12 sm:px-6 lg:px-8">
        <BlogAuthorRedirect />
      </main>
      <SiteFooter />
    </div>
  );
}
