import Link from "next/link";
import { WbBrandLogo } from "./wb-brand-logo";

/**
 * Game mode picker — editorial / indie illustration board.
 * Visuals: /public/ui/shared/iso-theme.css + /public/ui/hub/hub.css
 * Brand: WB logo animation (replaces the wordmark).
 */
export default function Page() {
  return (
    <>
      <link
        href="https://fonts.googleapis.com/css2?family=DM+Sans:ital,opsz,wght@0,9..40,400;0,9..40,500;0,9..40,600;0,9..40,700;1,9..40,400&family=Syne:wght@500;600;700;800&display=swap"
        rel="stylesheet"
      />
      <link href="/ui/shared/iso-theme.css" rel="stylesheet" />
      <link href="/ui/hub/hub.css" rel="stylesheet" />

      <main className="iso-world hub">
        <div className="iso-grid" aria-hidden="true" />

        <div className="guys" aria-hidden="true">
          <div className="guy guy--pill guy--green guy-p1">
            <span className="guy-acc">
              <i className="guy-slash" />
              <i className="guy-dot" />
            </span>
          </div>
          <div className="guy guy--tall guy--red guy-p2">
            <span className="guy-acc">
              <i className="guy-bar" />
            </span>
          </div>
          <div className="guy guy--l guy--teal guy-p3" />
          <div className="guy guy--circle guy--blue guy-p4">
            <span className="guy-acc">
              <i className="guy-ring" />
            </span>
          </div>
          <div className="guy guy--blob guy--violet guy-p5">
            <span className="guy-acc">
              <i className="guy-tick" />
            </span>
          </div>
          <div className="guy guy--tri guy--teal guy-p6">
            <span className="guy-body" />
            <span className="guy-acc">
              <i className="guy-slash" />
            </span>
          </div>
          <div className="guy guy--square guy--red guy-p7 guy-hide-sm" />
          <div className="guy guy--capsule guy--blue guy-p8">
            <span className="guy-acc">
              <i className="guy-dot" />
            </span>
          </div>
          <div className="guy guy--diamond guy--green guy-p9 guy-hide-sm" />
          <div className="guy guy--pill guy--teal guy-p10">
            <span className="guy-acc">
              <i className="guy-bar" />
              <i className="guy-slash" />
            </span>
          </div>
          <div className="guy guy--circle guy--green guy-p11" />
          <div className="guy guy--blob guy--red guy-p12 guy-hide-sm">
            <span className="guy-acc">
              <i className="guy-ring" />
            </span>
          </div>
        </div>

        <div className="iso-stage hub-stage">
          <div className="iso-frame hub-frame">
            <p className="iso-badge">Party games</p>
            <WbBrandLogo />
            <h1 className="iso-title">Pick a game mode</h1>
            <p className="iso-sub">
              Hosts choose the game first, then create a room. Friends who get
              your invite link join that room directly.
            </p>

            <div className="hub-grid">
              <Link href="/game.html?host=1" className="hub-card hub-card--c1">
                <span className="hub-card-dot hub-card-dot--red" aria-hidden="true" />
                <span className="hub-card-eyebrow">Game mode 1</span>
                <span className="hub-card-name">Icebreaker</span>
                <span className="hub-card-desc">
                  Secret questions, spinning wheel, rapid-fire finale
                </span>
              </Link>

              <Link href="/category2.html?host=1" className="hub-card hub-card--c2">
                <span className="hub-card-dot hub-card-dot--blue" aria-hidden="true" />
                <span className="hub-card-eyebrow">Game mode 2</span>
                <span className="hub-card-name">Mirror Vote</span>
                <span className="hub-card-desc">
                  Dirty or Philosophical decks — anonymous “most likely” votes
                </span>
              </Link>

              <Link href="/category3.html?host=1" className="hub-card hub-card--c3">
                <span className="hub-card-dot hub-card-dot--green" aria-hidden="true" />
                <span className="hub-card-eyebrow">Game mode 3</span>
                <span className="hub-card-name">Feud</span>
                <span className="hub-card-desc">
                  Classic or Funny survey decks — match the room’s majority
                </span>
              </Link>
            </div>
          </div>
        </div>
      </main>
    </>
  );
}
