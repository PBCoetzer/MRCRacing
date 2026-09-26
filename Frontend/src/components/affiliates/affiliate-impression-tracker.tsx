"use client";

import { useEffect, useRef } from "react";

type AffiliateImpressionTrackerProps = {
  partnerName: string;
  src: string;
};

export function AffiliateImpressionTracker({
  partnerName,
  src,
}: AffiliateImpressionTrackerProps) {
  const markerRef = useRef<HTMLSpanElement>(null);
  const trackedRef = useRef(false);

  useEffect(() => {
    const marker = markerRef.current;

    if (!marker) {
      return;
    }

    const trackImpression = () => {
      if (trackedRef.current) {
        return;
      }

      const iframe = document.createElement("iframe");
      iframe.src = src;
      iframe.title = `${partnerName} affiliate impression tracker`;
      iframe.hidden = true;
      iframe.tabIndex = -1;
      iframe.referrerPolicy = "strict-origin-when-cross-origin";
      iframe.setAttribute("aria-hidden", "true");
      marker.appendChild(iframe);
      trackedRef.current = true;
    };

    if (!("IntersectionObserver" in window)) {
      trackImpression();
      return;
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          trackImpression();
          observer.disconnect();
        }
      },
      { threshold: 0.1 },
    );

    observer.observe(marker);

    return () => observer.disconnect();
  }, [partnerName, src]);

  return (
    <span
      ref={markerRef}
      className="pointer-events-none absolute inset-0"
      aria-hidden="true"
    />
  );
}
