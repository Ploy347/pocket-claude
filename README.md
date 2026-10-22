# Pocket Claude

Claude Code running on a Mac, driven from an Android phone through a chat that lives inside an app styled like a social network. Paired Windows computers lend their workspace (VS Code extension) or just their clipboard (PocketClipboard) to the same chat.

Everything between devices is end-to-end encrypted; the relay only sees ciphertext.

## Parts

| Path | What it is |
|---|---|
| `apps/brain` | Mac daemon: runs Claude Code (Agent SDK), owns sessions, permissions and paired devices. CLI `pocket-claude pair \| relay \| status`. Chats of invited people run in chat-only mode (no files), with `pc_*` tools for their own PocketClipboard computer: clipboard read/write and screenshots. |
| `apps/relay` | Relay: Cloudflare Worker (`worker.ts`) or Node server (`node-server.ts`) on the same core. Routing, offline queues, pairing. The Node server also serves the Mini App. |
| `apps/mobile` | Expo / React Native app (Android, iPhone) and, as a web build, the Telegram Mini App. The chat is in Direct. |
| `apps/executor-extension` | VS Code extension: executes tool calls in the open workspace, has a chat panel. |
| `apps/clipboard-agent` | `PocketClipboard.exe` for Windows: shares the clipboard with the phone and shows AI replies in a small overlay window in the corner (double-tap Alt shows it, one Alt tap or Esc hides it; dark or light). |
| `apps/telegram-bot` | Telegram bot run by the brain daemon (`pocket-claude telegram <token>`): the PC clipboard and chats with Claude from Telegram, one linked account per person; opens the Mini App. |
| `packages/protocol` | Crypto, envelopes, message schemas, pairing. |
| `packages/transport` | `DeviceLink` (authenticated, encrypted WebSocket link) and `joinAccount` (pairing). |
| `packages/client-core` | Chat state and formatting shared by the phone, the VS Code panel and the overlay. |

## Development

```sh
pnpm install
pnpm test          # vitest, all packages
pnpm typecheck     # tsc, all packages
pnpm tsx tools/scripts/dev-stack.ts   # local relay + brain + fake executor, prints a pairing link
```

The phone app: see `apps/mobile/README.md`.

## Install

- Mac: `apps/brain/install/install.sh` sets up LaunchAgents for the relay, the brain and a sleep blocker.
- Windows: `tools/scripts/make-usb.sh` builds a folder with `PocketClipboard.exe` and the VS Code extension.
- iPhone: `npx expo run:ios --device --configuration Release` in `apps/mobile` on the Mac (Xcode needed); see `apps/mobile/README.md`.

## Telegram Mini App

The same app inside Telegram, served by the Node relay on the Mac over its public HTTPS address (Tailscale Funnel):

```sh
pnpm --filter @pocket/mobile export:web      # apps/mobile/dist; the relay picks it up on restart
pocket-claude telegram app                   # or: telegram app https://host/  — the bot's menu button and /app open it
```

`/app` in the bot sends a button with a one-time pairing code, so the app pairs itself as another device of the same person. Credentials stay in the WebView's localStorage; nothing is stored with Telegram. `STATIC_DIR=` (empty) stops the relay from serving the app; `EXPO_PUBLIC_RELAY_URL` at export time points a build hosted elsewhere at the relay.

## Roadmap

See `PLAN.md` (in Russian): Windows overlay, multiple users, Telegram bot, Mini App, iPhone — all implemented, all awaiting hands-on acceptance.
