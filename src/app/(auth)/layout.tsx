import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/db/supabase-server";
import styles from "./auth.module.css";

export default async function AuthLayout({ children }: { children: React.ReactNode }) {
  const supabase = await supabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user) {
    redirect("/chat" as never);
  }

  return <div className={styles.authShell}>{children}</div>;
}
