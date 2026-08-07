# IziPilot Mobile

App native iOS/Android (Expo SDK 57 + expo-router) pour le pilotage OKR d'IziChange.
L'exécution au rythme de vos ambitions — depuis votre poche.

## Écrans v1

- **Connexion** : email + mot de passe, puis code 2FA reçu par email
- **Dashboard** : score global, KPIs par statut, scores produits & départements
- **Ma revue** : saisie hebdo (sliders, statuts, blocages, besoin Management), brouillon local, récap post-soumission
- **Alertes** : alertes actives avec sévérité
- **Profil** : compte, serveur, déconnexion

Sprints, évaluations, CRM et admin restent sur le web (izipilote.com).

## Backend

L'app parle à l'API IziPilot via tokens Bearer :

- `POST /api/mobile/login` → challenge OTP
- `POST /api/mobile/verify` → access token (1h) + refresh token (90j, rotation)
- `POST /api/mobile/refresh` → rotation
- `GET /api/mobile/bootstrap` → payload complet (dashboard + revue hebdo)
- Routes existantes (`/api/alerts`, `/api/weekly-entries/batch`, …) acceptent
  `Authorization: Bearer` via `lib/api-auth.ts`

Les tokens sont stockés dans le Keychain/Keystore (`expo-secure-store`).

## Développement

```bash
cd mobile
npm install

# Sur téléphone via Expo Go (même Wi-Fi) — pointe sur staging par défaut :
EXPO_PUBLIC_API_URL=https://staging.izipilote.com npx expo start
# scanner le QR code avec l'app Expo Go (iOS/Android)

# Contre un backend local :
EXPO_PUBLIC_API_URL=http://<IP-LAN-du-mac>:3005 npx expo start
```

Sans `EXPO_PUBLIC_API_URL`, l'app pointe sur `https://izipilote.com` (production).

## Distribution (TestFlight + Play interne)

Prérequis (une fois) : compte [Apple Developer](https://developer.apple.com) (99$/an),
compte [Google Play Console](https://play.google.com/console) (25$ une fois),
compte [Expo/EAS](https://expo.dev) gratuit.

```bash
npm install -g eas-cli
eas login
eas build --platform ios --profile production     # build signé iOS
eas submit --platform ios                          # → TestFlight
eas build --platform android --profile production  # build .aab signé
eas submit --platform android                      # → Play Console (piste interne)
```

Le profil `preview` construit contre staging pour les tests internes.
