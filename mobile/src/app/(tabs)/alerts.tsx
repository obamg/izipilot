import { useState, useEffect, useCallback } from "react";
import { View, Text, FlatList, RefreshControl, StyleSheet, ActivityIndicator } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { getAlerts, type Alert } from "@/lib/api";
import { colors, fonts } from "@/constants/theme";

const SEVERITY_COLOR: Record<string, string> = {
  LOW: colors.gray,
  MEDIUM: colors.gold,
  HIGH: "#d97706",
  CRITICAL: colors.red,
};

const TYPE_LABELS: Record<string, string> = {
  KR_BLOCKED: "KR bloqué",
  KR_DECLINING: "KR en baisse",
  ENTRY_MISSING: "Saisie manquante",
  ESCALATION_48H: "Escalade 48h",
  SCORE_BELOW_40: "Score < 40%",
};

export default function AlertsScreen() {
  const [alerts, setAlerts] = useState<Alert[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      setError(null);
      setAlerts(await getAlerts());
    } catch {
      setError("Impossible de charger les alertes.");
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Alertes</Text>
        {alerts && alerts.length > 0 && (
          <Text style={styles.headerCount}>{alerts.length} active{alerts.length > 1 ? "s" : ""}</Text>
        )}
      </View>
      {alerts === null && !error ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.teal} />
        </View>
      ) : (
        <FlatList
          style={{ backgroundColor: colors.grayLt }}
          contentContainerStyle={styles.list}
          data={alerts ?? []}
          keyExtractor={(a) => a.id}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.teal} />}
          ListEmptyComponent={
            <View style={styles.emptyCard}>
              <Text style={styles.emptyTitle}>{error ?? "Aucune alerte active"}</Text>
              {!error && <Text style={styles.emptySub}>Tous les KRs sont sous contrôle. 🎉</Text>}
            </View>
          }
          renderItem={({ item }) => {
            const sevColor = SEVERITY_COLOR[item.severity] ?? colors.gray;
            return (
              <View style={[styles.alertCard, { borderLeftColor: sevColor }]}>
                <View style={styles.alertHead}>
                  <Text style={[styles.alertType, { color: sevColor }]}>
                    {TYPE_LABELS[item.type] ?? item.type}
                  </Text>
                  <Text style={styles.alertDate}>
                    {new Date(item.createdAt).toLocaleDateString("fr-FR", { day: "numeric", month: "short" })}
                  </Text>
                </View>
                <Text style={styles.alertTitle}>{item.message}</Text>
                {item.keyResult && (
                  <Text style={styles.alertKr} numberOfLines={1}>
                    KR : {item.keyResult.title}
                  </Text>
                )}
              </View>
            );
          }}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.dark },
  center: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.grayLt },
  header: {
    backgroundColor: colors.dark,
    paddingHorizontal: 20,
    paddingVertical: 14,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  headerTitle: { fontFamily: fonts.serif, fontSize: 22, color: "#fff" },
  headerCount: {
    fontFamily: fonts.sansMedium,
    fontSize: 11,
    color: colors.gold,
    backgroundColor: "rgba(244,169,0,0.15)",
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    overflow: "hidden",
  },
  list: { padding: 14, paddingBottom: 24, flexGrow: 1 },
  emptyCard: { backgroundColor: "#fff", borderRadius: 12, padding: 28, alignItems: "center" },
  emptyTitle: { fontFamily: fonts.sansMedium, fontSize: 14, color: colors.darkMd },
  emptySub: { fontFamily: fonts.sans, fontSize: 12, color: colors.gray, marginTop: 4 },
  alertCard: {
    backgroundColor: "#fff",
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.borderSoft,
    borderLeftWidth: 4,
    padding: 14,
    marginBottom: 10,
  },
  alertHead: { flexDirection: "row", justifyContent: "space-between", marginBottom: 4 },
  alertType: { fontFamily: fonts.sansSemiBold, fontSize: 11, letterSpacing: 0.4, textTransform: "uppercase" },
  alertDate: { fontFamily: fonts.mono, fontSize: 11, color: colors.gray },
  alertTitle: { fontFamily: fonts.sansMedium, fontSize: 14, color: colors.dark, lineHeight: 19 },
  alertMessage: { fontFamily: fonts.sans, fontSize: 13, color: colors.gray, marginTop: 4, lineHeight: 18 },
  alertKr: { fontFamily: fonts.mono, fontSize: 11, color: colors.tealDk, marginTop: 6 },
});
