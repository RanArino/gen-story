"use client";
import { useEffect, useState, useRef, type ImgHTMLAttributes } from "react";
import type { MediaVariant } from "@gen-story/shared";
import { getMediaUrl } from "../lib/api-client";
import {
  mediaCacheEpoch,
  subscribeMediaUrls,
  type MediaEntity,
} from "../lib/private-media";
import { storageKeyToUrl } from "../lib/image-url";

type Props = Omit<ImgHTMLAttributes<HTMLImageElement>, "src"> & {
  storageKey: string;
  entity: MediaEntity;
  entityId: string;
  variant?: MediaVariant;
};
export function MediaImage({
  storageKey,
  entity,
  entityId,
  variant = "preview",
  ...props
}: Props) {
  const hosted = process.env.NEXT_PUBLIC_GEN_STORY_DEPLOY_TARGET === "cloud";
  const [url, setUrl] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const retries = useRef(0);
  const generation = useRef(0);
  useEffect(
    () =>
      subscribeMediaUrls(() => {
        setUrl(null);
        setRevision((value) => value + 1);
      }),
    [],
  );
  useEffect(() => {
    if (!hosted) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    generation.current++;
    const epoch = mediaCacheEpoch();
    retries.current = 0;
    setUrl(null);
    const refresh = async (fresh = false) => {
      try {
        const result = await getMediaUrl(entity, entityId, variant, fresh);
        if (!active || epoch !== mediaCacheEpoch()) return;
        setUrl(result.url);
        timer = setTimeout(
          () => void refresh(true),
          Math.max(1000, Date.parse(result.expiresAt) - Date.now() - 30_000),
        );
      } catch {
        if (active) setUrl(null);
      }
    };
    void refresh();
    return () => {
      active = false;
      if (timer) clearTimeout(timer);
    };
  }, [hosted, entity, entityId, variant, revision]);
  async function retry() {
    if (retries.current++ > 0) {
      setUrl(null);
      return;
    }
    const epoch = mediaCacheEpoch();
    const currentGeneration = generation.current;
    try {
      const result = await getMediaUrl(entity, entityId, variant, true);
      if (
        epoch === mediaCacheEpoch() &&
        currentGeneration === generation.current
      )
        setUrl(result.url);
    } catch {
      if (
        epoch === mediaCacheEpoch() &&
        currentGeneration === generation.current
      )
        setUrl(null);
    }
  }
  return (
    <img
      {...props}
      src={hosted ? (url ?? undefined) : storageKeyToUrl(storageKey)}
      referrerPolicy="no-referrer"
      onError={hosted ? () => void retry() : props.onError}
    />
  );
}
