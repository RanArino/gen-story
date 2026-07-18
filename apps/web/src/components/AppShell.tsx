"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import type { ReactNode } from "react";
import styles from "./AppShell.module.css";

type Props = {
  children: ReactNode;
  projectId?: string;
};

export function AppShell({ children, projectId }: Props) {
  const pathname = usePathname();
  const tCommon = useTranslations("common");
  const tNav = useTranslations("nav");

  function isActive(href: string) {
    return pathname === href || pathname.startsWith(href + "/");
  }

  return (
    <div className={styles.shell}>
      <nav className={styles.sidebar}>
        <div>
          <p className={styles.eyebrow}>{tCommon("appName")}</p>
          <span className={styles.appTitle}>{tCommon("appTitle")}</span>
        </div>
        <div className={styles.stepList}>
          <Link
            href="/projects"
            className={`${styles.stepButton} ${isActive("/projects") && !projectId ? styles.stepButtonActive : ""}`}
          >
            {tNav("projects")}
          </Link>
          {projectId && (
            <>
              <Link
                href={`/projects/${projectId}/photos`}
                className={`${styles.stepButton} ${isActive(`/projects/${projectId}/photos`) ? styles.stepButtonActive : ""}`}
              >
                {tNav("stepPhotos")}
              </Link>
              <Link
                href={`/projects/${projectId}/storyboard`}
                className={`${styles.stepButton} ${isActive(`/projects/${projectId}/storyboard`) ? styles.stepButtonActive : ""}`}
              >
                {tNav("stepStoryboard")}
              </Link>
              <Link
                href={`/projects/${projectId}/generate`}
                className={`${styles.stepButton} ${isActive(`/projects/${projectId}/generate`) ? styles.stepButtonActive : ""}`}
              >
                {tNav("stepGenerate")}
              </Link>
              <Link
                href={`/projects/${projectId}/review`}
                className={`${styles.stepButton} ${isActive(`/projects/${projectId}/review`) ? styles.stepButtonActive : ""}`}
              >
                {tNav("stepReview")}
              </Link>
            </>
          )}
        </div>
        <div className={styles.sidebarFooter}>
          <Link
            href="/settings"
            className={`${styles.stepButton} ${isActive("/settings") ? styles.stepButtonActive : ""}`}
          >
            {tNav("settings")}
          </Link>
        </div>
      </nav>
      <main className={styles.content}>{children}</main>
    </div>
  );
}
