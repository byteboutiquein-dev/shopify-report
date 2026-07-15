import { NextResponse, type NextRequest } from "next/server";

import { AUTH_COOKIE_NAME, isValidSessionToken } from "@/lib/auth/config";

function isPublicPath(pathname: string) {
  return (
    pathname === "/login" ||
    pathname === "/favicon.ico" ||
    pathname.startsWith("/_next/") ||
    pathname.startsWith("/api/cron/")
  );
}

export function middleware(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const isAuthenticated = isValidSessionToken(request.cookies.get(AUTH_COOKIE_NAME)?.value);

  if (pathname === "/login" && isAuthenticated) {
    return NextResponse.redirect(new URL("/", request.url));
  }

  if (!isPublicPath(pathname) && !isAuthenticated) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("next", `${pathname}${search}`);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"]
};
