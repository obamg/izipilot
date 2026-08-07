import { View, Text } from "react-native";
import { colors, fonts, STATUS_LABELS } from "@/constants/theme";

const BG: Record<string, string> = {
  ON_TRACK: colors.greenLt,
  AT_RISK: colors.goldLt,
  BLOCKED: colors.redLt,
  NOT_STARTED: colors.grayLt,
};
const FG: Record<string, string> = {
  ON_TRACK: colors.green,
  AT_RISK: "#b57f00", // darker gold for contrast on goldLt (WCAG)
  BLOCKED: colors.red,
  NOT_STARTED: colors.gray,
};

export function StatusBadge({ status }: { status: string }) {
  return (
    <View
      style={{
        backgroundColor: BG[status] ?? colors.grayLt,
        borderRadius: 999,
        paddingHorizontal: 10,
        paddingVertical: 4,
        alignSelf: "flex-start",
      }}
    >
      <Text style={{ fontFamily: fonts.sansSemiBold, fontSize: 11, color: FG[status] ?? colors.gray }}>
        {STATUS_LABELS[status] ?? status}
      </Text>
    </View>
  );
}
