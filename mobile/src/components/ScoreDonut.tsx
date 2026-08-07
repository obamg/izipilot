import { View, Text } from "react-native";
import Svg, { Circle } from "react-native-svg";
import { colors, fonts, statusColor } from "@/constants/theme";

// Filled progress ring with the score centered — native twin of the web
// ScoreDonutFilled component.
export function ScoreDonut({
  score,
  size = 42,
  status,
}: {
  score: number;
  size?: number;
  status?: string;
}) {
  const stroke = Math.max(3, size * 0.09);
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const clamped = Math.max(0, Math.min(100, Math.round(score)));
  const color = statusColor(status ?? "", clamped);

  return (
    <View style={{ width: size, height: size, alignItems: "center", justifyContent: "center" }}>
      <Svg width={size} height={size} style={{ position: "absolute", transform: [{ rotate: "-90deg" }] }}>
        <Circle cx={size / 2} cy={size / 2} r={r} stroke={colors.grayLt} strokeWidth={stroke} fill="none" />
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke={color}
          strokeWidth={stroke}
          fill="none"
          strokeLinecap="round"
          strokeDasharray={`${(clamped / 100) * c} ${c}`}
        />
      </Svg>
      <Text
        style={{
          fontFamily: fonts.monoMedium,
          fontSize: size * 0.26,
          color,
        }}
      >
        {clamped}%
      </Text>
    </View>
  );
}
