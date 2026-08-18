"use client";

import Link from "next/link";
import { useEffect } from "react";

export function OldBlogPostRedirect() {
  useEffect(() => {
    const value = new URLSearchParams(window.location.search).get("slug")?.trim() ?? "";
    if (value) window.location.replace(`/blog/${encodeURIComponent(value)}/`);
  }, []);
  return <p>This article URL has moved. If it does not open automatically, choose it from the <Link className="text-brand-cyan underline" href="/blog/">MRC blog</Link>.</p>;
}
