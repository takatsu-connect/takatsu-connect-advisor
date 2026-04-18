export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/db/supabase-server";

/**
 * オープンリダイレクト対策:
 * - 先頭が `/` で始まる相対パスのみ許可
 * - `//` で始まるプロトコル相対URL は外部リダイレクトになるため拒否
 * - バックスラッシュを含むパスは拒否（Chromium系は `/\` を `//` と解釈するため）
 * - `javascript:` スキームは拒否
 */
function sanitizeNextPath(next: string | null): string {
  const defaultPath = "/chat";
  if (!next) return defaultPath;
  if (next.toLowerCase().startsWith("javascript:")) return defaultPath;
  if (next.startsWith("/") && !next.startsWith("//") && !next.includes("\\")) {
    return next;
  }
  return defaultPath;
}

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const next = sanitizeNextPath(url.searchParams.get("next"));

  if (!code) {
    return NextResponse.redirect(new URL("/login?error=missing_code", url));
  }

  const supabase = await supabaseServer();
  const { error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    console.error("[auth/callback] exchangeCodeForSession failed:", error.message);
    return NextResponse.redirect(new URL("/login?error=exchange_failed", url));
  }

  return NextResponse.redirect(new URL(next, url));
}
