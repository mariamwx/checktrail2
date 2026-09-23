import { type NextRequest, NextResponse } from "next/server";
import { updateSession } from "@/utils/supabase/middleware";

export async function middleware(request: NextRequest) {
  const { pathname, searchParams } = request.nextUrl;
  const room = searchParams.get("room");

  // Old / mistaken invite links hit the hub with ?room=CODE — send them into Icebreaker
  if (pathname === "/" && room) {
    const url = request.nextUrl.clone();
    url.pathname = "/game.html";
    return NextResponse.redirect(url);
  }

  return await updateSession(request);
}

export const config = {
  matcher: [
    /*
     * Match all request paths except static files and images.
     */
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|webm|mp4|html|css|js)$).*)",
  ],
};
