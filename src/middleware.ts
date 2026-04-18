import { NextResponse, type NextRequest } from "next/server";
import { supabaseMiddleware } from "@/lib/db/supabase-middleware";

/**
 * Next.js Middleware（Edge Runtime）
 *
 * - 未ログイン + 保護パス → /login へリダイレクト
 * - ログイン済み + /login  → /chat へリダイレクト
 *
 * Edge Runtime 制約:
 *   - jsonwebtoken / bcrypt 等の Node.js 専用ライブラリは使用禁止
 *   - @supabase/ssr は Web Crypto API ベースで Edge 互換
 */
export async function middleware(req: NextRequest) {
  const { supabase, response } = supabaseMiddleware(req);

  try {
    const {
      data: { user },
    } = await supabase.auth.getUser();

    const { pathname } = req.nextUrl;

    // 保護されたパスへの未ログインアクセス → /login にリダイレクト
    if (!user && isProtectedPath(pathname)) {
      const loginUrl = new URL("/login", req.url);
      return NextResponse.redirect(loginUrl);
    }

    // ログイン済みユーザーが /login にアクセス → /chat にリダイレクト
    if (user && pathname === "/login") {
      const chatUrl = new URL("/chat", req.url);
      return NextResponse.redirect(chatUrl);
    }

    return response;
  } catch (err) {
    console.error("[middleware] supabase auth error", err);
    // 認証確認に失敗した場合は安全側に倒して /login にリダイレクト
    return NextResponse.redirect(new URL("/login", req.url));
  }
}

/**
 * 認証が必要なパスかどうかを判定する。
 * matcher の設定と一致するパスのうち、/login 以外が保護対象。
 */
function isProtectedPath(pathname: string): boolean {
  return (
    pathname.startsWith("/chat") ||
    pathname.startsWith("/api/chat") ||
    pathname.startsWith("/api/sessions")
  );
}

export const config = {
  matcher: [
    "/chat/:path*",
    "/api/chat/:path*",
    "/api/sessions/:path*",
    "/login",
  ],
};
