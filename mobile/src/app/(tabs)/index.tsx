import { View, Text, ScrollView, RefreshControl, StyleSheet, Pressable } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { useState, useCallback } from "react";
import { useBootstrap } from "@/lib/bootstrap-context";
import { colors, fonts } from "@/constants/theme";
import { ScoreDonut } from "@/components/ScoreDonut";

function KpiCard({ label, value, color, suffix }: { label: string; value: number; color: string; suffix?: string }) {
  return (
    <View style={styles.kpiCard}>
      <Text style={styles.kpiLabel}>{label}</Text>
      <Text style={[styles.kpiValue, { color }]}>
        {value}
        {suffix && <Text style={styles.kpiSuffix}> {suffix}</Text>}
      </Text>
    </View>
  );
}

function EntityRow({ code, name, color, scorePercent }: { code: string; name: string; color: string; scorePercent: number }) {
  return (
    <View style={styles.entityRow}>
      <View style={[styles.entityCode, { backgroundColor: `${color}22` }]}>
        <Text style={[styles.entityCodeText, { color }]}>{code}</Text>
      </View>
      <Text style={styles.entityName} numberOfLines={1}>
        {name}
      </Text>
      <View style={styles.entityBarTrack}>
        <View
          style={[
            styles.entityBarFill,
            {
              width: `${Math.max(2, Math.min(100, scorePercent))}%`,
              backgroundColor:
                scorePercent >= 70 ? colors.green : scorePercent >= 40 ? colors.gold : colors.red,
            },
          ]}
        />
      </View>
      <Text style={styles.entityScore}>{scorePercent}%</Text>
    </View>
  );
}

