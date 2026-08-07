import { Tabs } from "expo-router";
import Svg, { Rect, Path, Circle } from "react-native-svg";
import { View, Text, type ColorValue } from "react-native";
import { colors, fonts } from "@/constants/theme";
import { BootstrapProvider, useBootstrap } from "@/lib/bootstrap-context";

// Native bottom tabs — same four destinations as the web mobile tab bar.

function icon(render: (color: ColorValue) => React.ReactNode) {
  return ({ color }: { color: ColorValue }) => <>{render(color)}</>;
}

const DashboardIcon = icon((color) => (
  <Svg viewBox="0 0 24 24" width={23} height={23} fill="none" stroke={color} strokeWidth={1.8} strokeLinecap="round">
    <Rect x="3" y="3" width="7" height="7" rx="1" />
    <Rect x="14" y="3" width="7" height="7" rx="1" />
    <Rect x="3" y="14" width="7" height="7" rx="1" />
    <Rect x="14" y="14" width="7" height="7" rx="1" />
  </Svg>
));

const WeeklyIcon = icon((color) => (
  <Svg viewBox="0 0 24 24" width={23} height={23} fill="none" stroke={color} strokeWidth={1.8} strokeLinecap="round">
    <Path d="M12 20h9M16.5 3.5a2.121 2.121 0 013 3L7 19l-4 1 1-4L16.5 3.5z" />
  </Svg>
));

function AlertsIcon({ color }: { color: ColorValue }) {
  const { data } = useBootstrap();
  const count = data?.kpis.unresolvedAlertCount ?? 0;
  return (
    <View>
      <Svg viewBox="0 0 24 24" width={23} height={23} fill="none" stroke={color} strokeWidth={1.8} strokeLinecap="round">
        <Path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9" />
        <Path d="M13.73 21a2 2 0 01-3.46 0" />
      </Svg>
      {count > 0 && (
        <View
          style={{
            position: "absolute",
            top: -5,
            right: -8,
            minWidth: 16,
            height: 16,
            borderRadius: 8,
            backgroundColor: colors.gold,
            alignItems: "center",
            justifyContent: "center",
            paddingHorizontal: 3,
          }}
        >
          <Text style={{ fontFamily: fonts.sansSemiBold, fontSize: 9, color: colors.dark }}>
            {count > 99 ? "99+" : count}
          </Text>
        </View>
      )}
    </View>
  );
}

const ProfileIcon = icon((color) => (
  <Svg viewBox="0 0 24 24" width={23} height={23} fill="none" stroke={color} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
    <Path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2" />
    <Circle cx="12" cy="7" r="4" />
  </Svg>
));

function TabsInner() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarStyle: {
          backgroundColor: colors.dark,
          borderTopColor: "rgba(255,255,255,0.08)",
        },
        tabBarActiveTintColor: colors.tealOnDark,
        tabBarInactiveTintColor: "rgba(255,255,255,0.55)",
        tabBarLabelStyle: { fontFamily: fonts.sansMedium, fontSize: 10 },
      }}
    >
      <Tabs.Screen name="index" options={{ title: "Dashboard", tabBarIcon: DashboardIcon }} />
      <Tabs.Screen name="weekly" options={{ title: "Ma revue", tabBarIcon: WeeklyIcon }} />
      <Tabs.Screen
        name="alerts"
        options={{ title: "Alertes", tabBarIcon: ({ color }) => <AlertsIcon color={color} /> }}
      />
      <Tabs.Screen name="profile" options={{ title: "Profil", tabBarIcon: ProfileIcon }} />
    </Tabs>
  );
}

export default function TabsLayout() {
  return (
    <BootstrapProvider>
      <TabsInner />
    </BootstrapProvider>
  );
}
