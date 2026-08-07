import type { ProgressSliderProps } from "./ProgressSlider";
import { colors } from "@/constants/theme";

// Web variant: plain <input type="range">. Only used for development and E2E
// verification of the native app — distribution builds use ProgressSlider.tsx.

export function ProgressSlider({ value, onChange, disabled, color, testID }: ProgressSliderProps) {
  return (
    <input
      type="range"
      min={0}
      max={100}
      step={1}
      value={value}
      disabled={disabled}
      data-testid={testID}
      onChange={(e) => onChange(Number(e.target.value))}
      style={{
        flex: 1,
        height: 44,
        accentColor: color,
        background: colors.grayLt,
      }}
    />
  );
}
