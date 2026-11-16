import { NextResponse, type NextRequest } from "next/server";

/**
 * Checagem OTIMISTA: só redireciona quem não tem cookie de sessão.
 * A verificação real (sessão válida + membership + RBAC) acontece no servidor,
 * em `requireOrgContext` (layouts/páginas) e em `createAction` (mutações).
 */
const PUBLIC_PATHS = ["/", "/login", "/registro", "/recuperar-senha", "/precos"];
const PUBLIC_PREFIXES = ["/convite/", "/redefinir-senha/"];
const SESSION_COOKIES = ["authjs.session-token", "__Secure-authjs.session-token"];

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (PUBLIC_PATHS.includes(pathname) || PUBLIC_PREFIXES.some((p) => pathname.startsWith(p))) {
    return NextResponse.next();
  }

  const hasSession = SESSION_COOKIES.some((name) => request.cookies.has(name));
  if (!hasSession) {
    const url = new URL("/login", request.url);
    url.searchParams.set("callbackUrl", pathname);
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  // Ignora APIs (auth/webhooks têm a própria autenticação), assets e arquivos estáticos.
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico|.*\\..*).*)"],
};
