"use client";

import { useEffect, useRef } from "react";

/**
 * Hub brand mark — WB logo animation in place of the “Get Under My Skin” wordmark.
 * Loops while people pick a mode. Background matches hub (#e2e2e2).
 */
export function WbBrandLogo() {
  const videoRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    video.muted = true;
    video.defaultMuted = true;
    video.playsInline = true;
    video.loop = true;
    video.setAttribute("playsinline", "true");
    video.setAttribute("webkit-playsinline", "true");
    video.setAttribute("muted", "true");
    video.setAttribute("loop", "true");
    video.disablePictureInPicture = true;
    video.controls = false;

    const tryPlay = () => {
      const p = video.play();
      if (p && typeof p.catch === "function") p.catch(() => {});
    };

    video.addEventListener("loadeddata", tryPlay);
    video.addEventListener("canplay", tryPlay);

    const onVisible = () => {
      if (document.visibilityState === "visible" && video.paused) tryPlay();
    };
    document.addEventListener("visibilitychange", onVisible);

    const unlock = () => tryPlay();
    document.addEventListener("touchstart", unlock, { passive: true, once: true });
    document.addEventListener("pointerdown", unlock, { passive: true, once: true });

    tryPlay();

    return () => {
      video.removeEventListener("loadeddata", tryPlay);
      video.removeEventListener("canplay", tryPlay);
      document.removeEventListener("visibilitychange", onVisible);
      document.removeEventListener("touchstart", unlock);
      document.removeEventListener("pointerdown", unlock);
    };
  }, []);

  return (
    <div className="hub-brand" aria-label="Get Under My Skin">
      <video
        ref={videoRef}
        className="hub-brand-logo"
        autoPlay
        muted
        loop
        playsInline
        preload="auto"
        disablePictureInPicture
        controls={false}
        aria-hidden="true"
      >
        <source src="/WB_logo_mp4.mp4" type="video/mp4" />
        <source src="/WB_logo_web.webm" type="video/webm" />
      </video>
    </div>
  );
}
