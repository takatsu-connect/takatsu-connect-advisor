import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/db/supabase-server";
import { UserContextProvider } from "@/contexts/UserContext";
import styles from "./main.module.css";

/**
 * (main)/layout.tsx — Server Component
 *
 * 認証済みユーザー向けルートグループのレイアウト。
 * サーバーサイドで Supabase セッションを検証し、
 * 未ログインの場合は /login へリダイレクトする（middleware の二段階ガード）。
 *
 * ログイン済みの場合は取得した user 情報を UserContextProvider で
 * クライアントツリー全体に提供する。
 */
export default async function MainLayout({ children }: { children: React.ReactNode }) {
  const supabase = await supabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login" as never);
  }

  return (
    <UserContextProvider value={{ id: user.id, email: user.email ?? "" }}>
      <div className={styles.mainShell}>{children}</div>
    </UserContextProvider>
  );
}
