export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/db/supabase-server";

/**
 * POST /api/auth/signout
 *
 * サーバー側 Cookie をクリアしてサインアウトし、/login へリダイレクトする。
 *
 * - HTTP メソッド: POST のみ（CSRF 対策）
 * - signOut() 失敗時もリダイレクトする（UX 優先）
 * - 303 See Other: POST → GET に変換するリダイレクト
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const supabase = await supabaseServer();

    // 認証チェック: 未認証または取得エラーの場合は 401 を返す
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || user === null) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }

    const { error } = await supabase.auth.signOut();

    if (error) {
      console.error("[auth/signout] signOut failed:", error.message);
      // エラーが発生してもユーザーには /login にリダイレクトする
    }
  } catch (err) {
    console.error("[auth/signout] unexpected error:", err);
    // 予期しないエラーが発生してもリダイレクトを継続する
  }

  return NextResponse.redirect(new URL("/login", request.url), { status: 303 });
}
