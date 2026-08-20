export type BlogVideoProvider = "youtube" | "vimeo";

export type BlogVideo = {
  provider: BlogVideoProvider;
  embedUrl: string;
};

const youtubeIdPattern = /^[A-Za-z0-9_-]{6,20}$/;
const vimeoIdPattern = /^\d{6,12}$/;

export function parseBlogVideoUrl(value: string | null | undefined): BlogVideo | null {
  const trimmed = value?.trim();
  if (!trimmed || trimmed.length > 500) return null;

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }

  if (url.protocol !== "https:") return null;
  const hostname = url.hostname.toLowerCase().replace(/^www\./, "");

  if (hostname === "youtu.be") {
    const videoId = url.pathname.split("/").filter(Boolean)[0];
    return videoId && youtubeIdPattern.test(videoId)
      ? { provider: "youtube", embedUrl: `https://www.youtube-nocookie.com/embed/${videoId}` }
      : null;
  }

  if (hostname === "youtube.com" || hostname === "m.youtube.com" || hostname === "youtube-nocookie.com") {
    const parts = url.pathname.split("/").filter(Boolean);
    const videoId = url.pathname === "/watch"
      ? url.searchParams.get("v")
      : (["embed", "shorts", "live"].includes(parts[0] ?? "") ? parts[1] : null);
    return videoId && youtubeIdPattern.test(videoId)
      ? { provider: "youtube", embedUrl: `https://www.youtube-nocookie.com/embed/${videoId}` }
      : null;
  }

  if (hostname === "vimeo.com" || hostname === "player.vimeo.com") {
    const videoId = url.pathname.split("/").filter(Boolean).reverse().find((part) => vimeoIdPattern.test(part));
    return videoId
      ? { provider: "vimeo", embedUrl: `https://player.vimeo.com/video/${videoId}` }
      : null;
  }

  return null;
}
