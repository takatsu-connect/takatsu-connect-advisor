/**
 * 手書きのSupabase Database型。
 * supabase/migrations/ のスキーマと同期して管理する。
 * Supabase CLI 接続後は `supabase gen types typescript` で自動生成に切り替える。
 */

export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type MessageRole = "user" | "assistant" | "system";
export type SpecialistStatus = "ok" | "timeout" | "error" | "skipped";

export type Database = {
  public: {
    Tables: {
      chat_sessions: {
        Row: {
          id: string;
          user_id: string;
          title: string;
          created_at: string;
          last_message_at: string;
          message_count: number;
        };
        Insert: {
          id?: string;
          user_id: string;
          title?: string;
          created_at?: string;
          last_message_at?: string;
          message_count?: number;
        };
        Update: {
          id?: string;
          user_id?: string;
          title?: string;
          created_at?: string;
          last_message_at?: string;
          message_count?: number;
        };
        Relationships: [
          {
            foreignKeyName: "chat_sessions_user_id_fkey";
            columns: ["user_id"];
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
        ];
      };
      chat_messages: {
        Row: {
          id: string;
          session_id: string;
          user_id: string;
          role: MessageRole;
          content: string;
          created_at: string;
          client_nonce: string | null;
        };
        Insert: {
          id?: string;
          session_id: string;
          user_id: string;
          role: MessageRole;
          content: string;
          created_at?: string;
          client_nonce?: string | null;
        };
        Update: {
          id?: string;
          session_id?: string;
          user_id?: string;
          role?: MessageRole;
          content?: string;
          created_at?: string;
          client_nonce?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "chat_messages_session_id_fkey";
            columns: ["session_id"];
            referencedRelation: "chat_sessions";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "chat_messages_user_id_fkey";
            columns: ["user_id"];
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
        ];
      };
      specialist_traces: {
        Row: {
          id: string;
          message_id: string;
          session_id: string;
          user_id: string;
          agent_name: string;
          status: SpecialistStatus;
          summary: string | null;
          tool_calls: Json;
          latency_ms: number | null;
          usage: Json | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          message_id: string;
          session_id: string;
          user_id: string;
          agent_name: string;
          status: SpecialistStatus;
          summary?: string | null;
          tool_calls?: Json;
          latency_ms?: number | null;
          usage?: Json | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          message_id?: string;
          session_id?: string;
          user_id?: string;
          agent_name?: string;
          status?: SpecialistStatus;
          summary?: string | null;
          tool_calls?: Json;
          latency_ms?: number | null;
          usage?: Json | null;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "specialist_traces_message_id_fkey";
            columns: ["message_id"];
            referencedRelation: "chat_messages";
            referencedColumns: ["id"];
          },
        ];
      };
      keepalive_log: {
        Row: {
          id: number;
          pinged_at: string;
          source: string;
        };
        Insert: {
          id?: number;
          pinged_at?: string;
          source?: string;
        };
        Update: {
          id?: number;
          pinged_at?: string;
          source?: string;
        };
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: {
      touch_chat_session: {
        Args: Record<string, never>;
        Returns: unknown;
      };
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};

export type ChatSessionRow = Database["public"]["Tables"]["chat_sessions"]["Row"];
export type ChatMessageRow = Database["public"]["Tables"]["chat_messages"]["Row"];
export type SpecialistTraceRow = Database["public"]["Tables"]["specialist_traces"]["Row"];
export type KeepaliveLogRow = Database["public"]["Tables"]["keepalive_log"]["Row"];
