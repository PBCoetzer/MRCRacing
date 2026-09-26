"use client";

import Link from "next/link";
import { useEffect } from "react";

export function BlogAuthorRedirect() {
  useEffect(() => {
    window.location.replace("/blog/#author-tools");
  }, []);

  return (
    <p>
      Blog author tools have moved to the{" "}
      <Link className="text-brand-cyan underline" href="/blog/#author-tools">
        MRC Blog
      </Link>
      .
    </p>
  );
}
