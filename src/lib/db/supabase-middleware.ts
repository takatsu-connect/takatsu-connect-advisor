import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import type { Database } from "@/types/supabase";

/**
 * middleware.ts 専用の Supabase クライアント生成。
 * Edge Runtime で動作するため jsonwebtoken/bcrypt は使用禁止。
 * @supabase/ssr は Web Crypto API ベースで Edge 互換。
 */
export function supabaseMiddleware(req: NextRequest) {
  const response = NextResponse.next({ request: req });

  const supabase = createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return req.cookies.getAll();
        },
        setAll(cookiesToSet) {
          for (const { name, value } of cookiesToSet) {
            req.cookies.set(name, value);
          }
          for (const { name, value, options } of cookiesToSet) {
            response.cookies.set({ name, value, ...options });
          }
        },
      },
    },
  );

  return { supabase, response };
}
