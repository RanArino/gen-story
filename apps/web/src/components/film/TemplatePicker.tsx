"use client";
import { useEffect, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import {
  FILM_ASPECTS,
  type FilmAspect,
  type FilmTemplateDto,
} from "@gen-story/shared";
import styles from "./FilmWorkspace.module.css";

/** One pre-rendered sample export (see public/film-previews/README.md). */
export interface TemplateSample {
  id: string;
  revision: string;
  aspect: FilmAspect;
  durationMs: number;
  mp4: string;
  poster: string;
}

const MANIFEST = "/film-previews/templates/manifest.json";

/** Loads the generated sample manifest once; a missing manifest means "no samples". */
export function useTemplateSamples(): TemplateSample[] {
  const [samples, setSamples] = useState<TemplateSample[]>([]);
  useEffect(() => {
    let live = true;
    fetch(MANIFEST)
      .then((r) => (r.ok ? (r.json() as Promise<TemplateSample[]>) : []))
      .then((list) => live && setSamples(list))
      .catch(() => live && setSamples([]));
    return () => {
      live = false;
    };
  }, []);
  return samples;
}

/** Samples are bound to the template revision they were rendered from. */
export function sampleFor(
  samples: TemplateSample[],
  template: FilmTemplateDto | undefined,
  aspect: FilmAspect,
) {
  return template
    ? samples.find(
        (s) =>
          s.id === template.id &&
          s.revision === template.revision &&
          s.aspect === aspect,
      )
    : undefined;
}

/**
 * Compares the offered templates on the same sample photos at the project's video size and
 * chooses one. The size toggle changes only the sample shown, never the project.
 */
export function TemplatePicker({
  open,
  templates,
  current,
  aspect,
  reducedMotion,
  samples,
  onClose,
  onChoose,
}: {
  open: boolean;
  templates: FilmTemplateDto[];
  current: string;
  aspect: FilmAspect;
  reducedMotion: boolean;
  samples: TemplateSample[];
  onClose: () => void;
  onChoose: (id: string) => void;
}) {
  const t = useTranslations("film.workspace");
  const ta = useTranslations("film.aspects");
  const language = useLocale() === "ja" ? "ja" : "en";
  const ref = useRef<HTMLDialogElement>(null);
  const offered = templates.filter((x) => x.offered);
  const [choice, setChoice] = useState(current);
  const [size, setSize] = useState<FilmAspect>(aspect);
  useEffect(() => {
    if (open) {
      setChoice(
        offered.some((x) => x.id === current)
          ? current
          : (offered[0]?.id ?? ""),
      );
      setSize(aspect);
      ref.current?.showModal();
    } else ref.current?.close();
    // Re-initialize only when the dialog opens.
  }, [open]);
  const chosen = offered.find((x) => x.id === choice);
  const sample = sampleFor(samples, chosen, size);
  return (
    <dialog
      ref={ref}
      className={`${styles.audition} ${styles.templatePicker}`}
      aria-labelledby="template-picker-title"
      onClose={onClose}
      onCancel={onClose}
    >
      <div className={styles.auditionHeader}>
        <h3 id="template-picker-title">{t("pickerTitle")}</h3>
        <button type="button" aria-label={t("close")} onClick={onClose}>
          ×
        </button>
      </div>
      <p className={styles.note}>{t("pickerHint")}</p>
      <div className={styles.pickerBody}>
        <div
          className={styles.templateList}
          role="radiogroup"
          aria-label={t("templateLabel")}
        >
          {offered.map((x) => {
            const poster = sampleFor(samples, x, size)?.poster;
            return (
              <label key={x.id} className={styles.templateOption}>
                <input
                  type="radio"
                  name="film-template"
                  value={x.id}
                  checked={choice === x.id}
                  onChange={() => setChoice(x.id)}
                />
                <span
                  className={styles.templatePoster}
                  style={{ aspectRatio: size.replace(":", " / ") }}
                >
                  {poster ? (
                    <img src={poster} alt="" loading="lazy" />
                  ) : (
                    <span>{t("noSample")}</span>
                  )}
                </span>
                <span className={styles.templateName}>
                  {x.name[language]}
                  {x.id === current && (
                    <span className={styles.inUse}>{t("inUse")}</span>
                  )}
                </span>
                <span className={styles.templateDescription}>
                  {x.description[language]}
                </span>
              </label>
            );
          })}
        </div>
        <section
          className={styles.templatePreview}
          aria-label={t("samplePreview")}
        >
          {sample ? (
            <video
              key={sample.mp4}
              className={styles.templateVideo}
              style={{ aspectRatio: size.replace(":", " / ") }}
              src={sample.mp4}
              poster={sample.poster}
              controls
              playsInline
              preload="none"
              aria-label={
                chosen &&
                t("sampleOf", {
                  name: chosen.name[language],
                  size: ta(size.replace(":", "x")),
                })
              }
            />
          ) : (
            <div
              className={`${styles.frame} ${styles.templateVideo}`}
              style={{ aspectRatio: size.replace(":", " / ") }}
            >
              <p className={styles.emptyFrame}>{t("noSample")}</p>
            </div>
          )}
          {chosen && (
            <ul className={styles.templateFacts}>
              {chosen.facts.map((fact) => (
                <li key={fact.en}>{fact[language]}</li>
              ))}
            </ul>
          )}
          <fieldset className={styles.segmented}>
            <legend>{t("sampleSize")}</legend>
            {FILM_ASPECTS.map((a) => (
              <label key={a}>
                <input
                  type="radio"
                  name="template-sample-size"
                  checked={size === a}
                  onChange={() => setSize(a)}
                />
                {ta(a.replace(":", "x"))}
              </label>
            ))}
          </fieldset>
          <p className={styles.note}>{t("sampleSizeHint")}</p>
          {reducedMotion && (
            <p className={styles.note}>{t("sampleReducedMotion")}</p>
          )}
        </section>
      </div>
      <div className={styles.dialogActions}>
        <button type="button" onClick={onClose}>
          {t("cancel")}
        </button>
        <button
          type="button"
          className={styles.primary}
          disabled={!chosen || choice === current}
          onClick={() => {
            onChoose(choice);
            onClose();
          }}
        >
          {choice === current ? t("inUse") : t("useTemplate")}
        </button>
      </div>
    </dialog>
  );
}
