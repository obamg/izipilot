import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import {
  View,
  Text,
  ScrollView,
  TextInput,
  Pressable,
  StyleSheet,
  RefreshControl,
  ActivityIndicator,
  Alert as RNAlert,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { ProgressSlider } from "@/components/ProgressSlider";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useBootstrap } from "@/lib/bootstrap-context";
import { submitWeeklyBatch, ApiError, type BootstrapKr } from "@/lib/api";
import { colors, fonts, statusColor, STATUS_LABELS } from "@/constants/theme";
import { ScoreDonut } from "@/components/ScoreDonut";
import { StatusBadge } from "@/components/StatusBadge";

interface EntryState {
  progress: number;
  status: string;
  blocker: string;
  proposedSolution: string;
  actionNeeded: string;
  comment: string;
}

const STATUS_OPTIONS = ["ON_TRACK", "AT_RISK", "BLOCKED", "NOT_STARTED"] as const;

function initialEntries(krs: BootstrapKr[]): Record<string, EntryState> {
  const out: Record<string, EntryState> = {};
  for (const kr of krs) {
    out[kr.id] = {
      progress: kr.existingProgress ?? kr.score,
      status: kr.existingStatus ?? kr.status,
      blocker: kr.existingBlocker ?? "",
      proposedSolution: kr.existingProposedSolution ?? "",
      actionNeeded: kr.existingActionNeeded ?? "",
      comment: kr.existingComment ?? "",
    };
  }
  return out;
}

