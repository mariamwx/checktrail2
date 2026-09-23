"use client";

import { useCallback, useEffect, useRef, useState } from "react";

const SEEN_KEY = "wb-splash-seen";

type Props = {
  children: React.ReactNode;
};

/**
 * Plays the WB logo once before the mode picker.
 * No skip — advances only when the clip ends.
 * Skips on later visits in the same tab session (back from a game, etc.).
 */
export function WbSplash({ children }: Props) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [phase, setPhase] = useState<"check" | "splash" | "hub">("check");
  const [leaving, setLeaving] = useState(false);

  const finish = useCallback(() => {
    try {
      sessionStorage.setItem(SEEN_KEY, "1");
    } catch (_) {}
    setLeaving(true);
    window.setTimeout(() => setPhase("hub"), 480);
  }, []);

  useEffect(() => {
    try {
      if (sessionStorage.getItem(SEEN_KEY) === "1") {
        setPhase("hub");
        return;
      }
    } catch (_) {}
    setPhase("splash");
  }, []);

  useEffect(() => {
    if (phase !== "splash") return;
    const video = videoRef.current;
    if (!video) return;

    let settled = false;
    const done = () => {
      if (settled) return;
      settled = true;
      finish();
    };

    // iOS / Android autoplay requirements
    video.muted = true;
    video.defaultMuted = true;
    video.playsInline = true;
    video.setAttribute("playsinline", "true");
    video.setAttribute("webkit-playsinline", "true");
    video.setAttribute("muted", "true");
    video.disablePictureInPicture = true;
    video.controls = false;

    const tryPlay = () => {
      if (settled) return;
      const p = video.play();
      if (p && typeof p.catch === "function") {
        p.catch(() => {
          /* keep waiting — ended / retry handlers will finish */
        });
      }
    };

    const onEnded = () => done();
    const onError = () => {
      // Hard media failure only — don’t bail on a transient play() reject
      if (video.error) done();
    };
    const onReady = () => tryPlay();

    video.addEventListener("ended", onEnded);
    video.addEventListener("error", onError);
    video.addEventListener("loadeddata", onReady);
    video.addEventListener("canplay", onReady);
    video.addEventListener("canplaythrough", onReady);

    const onVisible = () => {
      if (document.visibilityState === "visible") tryPlay();
    };
    document.addEventListener("visibilitychange", onVisible);

    // First gesture unlocks autoplay on stubborn mobile browsers
    const unlock = () => tryPlay();
    document.addEventListener("touchstart", unlock, { passive: true });
    document.addEventListener("pointerdown", unlock, { passive: true });

    tryPlay();
    if (video.readyState >= 2) tryPlay();

    // Absolute ceiling if the file never fires ended
    const maxWait = window.setTimeout(done, 20000);

    return () => {
      video.removeEventListener("ended", onEnded);
      video.removeEventListener("error", onError);
      video.removeEventListener("loadeddata", onReady);
      video.removeEventListener("canplay", onReady);
      video.removeEventListener("canplaythrough", onReady);
      document.removeEventListener("visibilitychange", onVisible);
      document.removeEventListener("touchstart", unlock);
      document.removeEventListener("pointerdown", unlock);
      window.clearTimeout(maxWait);
    };
  }, [phase, finish]);

  return (
    <>
      {phase === "check" || phase === "splash" ? (
        <div
          className={`wb-splash${leaving ? " is-leaving" : ""}`}
          role="dialog"
          aria-label="Intro"
          aria-busy={phase === "splash" && !leaving}
        >
          {phase === "splash" ? (
            <video
              ref={videoRef}
              className="wb-splash-video"
              autoPlay
              muted
              playsInline
              preload="auto"
              disablePictureInPicture
              controls={false}
              aria-hidden="true"
            >
              {/* mp4 first — most reliable on iOS Safari */}
              <source src="/WB_logo_mp4.mp4" type="video/mp4" />
              <source src="/WB_logo_web.webm" type="video/webm" />
            </video>
          ) : null}
        </div>
      ) : null}
      <div className={phase === "hub" ? "hub-boot-ready" : "hub-boot-pending"}>
        {children}
      </div>
    </>
  );
}
