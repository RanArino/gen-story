"use client";

import { onAuthStateChanged } from "firebase/auth";
import { useTranslations } from "next-intl";
import { useEffect, useState, type FormEvent, type ReactNode } from "react";

import {
  firebaseAuth,
  signInWithEmail,
  signInWithGoogle,
  signOutFromFirebase,
} from "../../lib/auth/firebase-client";
import { endSession, establishSession } from "../../lib/auth/session-client";
import { clearMediaUrls, setMediaAccount } from "../../lib/private-media";
import styles from "./AuthGate.module.css";

type Props = { children: ReactNode };
type AuthState = "loading" | "signed-out" | "signed-in";

export function AuthGate({ children }: Props) {
  const hosted = process.env.NEXT_PUBLIC_GEN_STORY_DEPLOY_TARGET === "cloud";
  const t = useTranslations("auth");
  const [state, setState] = useState<AuthState>(
    hosted ? "loading" : "signed-in",
  );
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!hosted) return;
    let active = true;
    let unsubscribe: () => void = () => undefined;

    void firebaseAuth()
      .then((auth) => {
        unsubscribe = onAuthStateChanged(auth, async (user) => {
          if (!active) return;
          setMediaAccount(user?.uid ?? null);
          if (user == null) {
            setState("signed-out");
            return;
          }
          try {
            await establishSession(await user.getIdToken());
            if (active) setState("signed-in");
          } catch {
            if (active) {
              setError(t("sessionFailed"));
              setState("signed-out");
            }
          }
        });
      })
      .catch(() => {
        if (active) {
          setError(t("configurationFailed"));
          setState("signed-out");
        }
      });

    return () => {
      active = false;
      unsubscribe();
    };
  }, [hosted, t]);

  async function runSignIn(action: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch {
      setError(t("signInFailed"));
    } finally {
      setBusy(false);
    }
  }

  async function submitEmail(event: FormEvent) {
    event.preventDefault();
    await runSignIn(() => signInWithEmail(email, password));
  }

  async function signOut() {
    setBusy(true);
    setError(null);
    try {
      clearMediaUrls();
      await endSession();
      await signOutFromFirebase();
      setState("signed-out");
    } catch {
      setError(t("signOutFailed"));
    } finally {
      setBusy(false);
    }
  }

  if (state === "loading") {
    return <main className={styles.center}>{t("loading")}</main>;
  }

  if (state === "signed-out") {
    return (
      <main className={styles.center}>
        <section className={styles.card} aria-labelledby="auth-title">
          <h1 id="auth-title">{t("title")}</h1>
          <p>{t("subtitle")}</p>
          <button
            className={styles.googleButton}
            type="button"
            disabled={busy}
            onClick={() => void runSignIn(signInWithGoogle)}
          >
            {t("google")}
          </button>
          <div className={styles.divider}>{t("or")}</div>
          <form onSubmit={(event) => void submitEmail(event)}>
            <label>
              {t("email")}
              <input
                type="email"
                autoComplete="username"
                required
                value={email}
                onChange={(event) => setEmail(event.target.value)}
              />
            </label>
            <label>
              {t("password")}
              <input
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
            </label>
            <button type="submit" disabled={busy}>
              {t("emailSignIn")}
            </button>
          </form>
          {error != null && <p className={styles.error}>{error}</p>}
        </section>
      </main>
    );
  }

  return (
    <>
      <button
        className={styles.signOut}
        type="button"
        disabled={busy}
        onClick={() => void signOut()}
      >
        {t("signOut")}
      </button>
      {error != null && <p className={styles.sessionError}>{error}</p>}
      {children}
    </>
  );
}
