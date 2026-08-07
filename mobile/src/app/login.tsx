import { useState } from "react";
import {
  View,
  Text,
  TextInput,
  Pressable,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  ActivityIndicator,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import Svg, { Circle, Path } from "react-native-svg";
import { useAuth } from "@/lib/auth-context";
import { ApiError } from "@/lib/api";
import { colors, fonts } from "@/constants/theme";

function Logo({ size = 56 }: { size?: number }) {
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size * 0.25,
        backgroundColor: colors.teal,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <Svg viewBox="0 0 28 28" width={size * 0.55} height={size * 0.55} fill="none">
        <Circle cx="14" cy="14" r="10" stroke="#fff" strokeWidth={2} />
        <Path d="M14 8L14 14L18 17" stroke="#fff" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" />
        <Circle cx="14" cy="14" r="2.5" fill="#fff" />
      </Svg>
    </View>
  );
}

export default function LoginScreen() {
  const { status, signIn, verify, cancelChallenge } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isChallenge = status === "challenge";

  async function handleLogin() {
    if (!email || !password || busy) return;
    setBusy(true);
    setError(null);
    try {
      await signIn(email, password);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Connexion impossible. Vérifiez votre réseau.");
    } finally {
      setBusy(false);
    }
  }

  async function handleVerify() {
    if (code.length !== 6 || busy) return;
    setBusy(true);
    setError(null);
    try {
      await verify(code);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Vérification impossible. Réessayez.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <SafeAreaView style={styles.root}>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        style={{ flex: 1 }}
      >
        <ScrollView
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
        >
          <View style={styles.header}>
            <Logo />
            <Text style={styles.brand}>
              <Text style={{ fontFamily: fonts.sansLight }}>Izi</Text>
              <Text style={{ fontFamily: fonts.serif }}>Pilot</Text>
            </Text>
            <Text style={styles.tagline}>L&apos;exécution au rythme de vos ambitions</Text>
          </View>

          <View style={styles.card}>
            {!isChallenge ? (
              <>
                <Text style={styles.label}>Email</Text>
                <TextInput
                  style={styles.input}
                  value={email}
                  onChangeText={setEmail}
                  placeholder="vous@izichange.com"
                  placeholderTextColor={colors.gray}
                  autoCapitalize="none"
                  autoComplete="email"
                  keyboardType="email-address"
                  testID="login-email"
                />
                <Text style={styles.label}>Mot de passe</Text>
                <TextInput
                  style={styles.input}
                  value={password}
                  onChangeText={setPassword}
                  placeholder="••••••••"
                  placeholderTextColor={colors.gray}
                  secureTextEntry
                  autoComplete="password"
                  testID="login-password"
                  onSubmitEditing={handleLogin}
                />
                {error && <Text style={styles.error}>{error}</Text>}
                <Pressable
                  style={({ pressed }) => [styles.button, pressed && styles.buttonPressed, busy && styles.buttonDisabled]}
                  onPress={handleLogin}
                  disabled={busy}
                  testID="login-submit"
                >
                  {busy ? (
                    <ActivityIndicator color="#fff" />
                  ) : (
                    <Text style={styles.buttonText}>Se connecter</Text>
                  )}
                </Pressable>
              </>
            ) : (
              <>
                <Text style={styles.cardTitle}>Code de vérification</Text>
                <Text style={styles.hint}>
                  Un code à 6 chiffres a été envoyé à {email.trim()}. Il expire dans 10 minutes.
                </Text>
                <TextInput
                  style={[styles.input, styles.codeInput]}
                  value={code}
                  onChangeText={(v) => setCode(v.replace(/\D/g, "").slice(0, 6))}
                  placeholder="000000"
                  placeholderTextColor={colors.tealMd}
                  keyboardType="number-pad"
                  maxLength={6}
                  autoFocus
                  testID="login-code"
                />
                {error && <Text style={styles.error}>{error}</Text>}
                <Pressable
                  style={({ pressed }) => [styles.button, pressed && styles.buttonPressed, (busy || code.length !== 6) && styles.buttonDisabled]}
                  onPress={handleVerify}
                  disabled={busy || code.length !== 6}
                  testID="login-verify"
                >
                  {busy ? (
                    <ActivityIndicator color="#fff" />
                  ) : (
                    <Text style={styles.buttonText}>Vérifier le code</Text>
                  )}
                </Pressable>
                <Pressable onPress={() => { setCode(""); setError(null); cancelChallenge(); }} style={styles.linkButton}>
                  <Text style={styles.link}>Recommencer</Text>
                </Pressable>
              </>
            )}
          </View>

          <Text style={styles.footer}>IziPilot · by IziChange S.A.</Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.dark },
  scroll: { flexGrow: 1, justifyContent: "center", padding: 24 },
  header: { alignItems: "center", marginBottom: 28 },
  brand: { fontSize: 30, color: "#fff", marginTop: 14 },
  tagline: {
    fontFamily: fonts.serif,
    fontStyle: "italic",
    fontSize: 14,
    color: colors.tealOnDark,
    marginTop: 6,
  },
  card: {
    backgroundColor: "#fff",
    borderRadius: 16,
    padding: 22,
  },
  cardTitle: { fontFamily: fonts.sansSemiBold, fontSize: 18, color: colors.dark, marginBottom: 6 },
  hint: { fontFamily: fonts.sans, fontSize: 13, color: colors.gray, lineHeight: 19, marginBottom: 14 },
  label: {
    fontFamily: fonts.sansSemiBold,
    fontSize: 11,
    letterSpacing: 0.7,
    textTransform: "uppercase",
    color: colors.gray,
    marginBottom: 6,
    marginTop: 10,
  },
  input: {
    fontFamily: fonts.sans,
    fontSize: 15,
    color: colors.darkMd,
    borderWidth: 1,
    borderColor: colors.tealMd,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    minHeight: 48,
    backgroundColor: "#fff",
  },
  codeInput: {
    fontFamily: fonts.mono,
    fontSize: 26,
    letterSpacing: 12,
    textAlign: "center",
  },
  button: {
    backgroundColor: colors.teal,
    borderRadius: 10,
    minHeight: 50,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 18,
  },
  buttonPressed: { backgroundColor: colors.tealDk },
  buttonDisabled: { opacity: 0.55 },
  buttonText: { fontFamily: fonts.sansSemiBold, fontSize: 15, color: "#fff" },
  linkButton: { alignItems: "center", marginTop: 14, minHeight: 44, justifyContent: "center" },
  link: { fontFamily: fonts.sansMedium, fontSize: 14, color: colors.teal },
  error: {
    fontFamily: fonts.sans,
    fontSize: 13,
    color: colors.red,
    backgroundColor: colors.redLt,
    borderRadius: 8,
    padding: 10,
    marginTop: 12,
  },
  footer: {
    fontFamily: fonts.sans,
    fontSize: 11,
    color: "rgba(255,255,255,0.4)",
    textAlign: "center",
    marginTop: 22,
  },
});
