import "server-only";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/types/supabase";

/**
 * Service Role Key を使う管理者クライアント。
 * RLS をバイパスするため、keepalive_log の INSERT 等サーバー限定の用途でのみ使う。
 * クライアントバンドルに混入させない（server-only import 必須）。
 */
export function supabaseAdmin() {
  return createClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      auth: { persistSession: false, autoRefreshToken: false },
    },
  );
}
