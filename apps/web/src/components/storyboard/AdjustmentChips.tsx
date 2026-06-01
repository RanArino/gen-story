"use client";

import { useTranslations } from "next-intl";
import {
  MAX_ADJUSTMENTS_PER_VARIANT,
  TEST_ADJUSTMENT_IDS,
  type TestAdjustmentId,
} from "@gen-story/shared";

type Props = {
  selected: TestAdjustmentId[];
  disabled?: boolean;
  onChange: (next: TestAdjustmentId[]) => void;
};

export function AdjustmentChips({ selected, disabled, onChange }: Props) {
  const t = useTranslations("testGeneration.adjustments");

  function toggle(id: TestAdjustmentId) {
    if (selected.includes(id)) {
      onChange(selected.filter((s) => s !== id));
      return;
    }
    if (selected.length >= MAX_ADJUSTMENTS_PER_VARIANT) return;
    onChange([...selected, id]);
  }

  const limitReached = selected.length >= MAX_ADJUSTMENTS_PER_VARIANT;

  return (
    <div style={{ marginTop: 8 }}>
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: 6,
          justifyContent: "center",
        }}
      >
        {TEST_ADJUSTMENT_IDS.map((id) => {
          const isSelected = selected.includes(id);
          const isDisabled = disabled || (!isSelected && limitReached) || false;
          return (
            <button
              key={id}
              type="button"
              onClick={() => toggle(id)}
              disabled={isDisabled}
              style={{
                fontSize: 12,
                padding: "4px 10px",
                borderRadius: 999,
                border: isSelected ? "1px solid #2563eb" : "1px solid #d4d4d8",
                background: isSelected ? "#dbeafe" : "#fff",
                color: isSelected ? "#1d4ed8" : "#374151",
                cursor: isDisabled ? "not-allowed" : "pointer",
                opacity: isDisabled && !isSelected ? 0.5 : 1,
              }}
            >
              {t(`labels.${id}`)}
            </button>
          );
        })}
      </div>
      <div style={{ fontSize: 11, color: "#888", marginTop: 4 }}>
        {t("limit")}
      </div>
    </div>
  );
}
