import Slider from "@react-native-community/slider";
import { colors } from "@/constants/theme";

// Native slider (iOS/Android). Web uses ProgressSlider.web.tsx — the
// community slider's web shim renders raw text nodes inside Views and spams
// the console, so the web target gets a plain <input type="range"> instead.

export interface ProgressSliderProps {
  value: number;
  onChange: (value: number) => void;
  disabled?: boolean;
  color: string;
  testID?: string;
}

export function ProgressSlider({ value, onChange, disabled, color, testID }: ProgressSliderProps) {
  return (
    <Slider
      style={{ flex: 1, height: 44 }}
      minimumValue={0}
      maximumValue={100}
      step={1}
      value={value}
      disabled={disabled}
      minimumTrackTintColor={color}
      maximumTrackTintColor={colors.grayLt}
      thumbTintColor={color}
      onValueChange={(v: number) => onChange(Math.round(v))}
      testID={testID}
    />
  );
}
