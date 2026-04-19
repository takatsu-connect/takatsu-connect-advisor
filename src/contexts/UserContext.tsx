"use client";

import { createContext, useContext } from "react";
import type { User } from "@supabase/supabase-js";

/**
 * UserContext が保持するユーザー情報。
 * Supabase の User 型のうち、クライアントで頻繁に参照するフィールドを絞り込む。
 */
export type UserInfo = {
  id: User["id"];
  email: string;
};

const UserContext = createContext<UserInfo | null>(null);

type UserContextProviderProps = {
  value: UserInfo;
  children: React.ReactNode;
};

/**
 * UserContextProvider
 *
 * Server Component である (main)/layout.tsx がサーバーサイドで取得したユーザー情報を
 * クライアントツリー全体に提供するプロバイダー。
 */
export function UserContextProvider({ value, children }: UserContextProviderProps) {
  return <UserContext.Provider value={value}>{children}</UserContext.Provider>;
}

/**
 * useUser
 *
 * UserContext からユーザー情報を取得するフック。
 * UserContextProvider の外で呼ばれた場合は Error を throw する（安全性確保）。
 */
export function useUser(): UserInfo {
  const ctx = useContext(UserContext);
  if (ctx === null) {
    throw new Error("useUser は UserContextProvider の内部でのみ使用できます。");
  }
  return ctx;
}
