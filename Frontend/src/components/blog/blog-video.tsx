import { parseBlogVideoUrl } from "@/lib/blog-video";

type BlogVideoProps = {
  title: string;
  url: string | null | undefined;
  className?: string;
};

export function BlogVideo({ title, url, className = "" }: BlogVideoProps) {
  const video = parseBlogVideoUrl(url);
  if (!video) return null;

  return (
    <div className={`overflow-hidden rounded-xl border border-brand-cyan/25 bg-black ${className}`}>
      <div className="aspect-video">
        <iframe
          src={video.embedUrl}
          title={`Video: ${title}`}
          className="size-full"
          loading="lazy"
          referrerPolicy="strict-origin-when-cross-origin"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
          allowFullScreen
        />
      </div>
    </div>
  );
}