export default function WeeklyScreen() {
  const { data, loading, refresh } = useBootstrap();
  const [entries, setEntries] = useState<Record<string, EntryState> | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [draftRestored, setDraftRestored] = useState(false);

  const weekly = data?.weekly;
  const weekNumber = data?.week.weekNumber;
  const year = data?.week.year;
  const draftKey = `izipilot-draft-S${weekNumber}-${year}`;

  // Initialise from server data + local draft once bootstrap lands.
  useEffect(() => {
    if (!weekly || entries) return;
    (async () => {
      const base = initialEntries(weekly.krData);
      try {
        const raw = await AsyncStorage.getItem(draftKey);
        if (raw) {
          const draft = JSON.parse(raw) as Record<string, EntryState>;
          let used = false;
          for (const kr of weekly.krData) {
            if (!kr.isSubmitted && draft[kr.id]) {
              base[kr.id] = { ...base[kr.id], ...draft[kr.id] };
              used = true;
            }
          }
          if (used) {
            setDraftRestored(true);
            setTimeout(() => setDraftRestored(false), 3000);
          }
        }
      } catch {}
      setEntries(base);
    })();
  }, [weekly, entries, draftKey]);

  // Debounced draft autosave.
  const saveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const persistDraft = useCallback(
    (next: Record<string, EntryState>) => {
      clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => {
        AsyncStorage.setItem(draftKey, JSON.stringify(next)).catch(() => {});
      }, 500);
    },
    [draftKey],
  );

  const update = useCallback(
    (krId: string, field: keyof EntryState, value: string | number) => {
      setEntries((prev) => {
        if (!prev) return prev;
        const next = { ...prev, [krId]: { ...prev[krId], [field]: value } };
        persistDraft(next);
        return next;
      });
    },
    [persistDraft],
  );

  const grouped = useMemo(() => {
    if (!weekly) return [];
    const byEntity = new Map<string, { entityName: string; entityColor: string; objectives: Map<string, BootstrapKr[]> }>();
    for (const kr of weekly.krData) {
      if (!byEntity.has(kr.entityCode)) {
        byEntity.set(kr.entityCode, { entityName: kr.entityName, entityColor: kr.entityColor, objectives: new Map() });
      }
      const e = byEntity.get(kr.entityCode)!;
      if (!e.objectives.has(kr.objectiveTitle)) e.objectives.set(kr.objectiveTitle, []);
      e.objectives.get(kr.objectiveTitle)!.push(kr);
    }
    return Array.from(byEntity.entries());
  }, [weekly]);

  async function handleSubmit() {
    if (!weekly || !entries || !weekNumber || !year || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      await submitWeeklyBatch(
        weekly.krData.map((kr) => ({
          krId: kr.id,
          weekNumber,
          year,
          progress: entries[kr.id].progress / 100,
          status: entries[kr.id].status,
          blocker: entries[kr.id].blocker || null,
          proposedSolution: entries[kr.id].proposedSolution || null,
          actionNeeded: entries[kr.id].actionNeeded || null,
          comment: entries[kr.id].comment || null,
        })),
      );
      await AsyncStorage.removeItem(draftKey).catch(() => {});
      setSubmitted(true);
      await refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Envoi impossible. Votre brouillon est conservé sur cet appareil.");
    } finally {
      setSubmitting(false);
    }
  }

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await refresh();
    setEntries(null); // re-init from fresh server state (+ draft)
    setSubmitted(false);
    setRefreshing(false);
  }, [refresh]);

  if (loading && !data) {
    return (
      <SafeAreaView style={styles.root} edges={["top"]}>
        <View style={styles.center}>
          <ActivityIndicator color={colors.teal} />
        </View>
      </SafeAreaView>
    );
  }

  // Post-submit recap
  if (submitted && weekly && entries) {
    return (
      <SafeAreaView style={styles.root} edges={["top"]}>
        <View style={styles.header}>
          <Text style={styles.headerTitle}>Revue soumise ✓</Text>
        </View>
        <ScrollView contentContainerStyle={styles.scroll}>
          <View style={styles.successCard}>
            <Text style={styles.successTitle}>
              S{String(weekNumber).padStart(2, "0")} · {year} enregistrée
            </Text>
            <Text style={styles.successSub}>
              {weekly.krData.length} Key Result{weekly.krData.length > 1 ? "s" : ""} soumis.
            </Text>
          </View>
          {weekly.krData.map((kr) => (
            <View key={kr.id} style={styles.recapRow}>
              <ScoreDonut score={entries[kr.id].progress} size={40} status={entries[kr.id].status} />
              <View style={{ flex: 1, marginHorizontal: 10 }}>
                <Text style={styles.krTitle} numberOfLines={2}>{kr.title}</Text>
                <Text style={styles.krMeta} numberOfLines={1}>{kr.objectiveTitle}</Text>
              </View>
              <StatusBadge status={entries[kr.id].status} />
            </View>
          ))}
          <Pressable style={styles.secondaryButton} onPress={() => setSubmitted(false)}>
            <Text style={styles.secondaryButtonText}>Modifier ma saisie</Text>
          </Pressable>
        </ScrollView>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>
          Ma revue — S{weekNumber ? String(weekNumber).padStart(2, "0") : "…"}
        </Text>
        {weekly?.isReadOnly && <Text style={styles.readOnlyPill}>Lecture seule</Text>}
      </View>
      <ScrollView
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.teal} />}
      >
        {draftRestored && (
          <View style={styles.draftBanner}>
            <Text style={styles.draftBannerText}>Brouillon restauré depuis cet appareil.</Text>
          </View>
        )}

        {weekly && weekly.krData.length === 0 && (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyText}>Aucun Key Result ne vous est assigné.</Text>
          </View>
        )}

        {weekly && entries &&
          grouped.map(([entityCode, group]) => (
            <View key={entityCode} style={{ marginBottom: 16 }}>
              <View style={styles.entityHeader}>
                <View style={[styles.entityDot, { backgroundColor: group.entityColor }]} />
                <Text style={styles.entityTitle}>
                  {entityCode} {group.entityName}
                </Text>
              </View>
              {Array.from(group.objectives.entries()).map(([objective, krs]) => (
                <View key={objective} style={styles.objectiveCard}>
                  <View style={styles.objectiveHeader}>
                    <Text style={styles.objectiveLabel}>OBJECTIF</Text>
                    <Text style={styles.objectiveTitle}>{objective}</Text>
                  </View>
                  {krs.map((kr) => {
                    const entry = entries[kr.id];
                    const color = statusColor(entry.status, entry.progress);
                    return (
                      <View key={kr.id} style={styles.krBlock}>
                        <View style={styles.krHead}>
                          <ScoreDonut score={entry.progress} size={44} status={entry.status} />
                          <View style={{ flex: 1, marginLeft: 10 }}>
                            <Text style={styles.krTitle}>{kr.title}</Text>
                            <Text style={styles.krMeta}>
                              {kr.krType === "DATE"
                                ? "Avancement manuel — jalon"
                                : kr.krType === "BINARY"
                                  ? "Atteinte binaire"
                                  : `${kr.currentValue} / ${kr.target ?? "N/A"} ${kr.targetUnit ?? ""}`}
                            </Text>
                          </View>
                        </View>

                        {kr.submittedByOther && (
                          <Text style={styles.submittedByOther}>
                            Saisi cette semaine par {kr.submittedByOther}
                          </Text>
                        )}

                        {/* Progress */}
                        {kr.krType === "BINARY" ? (
                          <View style={styles.binaryRow}>
                            {[{ v: 0, label: "Non" }, { v: 100, label: "Oui" }].map((opt) => {
                              const selected = entry.progress >= 50 ? opt.v === 100 : opt.v === 0;
                              return (
                                <Pressable
                                  key={opt.v}
                                  disabled={weekly.isReadOnly}
                                  onPress={() => update(kr.id, "progress", opt.v)}
                                  style={[styles.binaryButton, selected && styles.binaryButtonActive]}
                                >
                                  <Text style={[styles.binaryButtonText, selected && styles.binaryButtonTextActive]}>
                                    {opt.label}
                                  </Text>
                                </Pressable>
                              );
                            })}
                          </View>
                        ) : (
                          <View style={styles.sliderRow}>
                            <ProgressSlider
                              value={entry.progress}
                              disabled={weekly.isReadOnly}
                              color={color}
                              onChange={(v) => update(kr.id, "progress", v)}
                              testID={`slider-${kr.id}`}
                            />
                            <Text style={[styles.sliderValue, { color }]}>{entry.progress}%</Text>
                          </View>
                        )}

                        {/* Status segmented */}
                        <View style={styles.statusRow}>
                          {STATUS_OPTIONS.map((s) => {
                            const selected = entry.status === s;
                            const sColor = statusColor(s);
                            return (
                              <Pressable
                                key={s}
                                disabled={weekly.isReadOnly}
                                onPress={() => update(kr.id, "status", s)}
                                style={[
                                  styles.statusButton,
                                  selected && { backgroundColor: `${sColor}18`, borderColor: sColor },
                                ]}
                              >
                                <Text
                                  style={[
                                    styles.statusButtonText,
                                    selected && { color: sColor, fontFamily: fonts.sansSemiBold },
                                  ]}
                                  numberOfLines={1}
                                >
                                  {STATUS_LABELS[s]}
                                </Text>
                              </Pressable>
                            );
                          })}
                        </View>

                        {/* Conditional fields */}
                        {(entry.status === "BLOCKED" || entry.blocker.length > 0) && (
                          <>
                            <Text style={styles.fieldLabel}>BLOCAGE IDENTIFIÉ</Text>
                            <TextInput
                              style={[styles.textArea, { borderColor: "#f0b0b0", backgroundColor: colors.redLt }]}
                              value={entry.blocker}
                              onChangeText={(v) => update(kr.id, "blocker", v)}
                              editable={!weekly.isReadOnly}
                              multiline
                              placeholder="Décrivez le blocage..."
                              placeholderTextColor={colors.gray}
                            />
                          </>
                        )}
                        {(entry.status === "AT_RISK" || entry.proposedSolution.length > 0) && (
                          <>
                            <Text style={styles.fieldLabel}>APPROCHE DE SOLUTION</Text>
                            <TextInput
                              style={[styles.textArea, { borderColor: "#e6d28a", backgroundColor: colors.goldLt }]}
                              value={entry.proposedSolution}
                              onChangeText={(v) => update(kr.id, "proposedSolution", v)}
                              editable={!weekly.isReadOnly}
                              multiline
                              placeholder="Votre approche pour résoudre ce point..."
                              placeholderTextColor={colors.gray}
                            />
                          </>
                        )}
                        {(entry.status === "BLOCKED" || entry.status === "AT_RISK" || entry.actionNeeded.length > 0) && (
                          <>
                            <Text style={styles.fieldLabel}>BESOIN MANAGEMENT</Text>
                            <TextInput
                              style={styles.textArea}
                              value={entry.actionNeeded}
                              onChangeText={(v) => update(kr.id, "actionNeeded", v)}
                              editable={!weekly.isReadOnly}
                              multiline
                              placeholder="De quoi avez-vous besoin ?"
                              placeholderTextColor={colors.gray}
                            />
                          </>
                        )}
                        <Text style={styles.fieldLabel}>COMMENTAIRE</Text>
                        <TextInput
                          style={styles.textArea}
                          value={entry.comment}
                          onChangeText={(v) => update(kr.id, "comment", v)}
                          editable={!weekly.isReadOnly}
                          multiline
                          placeholder="Commentaire libre..."
                          placeholderTextColor={colors.gray}
                          testID={`comment-${kr.id}`}
                        />
                      </View>
                    );
                  })}
                </View>
              ))}
            </View>
          ))}

        {error && (
          <View style={styles.errorBox}>
            <Text style={styles.errorText}>{error}</Text>
          </View>
        )}
      </ScrollView>

      {/* Sticky submit */}
      {weekly && !weekly.isReadOnly && weekly.krData.length > 0 && (
        <View style={styles.submitBar}>
          <Pressable
            style={({ pressed }) => [styles.submitButton, pressed && { backgroundColor: colors.tealDk }, submitting && { opacity: 0.6 }]}
            onPress={handleSubmit}
            disabled={submitting}
            testID="weekly-submit"
          >
            {submitting ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.submitButtonText}>Soumettre la revue →</Text>
            )}
          </Pressable>
        </View>
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
  readOnlyPill: {
    fontFamily: fonts.sansMedium,
    fontSize: 11,
    color: colors.gold,
    backgroundColor: "rgba(244,169,0,0.15)",
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    overflow: "hidden",
  },
  scroll: { backgroundColor: colors.grayLt, padding: 14, paddingBottom: 24, flexGrow: 1 },
  draftBanner: {
    backgroundColor: colors.tealLt,
    borderWidth: 1,
    borderColor: colors.tealMd,
    borderRadius: 8,
    padding: 10,
    marginBottom: 10,
  },
  draftBannerText: { fontFamily: fonts.sans, fontSize: 12, color: colors.dark },
  emptyCard: { backgroundColor: "#fff", borderRadius: 12, padding: 24, alignItems: "center" },
  emptyText: { fontFamily: fonts.sans, fontSize: 14, color: colors.gray },
  entityHeader: { flexDirection: "row", alignItems: "center", marginBottom: 8, gap: 8 },
  entityDot: { width: 10, height: 10, borderRadius: 5 },
  entityTitle: { fontFamily: fonts.sansSemiBold, fontSize: 13, color: colors.darkMd },
  objectiveCard: {
    backgroundColor: "#fff",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.tealMd,
    overflow: "hidden",
    marginBottom: 12,
  },
  objectiveHeader: { backgroundColor: colors.tealLt, padding: 12, borderBottomWidth: 1, borderBottomColor: colors.tealMd },
  objectiveLabel: { fontFamily: fonts.sansSemiBold, fontSize: 9, letterSpacing: 1, color: colors.tealDk },
  objectiveTitle: { fontFamily: fonts.serif, fontSize: 16, color: colors.dark, marginTop: 2 },
  krBlock: { padding: 14, borderBottomWidth: 1, borderBottomColor: colors.borderSoft },
  krHead: { flexDirection: "row", alignItems: "center", marginBottom: 10 },
  krTitle: { fontFamily: fonts.sansSemiBold, fontSize: 14, color: colors.dark, lineHeight: 19 },
  krMeta: { fontFamily: fonts.mono, fontSize: 10, color: colors.gray, marginTop: 2 },
  submittedByOther: {
    fontFamily: fonts.sans,
    fontSize: 11,
    color: colors.darkMd,
    backgroundColor: colors.goldLt,
    borderRadius: 6,
    padding: 8,
    marginBottom: 8,
  },
  binaryRow: { flexDirection: "row", gap: 10, marginBottom: 10 },
  binaryButton: {
    flex: 1,
    minHeight: 44,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.tealMd,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#fff",
  },
  binaryButtonActive: { backgroundColor: colors.teal, borderColor: colors.teal },
  binaryButtonText: { fontFamily: fonts.sansMedium, fontSize: 14, color: colors.dark },
  binaryButtonTextActive: { color: "#fff" },
  sliderRow: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 6 },
  sliderValue: { fontFamily: fonts.monoMedium, fontSize: 14, width: 44, textAlign: "right" },
  statusRow: { flexDirection: "row", gap: 6, marginBottom: 4, flexWrap: "wrap" },
  statusButton: {
    flexGrow: 1,
    flexBasis: "22%",
    minHeight: 40,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.borderSoft,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 4,
    backgroundColor: "#fff",
  },
  statusButtonText: { fontFamily: fonts.sans, fontSize: 11, color: colors.gray },
  fieldLabel: {
    fontFamily: fonts.sansSemiBold,
    fontSize: 9,
    letterSpacing: 0.8,
    color: colors.gray,
    marginTop: 10,
    marginBottom: 4,
  },
  textArea: {
    fontFamily: fonts.sans,
    fontSize: 14,
    color: colors.darkMd,
    borderWidth: 1,
    borderColor: colors.tealMd,
    borderRadius: 8,
    padding: 10,
    minHeight: 52,
    textAlignVertical: "top",
    backgroundColor: "#fff",
  },
  errorBox: { backgroundColor: colors.redLt, borderRadius: 10, padding: 12, marginTop: 4 },
  errorText: { fontFamily: fonts.sansMedium, fontSize: 13, color: colors.red },
  submitBar: {
    backgroundColor: "rgba(255,255,255,0.96)",
    borderTopWidth: 1,
    borderTopColor: colors.borderSoft,
    padding: 12,
  },
  submitButton: {
    backgroundColor: colors.teal,
    borderRadius: 10,
    minHeight: 50,
    alignItems: "center",
    justifyContent: "center",
  },
  submitButtonText: { fontFamily: fonts.sansSemiBold, fontSize: 15, color: "#fff" },
  successCard: {
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: colors.tealMd,
    borderRadius: 12,
    padding: 18,
    marginBottom: 12,
  },
  successTitle: { fontFamily: fonts.serif, fontSize: 18, color: colors.dark },
  successSub: { fontFamily: fonts.sans, fontSize: 13, color: colors.gray, marginTop: 4 },
  recapRow: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#fff",
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.borderSoft,
    padding: 12,
    marginBottom: 8,
  },
  secondaryButton: {
    borderWidth: 1,
    borderColor: colors.tealMd,
    borderRadius: 10,
    minHeight: 48,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 8,
  },
  secondaryButtonText: { fontFamily: fonts.sansMedium, fontSize: 14, color: colors.teal },
});