export default function DashboardScreen() {
  const { data, loading, error, refresh } = useBootstrap();
  const router = useRouter();
  const [refreshing, setRefreshing] = useState(false);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await refresh();
    setRefreshing(false);
  }, [refresh]);

  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>
          Semaine {data ? data.week.weekNumber : "…"}
        </Text>
        {data && (
          <Text style={styles.headerWeek}>
            S{String(data.week.weekNumber).padStart(2, "0")} · {data.week.year}
          </Text>
        )}
      </View>
      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.teal} />}
      >
        {error && (
          <Pressable style={styles.errorBox} onPress={refresh}>
            <Text style={styles.errorText}>{error}</Text>
            <Text style={styles.errorRetry}>Toucher pour réessayer</Text>
          </Pressable>
        )}

        {loading && !data && <Text style={styles.loadingText}>Chargement…</Text>}

        {data && (
          <>
            {/* Submission call-to-action */}
            {!data.weekly.isReadOnly && data.weekly.krData.length > 0 && (
              <Pressable
                style={({ pressed }) => [styles.cta, pressed && { backgroundColor: colors.tealDk }]}
                onPress={() => router.push("/(tabs)/weekly")}
              >
                <Text style={styles.ctaText}>
                  {data.weekly.submittedCount > 0 ? "Compléter ma revue" : "Soumettre ma revue"} →
                </Text>
                <Text style={styles.ctaHint}>Deadline dimanche 23h59</Text>
              </Pressable>
            )}

            {/* Global score */}
            <View style={styles.globalCard}>
              <ScoreDonut score={data.kpis.globalScorePercent} size={84} />
              <View style={{ flex: 1, marginLeft: 16 }}>
                <Text style={styles.globalLabel}>SCORE GLOBAL</Text>
                <Text style={styles.globalSub}>
                  {data.kpis.totalKrs} Key Results suivis
                </Text>
              </View>
            </View>

            {/* KPI row */}
            <View style={styles.kpiRow}>
              <KpiCard label="EN BONNE VOIE" value={data.kpis.onTrack} color={colors.green} suffix="KRs" />
              <KpiCard label="ATTENTION" value={data.kpis.atRisk} color={colors.gold} suffix="KRs" />
            </View>
            <View style={styles.kpiRow}>
              <KpiCard label="BLOQUÉS" value={data.kpis.blocked} color={colors.red} suffix="KRs" />
              <KpiCard label="ALERTES" value={data.kpis.unresolvedAlertCount} color={data.kpis.unresolvedAlertCount > 0 ? colors.gold : colors.gray} suffix="actives" />
            </View>

            {/* Products */}
            <Text style={styles.sectionTitle}>Produits</Text>
            <View style={styles.entityCard}>
              {data.products.map((p) => (
                <EntityRow key={p.code} {...p} />
              ))}
            </View>

            {/* Departments */}
            <Text style={styles.sectionTitle}>Départements</Text>
            <View style={styles.entityCard}>
              {data.departments.map((d) => (
                <EntityRow key={d.code} {...d} />
              ))}
            </View>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.dark },
  header: {
    backgroundColor: colors.dark,
    paddingHorizontal: 20,
    paddingVertical: 14,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  headerTitle: { fontFamily: fonts.serif, fontSize: 24, color: "#fff" },
  headerWeek: {
    fontFamily: fonts.mono,
    fontSize: 12,
    color: "rgba(255,255,255,0.55)",
    backgroundColor: "rgba(255,255,255,0.07)",
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    overflow: "hidden",
  },
  scroll: { backgroundColor: colors.grayLt, padding: 16, paddingBottom: 32, flexGrow: 1 },
  loadingText: { fontFamily: fonts.sans, color: colors.gray, textAlign: "center", marginTop: 40 },
  errorBox: {
    backgroundColor: colors.redLt,
    borderRadius: 10,
    padding: 14,
    marginBottom: 12,
  },
  errorText: { fontFamily: fonts.sansMedium, fontSize: 13, color: colors.red },
  errorRetry: { fontFamily: fonts.sans, fontSize: 12, color: colors.gray, marginTop: 4 },
  cta: {
    backgroundColor: colors.teal,
    borderRadius: 12,
    padding: 16,
    marginBottom: 14,
  },
  ctaText: { fontFamily: fonts.sansSemiBold, fontSize: 16, color: "#fff" },
  ctaHint: { fontFamily: fonts.sans, fontSize: 12, color: "rgba(255,255,255,0.75)", marginTop: 3 },
  globalCard: {
    backgroundColor: "#fff",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.borderSoft,
    padding: 16,
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 12,
  },
  globalLabel: { fontFamily: fonts.sansSemiBold, fontSize: 11, letterSpacing: 0.8, color: colors.gray },
  globalSub: { fontFamily: fonts.sans, fontSize: 13, color: colors.darkMd, marginTop: 4 },
  kpiRow: { flexDirection: "row", gap: 12, marginBottom: 12 },
  kpiCard: {
    flex: 1,
    backgroundColor: "#fff",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.borderSoft,
    padding: 14,
  },
  kpiLabel: { fontFamily: fonts.sansSemiBold, fontSize: 10, letterSpacing: 0.8, color: colors.gray },
  kpiValue: { fontFamily: fonts.mono, fontSize: 28, marginTop: 6 },
  kpiSuffix: { fontFamily: fonts.sans, fontSize: 12, color: colors.gray },
  sectionTitle: {
    fontFamily: fonts.sansSemiBold,
    fontSize: 12,
    letterSpacing: 0.8,
    textTransform: "uppercase",
    color: colors.gray,
    marginTop: 8,
    marginBottom: 8,
  },
  entityCard: {
    backgroundColor: "#fff",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.borderSoft,
    paddingVertical: 4,
    marginBottom: 10,
  },
  entityRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 14,
    paddingVertical: 10,
    gap: 10,
  },
  entityCode: { borderRadius: 6, paddingHorizontal: 7, paddingVertical: 3, minWidth: 34, alignItems: "center" },
  entityCodeText: { fontFamily: fonts.monoMedium, fontSize: 11 },
  entityName: { fontFamily: fonts.sansMedium, fontSize: 13, color: colors.darkMd, flex: 1 },
  entityBarTrack: { width: 70, height: 6, borderRadius: 3, backgroundColor: colors.grayLt, overflow: "hidden" },
  entityBarFill: { height: 6, borderRadius: 3 },
  entityScore: { fontFamily: fonts.monoMedium, fontSize: 12, color: colors.darkMd, width: 40, textAlign: "right" },
});
