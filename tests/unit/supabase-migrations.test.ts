/**
 * @jest-environment node
 *
 * SQL マイグレーションファイルの構造を静的に検証する。
 * 実DBへの接続は行わず、テキストマッチで設計との整合性を確認する。
 */
import { readFileSync, readdirSync } from "fs";
import { resolve } from "path";

const MIGRATIONS_DIR = resolve(__dirname, "../../supabase/migrations");

function readMigration(name: string): string {
  return readFileSync(resolve(MIGRATIONS_DIR, name), "utf-8");
}

describe("Supabase migrations", () => {
  it("contains all required migration files in timestamp order", () => {
    const files = readdirSync(MIGRATIONS_DIR)
      .filter((f) => f.endsWith(".sql"))
      .sort();

    expect(files).toEqual([
      "20260501000000_init_schema.sql",
      "20260502000000_rls_policies.sql",
      "20260503000000_triggers.sql",
    ]);
  });

  describe("init_schema.sql", () => {
    let sql: string;
    beforeAll(() => {
      sql = readMigration("20260501000000_init_schema.sql");
    });

    it("creates the 4 required tables", () => {
      for (const table of [
        "public.chat_sessions",
        "public.chat_messages",
        "public.specialist_traces",
        "public.keepalive_log",
      ]) {
        expect(sql).toMatch(new RegExp(`create table ${table.replace(".", "\\.")}\\b`));
      }
    });

    it("uses UUID primary key with gen_random_uuid() for app tables", () => {
      const matches = sql.match(/id uuid primary key default gen_random_uuid\(\)/g) ?? [];
      expect(matches.length).toBeGreaterThanOrEqual(3);
    });

    it("defines required indexes", () => {
      expect(sql).toMatch(/idx_chat_sessions_user_last/);
      expect(sql).toMatch(/idx_chat_messages_session_created/);
      expect(sql).toMatch(/uq_chat_messages_user_nonce/);
      expect(sql).toMatch(/idx_specialist_traces_message/);
      expect(sql).toMatch(/idx_specialist_traces_user_created/);
    });

    it("enforces role and status check constraints", () => {
      expect(sql).toMatch(/role in \('user', 'assistant', 'system'\)/);
      expect(sql).toMatch(/status in \('ok', 'timeout', 'error', 'skipped'\)/);
    });

    it("defines ON DELETE CASCADE for all FKs to auth.users and sessions", () => {
      const cascades = sql.match(/on delete cascade/g) ?? [];
      expect(cascades.length).toBeGreaterThanOrEqual(6);
    });
  });

  describe("rls_policies.sql", () => {
    let sql: string;
    beforeAll(() => {
      sql = readMigration("20260502000000_rls_policies.sql");
    });

    it("enables RLS on all 4 tables", () => {
      for (const table of [
        "chat_sessions",
        "chat_messages",
        "specialist_traces",
        "keepalive_log",
      ]) {
        expect(sql).toMatch(new RegExp(`alter table public\\.${table} enable row level security`));
      }
    });

    it("defines SELECT policies scoped to auth.uid() = user_id", () => {
      expect(sql).toMatch(/chat_sessions_select_own[\s\S]*auth\.uid\(\) = user_id/);
      expect(sql).toMatch(/chat_messages_select_own[\s\S]*auth\.uid\(\) = user_id/);
      expect(sql).toMatch(/specialist_traces_select_own[\s\S]*auth\.uid\(\) = user_id/);
    });

    it("chat_messages INSERT policy verifies session ownership via exists", () => {
      expect(sql).toMatch(/chat_messages_insert_own[\s\S]*exists[\s\S]*chat_sessions/);
    });

    it("specialist_traces INSERT policy verifies message ownership via exists", () => {
      expect(sql).toMatch(/specialist_traces_insert_own[\s\S]*exists[\s\S]*chat_messages/);
    });

    it("keepalive_log has no SELECT/INSERT policy (implicit deny)", () => {
      expect(sql).not.toMatch(/on public\.keepalive_log for (select|insert|update|delete)/);
    });

    it("chat_sessions has no delete policy (history is immutable)", () => {
      expect(sql).not.toMatch(/on public\.chat_sessions for delete/);
    });
  });

  describe("triggers.sql", () => {
    let sql: string;
    beforeAll(() => {
      sql = readMigration("20260503000000_triggers.sql");
    });

    it("defines touch_chat_session function with security definer", () => {
      expect(sql).toMatch(/create or replace function public\.touch_chat_session/);
      expect(sql).toMatch(/security definer/);
      expect(sql).toMatch(/set search_path = public/);
    });

    it("creates after-insert trigger on chat_messages", () => {
      expect(sql).toMatch(
        /create trigger trg_touch_chat_session\s+after insert on public\.chat_messages/,
      );
    });

    it("increments message_count and updates last_message_at", () => {
      expect(sql).toMatch(/last_message_at = new\.created_at/);
      expect(sql).toMatch(/message_count = message_count \+ 1/);
    });
  });
});
