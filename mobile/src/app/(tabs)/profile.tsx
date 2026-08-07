import { View, Text, Pressable, StyleSheet, ScrollView } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import Constants from "expo-constants";
import { useAuth } from "@/lib/auth-context";
import { API_URL } from "@/lib/api";
import { colors, fonts } from "@/constants/theme";

const ROLE_LABELS: Record<string, string> = {
  CEO: "CEO",
  MANAGEMENT: "Management",
  PO: "Product Owner",
  CONTRIBUTOR: "Contributeur",
  VIEWER: "Lecture seule",
};

export default function ProfileScreen() {
  const { user, signOut } = useAuth();

  const initials = (user?.name ?? "U")
    .split(" ")
    .map((n) => n[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Profil</Text>
      </View>
      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.card}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>{initials}</Text>
          </View>
          <Text style={styles.name}>{user?.name}</Text>
          <Text style={styles.email}>{user?.email}</Text>
          <View style={styles.rolePill}>
            <Text style={styles.roleText}>{ROLE_LABELS[user?.role ?? ""] ?? user?.role}</Text>
          </View>
        </View>

        <View style={styles.infoCard}>
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>Serveur</Text>
            <Text style={styles.infoValue}>{API_URL.replace(/^https?:\/\//, "")}</Text>
          </View>
          <View style={[styles.infoRow, { borderBottomWidth: 0 }]}>
            <Text style={styles.infoLabel}>Version</Text>
            <Text style={styles.infoValue}>
              {Constants.expoConfig?.version ?? "1.0.0"}
            </Text>
          </View>
        </View>

        <Pressable
          style={({ pressed }) => [styles.signOutButton, pressed && { backgroundColor: colors.redLt }]}
          onPress={signOut}
        >
          <Text style={styles.signOutText}>Se déconnecter</Text>
        </Pressable>

        <Text style={styles.footer}>IziPilot · by IziChange S.A.{"\n"}L&apos;exécution au rythme de vos ambitions</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.dark },
  header: { backgroundColor: colors.dark, paddingHorizontal: 20, paddingVertical: 14 },
  headerTitle: { fontFamily: fonts.serif, fontSize: 22, color: "#fff" },
  scroll: { backgroundColor: colors.grayLt, padding: 16, flexGrow: 1 },
  card: {
    backgroundColor: "#fff",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.borderSoft,
    padding: 24,
    alignItems: "center",
    marginBottom: 12,
  },
  avatar: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: colors.teal,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 12,
  },
  avatarText: { fontFamily: fonts.sansSemiBold, fontSize: 22, color: "#fff" },
  name: { fontFamily: fonts.sansSemiBold, fontSize: 18, color: colors.dark },
  email: { fontFamily: fonts.sans, fontSize: 13, color: colors.gray, marginTop: 2 },
  rolePill: {
    backgroundColor: colors.tealLt,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 5,
    marginTop: 10,
  },
  roleText: { fontFamily: fonts.sansMedium, fontSize: 12, color: colors.tealDk },
  infoCard: {
    backgroundColor: "#fff",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.borderSoft,
    marginBottom: 16,
  },
  infoRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    padding: 14,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderSoft,
  },
  infoLabel: { fontFamily: fonts.sansMedium, fontSize: 13, color: colors.gray },
  infoValue: { fontFamily: fonts.mono, fontSize: 12, color: colors.darkMd },
  signOutButton: {
    borderWidth: 1,
    borderColor: "#f0b0b0",
    borderRadius: 10,
    minHeight: 50,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#fff",
  },
  signOutText: { fontFamily: fonts.sansSemiBold, fontSize: 15, color: colors.red },
  footer: {
    fontFamily: fonts.sans,
    fontSize: 11,
    color: colors.gray,
    textAlign: "center",
    marginTop: 24,
    lineHeight: 17,
  },
});
