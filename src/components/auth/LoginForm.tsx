"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/db/supabase-browser";
import styles from "./LoginForm.module.css";

export function LoginForm() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  function validateForm(): string | null {
    if (!email.trim()) {
      return "メールアドレスを入力してください。";
    }
    const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailPattern.test(email.trim())) {
      return "有効なメールアドレスを入力してください。";
    }
    if (!password) {
      return "パスワードを入力してください。";
    }
    return null;
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);

    const validationError = validateForm();
    if (validationError) {
      setError(validationError);
      return;
    }

    setIsLoading(true);

    try {
      const supabase = supabaseBrowser();
      const { error: authError } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });

      if (authError) {
        if (authError.message === "Invalid login credentials") {
          setError("メールアドレスまたはパスワードが正しくありません。");
        } else if (authError.message === "Email not confirmed") {
          setError("メールアドレスの確認が完了していません。招待メールをご確認ください。");
        } else {
          setError("ログインに失敗しました。しばらく経ってから再度お試しください。");
        }
        return;
      }

      router.push("/chat" as never);
    } catch {
      setError("ログインに失敗しました。しばらく経ってから再度お試しください。");
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className={styles.form} noValidate>
      {error && (
        <div role="alert" className={styles.errorAlert}>
          {error}
        </div>
      )}

      <div className={styles.field}>
        <label htmlFor="email" className={styles.label}>
          メールアドレス
        </label>
        <input
          id="email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className={styles.input}
          autoComplete="email"
          disabled={isLoading}
          aria-invalid={error !== null ? "true" : undefined}
          aria-describedby={error !== null ? "login-error" : undefined}
          placeholder="example@email.com"
        />
      </div>

      <div className={styles.field}>
        <label htmlFor="password" className={styles.label}>
          パスワード
        </label>
        <input
          id="password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className={styles.input}
          autoComplete="current-password"
          disabled={isLoading}
          placeholder="パスワードを入力"
        />
      </div>

      <button
        type="submit"
        className={styles.submitButton}
        disabled={isLoading}
        aria-busy={isLoading}
      >
        {isLoading ? "ログイン中..." : "ログイン"}
      </button>
    </form>
  );
}
