import "server-only";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import type { Database } from "@/types/supabase";

export async function supabaseServer() {
  const cookieStore = await cookies();
  return createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            for (const { name, value, options } of cookiesToSet) {
              cookieStore.set({ name, value, ...options });
            }
          } catch (error) {
            // Server Component から set が呼ばれると例外。middleware 経由で更新されるため無視して良い。
            console.error("[supabaseServer] cookie set failed (expected in RSC):", error);
          }
        },
      },
    },
  );
}
