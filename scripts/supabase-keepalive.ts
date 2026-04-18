/**
 * Supabase 無料版フリーズ防止用の keep-alive スクリプト。
 * GitHub Actions から `tsx scripts/supabase-keepalive.ts` で呼び出す。
 *
 * 動作:
 *  - `SUPABASE_URL/rest/v1/keepalive_log` に POST で 1 行 INSERT する
 *  - service_role key を使うため RLS をバイパス
 *  - source フィールドを `github-actions` 固定で記録
 */

type Env = {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  KEEPALIVE_SOURCE?: string;
};

function readEnv(): Env {
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, KEEPALIVE_SOURCE } = process.env;
  if (!SUPABASE_URL) throw new Error("SUPABASE_URL is required");
  if (!SUPABASE_SERVICE_ROLE_KEY) throw new Error("SUPABASE_SERVICE_ROLE_KEY is required");
  return { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, KEEPALIVE_SOURCE };
}

export async function pingKeepalive(env: Env, fetchImpl: typeof fetch = fetch): Promise<void> {
  const url = `${env.SUPABASE_URL.replace(/\/$/, "")}/rest/v1/keepalive_log`;
  const source = env.KEEPALIVE_SOURCE ?? "github-actions";
  const res = await fetchImpl(url, {
    method: "POST",
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      "Content-Type": "application/json",
      Prefer: "return=minimal",
    },
    body: JSON.stringify({ source }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`keepalive_log insert failed: ${res.status} ${res.statusText} - ${body}`);
  }
}

async function main() {
  const env = readEnv();
  const started = Date.now();
  await pingKeepalive(env);
  const elapsed = Date.now() - started;
  console.log(`[keepalive] OK (${elapsed} ms)`);
}

if (require.main === module) {
  main().catch((err) => {
    console.error("[keepalive] failed:", err);
    process.exit(1);
  });
}
