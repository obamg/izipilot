import { createContext, useContext, useEffect, useState, useCallback } from "react";
import { Platform } from "react-native";
import * as Device from "expo-device";
import {
  login as apiLogin,
  verifyOtp as apiVerifyOtp,
  loadStoredUser,
  storeSession,
  clearSession,
  type ApiUser,
} from "./api";

type AuthStatus = "loading" | "signedOut" | "challenge" | "signedIn";

interface AuthContextValue {
  status: AuthStatus;
  user: ApiUser | null;
  /** step 1 — returns once the OTP email is sent */
  signIn: (email: string, password: string) => Promise<void>;
  /** step 2 — verifies the 6-digit code and lands the session */
  verify: (code: string) => Promise<void>;
  cancelChallenge: () => void;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>("loading");
  const [user, setUser] = useState<ApiUser | null>(null);
  const [challengeToken, setChallengeToken] = useState<string | null>(null);

  useEffect(() => {
    // Restore session from storage. The access token may be stale — the API
    // client refreshes on first 401, so a stored refresh token is enough.
    loadStoredUser().then((stored) => {
      if (stored) {
        setUser(stored);
        setStatus("signedIn");
      } else {
        setStatus("signedOut");
      }
    });
  }, []);

  const signIn = useCallback(async (email: string, password: string) => {
    const { challengeToken } = await apiLogin(email.trim().toLowerCase(), password);
    setChallengeToken(challengeToken);
    setStatus("challenge");
  }, []);

  const verify = useCallback(
    async (code: string) => {
      if (!challengeToken) throw new Error("Session de connexion expirée");
      const deviceName =
        Platform.OS === "web"
          ? "Navigateur web"
          : `${Device.deviceName ?? Device.modelName ?? Platform.OS}`;
      const result = await apiVerifyOtp(challengeToken, code, deviceName);
      await storeSession(result);
      setUser(result.user);
      setChallengeToken(null);
      setStatus("signedIn");
    },
    [challengeToken],
  );

  const cancelChallenge = useCallback(() => {
    setChallengeToken(null);
    setStatus("signedOut");
  }, []);

  const signOut = useCallback(async () => {
    await clearSession();
    setUser(null);
    setStatus("signedOut");
  }, []);

  return (
    <AuthContext.Provider value={{ status, user, signIn, verify, cancelChallenge, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
