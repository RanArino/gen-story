"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import styles from "./AppShell.module.css";

type Props = {
  children: ReactNode;
  projectId?: string;
};

export function AppShell({ children, projectId }: Props) {
  const pathname = usePathname();

  function isActive(href: string) {
    return pathname === href || pathname.startsWith(href + "/");
  }

  return (
    <div className={styles.shell}>
      <nav className={styles.sidebar}>
        <div>
          <p className={styles.eyebrow}>Gen Story</p>
          <span className={styles.appTitle}>Story Builder</span>
        </div>
        <div className={styles.stepList}>
          <Link
            href="/projects"
            className={`${styles.stepButton} ${isActive("/projects") && !projectId ? styles.stepButtonActive : ""}`}
          >
            Projects
          </Link>
          {projectId && (
            <>
              <Link
                href={`/projects/${projectId}/photos`}
                className={`${styles.stepButton} ${isActive(`/projects/${projectId}/photos`) ? styles.stepButtonActive : ""}`}
              >
                1 · Photos
              </Link>
              <Link
                href={`/projects/${projectId}/storyboard`}
                className={`${styles.stepButton} ${isActive(`/projects/${projectId}/storyboard`) ? styles.stepButtonActive : ""}`}
              >
                2 · Storyboard
              </Link>
              <Link
                href={`/projects/${projectId}/generate`}
                className={`${styles.stepButton} ${isActive(`/projects/${projectId}/generate`) ? styles.stepButtonActive : ""}`}
              >
                3 · Generate
              </Link>
              <Link
                href={`/projects/${projectId}/review`}
                className={`${styles.stepButton} ${isActive(`/projects/${projectId}/review`) ? styles.stepButtonActive : ""}`}
              >
                4 · Review
              </Link>
            </>
          )}
        </div>
      </nav>
      <main className={styles.content}>{children}</main>
    </div>
  );
}
