# Pocket Claude (Android, iPhone, Telegram Mini App)

Expo SDK 58 / React Native 0.88 (Hermes, New Architecture), expo-router. State and protocol come from `@pocket/client-core`. The same code builds for Android, for iOS and for the web as the Telegram Mini App.

## Run

```sh
pnpm install                       # from the repo root
cd apps/mobile
npx expo start                     # dev server; scan with a dev build
npx expo run:android               # local dev build on a connected device/emulator (needs Android SDK)
```

`expo-camera`, `expo-secure-store` and `expo-local-authentication` need native code, so use a dev build; Expo Go is not supported for this app.

EAS alternative:

```sh
npx eas-cli build --profile development --platform android
```

## iPhone

The native projects are generated on the Mac (`ios/` is not committed); `app.json` carries the iOS settings: bundle id `dev.pocketclaude.app`, portrait, dark, Face ID / camera / photo texts, the `pocketclaude://` scheme.

Once on the Mac: install Xcode from the App Store, open it once to accept the licence, then `xcode-select --install` and `brew install cocoapods`. In Xcode → Settings → Accounts sign in with your Apple ID (a free one works). On the iPhone turn on Settings → Privacy & Security → Developer Mode.

```sh
cd apps/mobile
npx expo run:ios --device --configuration Release   # pick the iPhone; builds, signs and installs
```

The first build asks which team signs the app; with a free Apple ID that is your personal team. After the install, trust the certificate on the phone (Settings → General → VPN & Device Management) and open Pocket. `Release` bundles the JavaScript, so the app runs on its own; without `--configuration Release` you get a development build that needs `npx expo start` running on the Mac.

Free Apple ID: the signature expires after 7 days — run the command again. Apple Developer Program ($99/year): the profile lasts a year, and EAS can build in the cloud instead (`npx eas-cli login`, `npx eas-cli init`, `npx eas-cli device:create` for the iPhone's UDID, then `npx eas-cli build --profile preview --platform ios`; `--profile production` plus `npx eas-cli submit` go to TestFlight). Profiles are in `eas.json`.

Face ID asks for permission on the first unlock; keys live in the Keychain through `expo-secure-store`. Tapping a `pocketclaude://pair?…` link on the phone opens the app on the pairing screen, as on Android.

## Pairing

On the Mac run `pocket-claude pair`, then scan the QR code in the app, or paste the `pocketclaude://pair?code=…&relay=…` link. Tapping that link on the phone opens the app directly. Confirm the safety number shown by the app against the one on the Mac.

## Telegram Mini App (web build)

```sh
npx expo export --platform web     # → dist/, served by the Node relay on the Mac (see the root README)
npx expo start --web               # dev server in a browser
```

`public/index.html` loads Telegram's `telegram-web-app.js`; `src/telegram.ts` wraps what the app uses from it. Inside Telegram the app uses the client's QR scanner, haptics, popups (`src/alert.ts`), biometrics (`src/biometrics.ts`, Android/iOS only), back button and safe area; in a plain browser it falls back to the camera, browser dialogs and no lock. Opened with `?code=<pairing code>` (the bot's `/app` button) or a `startapp` link, it pairs by itself; the relay is the page's origin unless `EXPO_PUBLIC_RELAY_URL` is set at export time. Credentials live in localStorage.

## Checks

```sh
npx tsc --noEmit -p .
npx expo export --platform android
npx expo export --platform web
npx expo prebuild --platform ios --no-install --clean   # generates ios/ from app.json; works without Xcode
```
