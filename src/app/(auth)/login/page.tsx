import type { Metadata } from "next";
import { LoginForm } from "@/components/auth/LoginForm";
import { GoogleLoginButton } from "@/components/auth/GoogleLoginButton";
import styles from "./page.module.css";

export const metadata: Metadata = {
  title: "ログイン | Takatsu Connect Advisor",
  description: "高津コネクト運営アドバイザーにログイン",
};

export default function LoginPage() {
  return (
    <main className={styles.container}>
      <div className={styles.card}>
        <header className={styles.header}>
          <h1 className={styles.title}>高津コネクト Advisor</h1>
          <p className={styles.description}>
            運営メンバー専用のアドバイザーサービスです。
            <br />
            招待されたアカウントでログインしてください。
          </p>
        </header>

        <div className={styles.formSection}>
          <LoginForm />
        </div>

        <div className={styles.divider}>
          <span className={styles.dividerText}>または</span>
        </div>

        <div className={styles.oauthSection}>
          <GoogleLoginButton />
        </div>
      </div>
    </main>
  );
}
