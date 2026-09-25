# dsh-harness-jarvis · Jarvis

English | [中文](README.md)

![version](https://img.shields.io/badge/version-0.7.1-blue?style=flat-square)
![for DSH Desktop](https://img.shields.io/badge/for-DSH_Desktop-6C5CE7?style=flat-square)
![macOS](https://img.shields.io/badge/platform-macOS_14%2B-lightgrey?style=flat-square)
![License](https://img.shields.io/badge/license-MIT-green?style=flat-square)

Jarvis is a resident floating assistant for DSH Desktop — and a desktop pet with a pulse. When DSH raises a permission request, a card appears beside the orb: **Allow / Deny / Always allow (this workspace)** in one click, racing the main window, first answer wins. Anywhere else, `⌃⌥J` summons the quick input bar for a conversation with Jarvis, history inline. He greets you out loud on startup. His body is a Metal particle orb that breathes with its state — thinking, speaking, or waiting for your call each have their own motion — and dragging him to a screen edge melts him flat into the wall until a touch blooms him back.

<p align="center">
  <img src="docs/design/orb-showcase.gif" width="320" alt="The orb cycling through its states: idle, awaiting, thinking, speaking, attention">
</p>

Version **0.7.1** is the *assistant* release: the capabilities above work out of the box; the bigger vision continues on the [roadmap](#roadmap).

## What Jarvis does

- 🔔 **Approvals** — DSH raises a permission request → the floating card appears: **Allow / Deny / Always allow (this workspace)** in one click. The panel races the DSH window, and the first answer wins — no window switching needed. Answer approvals where they find you.
- ⌨️ **Floating chat** — the global shortcut `⌃⌥J` (default, remappable in panel settings) summons the quick input bar for a direct conversation with Jarvis; the history lives inline in the panel, one click away. One shortcut, with the log inline.
- 🔊 **Spoken greeting** — Jarvis says hello when he starts up; greeting text and voice are configurable, and hovering the orb mutes him. A configurable, mutable startup greeting.
- ✨ **Presence** — a Metal particle orb: five state motions, edge melting, hover wake, and the quiet patience of a desktop pet in the corner of your screen. Part status light, part companion.

The loop below is one full interaction: summon the quick bar, type and send, watch Jarvis think and speak, then allow an approval with one click.

<p align="center">
  <img src="docs/design/panel-tour.gif" width="520" alt="A full interaction: quick bar opens, typing, send, think, speak, one-click approval">
</p>

## The orb & design sketches

Jarvis's body is a Metal particle field: a hexagonal core diffusing outward into two rings, with particles breathing between them. Idle, it floats quietly; thinking, speaking, attention, and failure each have their own motion. Drag it to a screen edge and the orb melts flat into the wall as a thin strip; touch it and it blooms back into a sphere.

- Interactive design sketches (clone the repo and open locally):
  - [docs/design/orb-states.html](docs/design/orb-states.html) — the particle motion of every state at actual sizes
  - [docs/design/orb-visual-direction.html](docs/design/orb-visual-direction.html) — early visual-direction exploration
- Animations are rendered from the same particle simulation, and screenshots come from the Snapshotter — all demo data, never real conversations.

<p align="center">
  <img src="docs/design/orb-idle.gif" height="260" alt="The idle loop">
  <img src="docs/design/orb-attention.gif" height="260" alt="The attention heartbeat">
</p>
<p align="center"><em>At rest · the double-beat attention heartbeat when a decision is waiting</em></p>
<p align="center">
  <img src="docs/design/orb-edge-melt.gif" height="300" alt="The edge-melt loop: melting into an L-shaped strip, then blooming back">
  <img src="docs/images/19-approval-presets.png" height="300" alt="Approval card with a workspace preset">
</p>
<p align="center"><em>Edge melting · the approval card</em></p>

## Installation

Source install for now; the native panel needs macOS 14+ and the Swift 6 toolchain (Xcode or Command Line Tools), and the host recommends Node.js 22.18+.

1. Build from the repository root:

   ```sh
   npm ci
   npm run build
   (cd macos && ./build.sh)
   ```

2. Merge the following entries into the `package.json` of your active DSH profile (replace the path with the absolute path of this repository and keep your existing entries):

   ```json
   {
     "dependencies": {
       "dsh-harness-jarvis": "link:/absolute/path/to/dsh-harness-jarvis"
     },
     "dsh": {
       "profile": { "bundles": ["dsh-harness-jarvis"] }
     }
   }
   ```

3. Run `pnpm install` in the profile directory to resolve the `link:` dependency (do not install the link inside this repository). The plugin's `dsh.bundle.patch` points at [cordis.patch.yml](cordis.patch.yml); the plugin creates its own Jarvis session — do not insert a duplicate plugin row in the profile.
4. In a profile override or DSH's Jarvis settings page, set a `provider` / `model` — or **leave them empty**: the plugin then auto-picks the first available provider and that provider's first model (effective after a DSH restart; verify with `npm run smoke`).

Hard-required services are `tools`, `userQuestions`, and `jobs`; `agentLoop`, `llm`, `systemPrompt`, `webServer`, and `settings` attach opportunistically, and the plugin degrades gracefully when they are missing (no webServer means no panel communication).

## First use

1. After restarting DSH, the floating orb appears on screen; press `⌃⌥J` to summon the input bar and start chatting.
2. The next time DSH raises an approval, the panel shows the card — click once, or answer from the DSH main window; whichever answers first wins.
3. Hover the orb for voice controls; expand the input area for the conversation log.

## Configuration

The table below is the public, user-facing surface, generated from the schema in `src/index.ts`; other internal fields are not part of the supported surface. Paths and identity are configured via the profile; provider/model changes in the settings page require a DSH restart, and the remaining switches apply on the next request.

<!-- CONFIG:START -->
| 字段 / Field | 类型 / Type | 默认值 / Default | DSH 设置页 / Settings |
|---|---|---|---|
| `locale` | "zh" / "en" | `"zh"` | 否 / No |
| `audioDir` | string | `"~/.dsh/jarvis"` | 否 / No |
| `ttsBackend` | "edge" | `"edge"` | 否 / No |
| `edgeVoice` | string | `"zh-CN-YunjianNeural"` | 是 / Yes |
| `provider` | string | `""` | 是 / Yes |
| `model` | string | `""` | 是 / Yes |
| `greetings` | string[] | `[]` | 是 / Yes |
<!-- CONFIG:END -->

`locale` controls the greeting language, not a full panel translation; panel appearance and shortcut settings live in `~/.dsh/jarvis/panel.json`, and the connection credentials are written only to that local directory — keep it private.

## Working with voice-mini

voice-mini is optional. When present, Jarvis prefers its narration and playback controls; without it, he falls back to the built-in edge-tts. Muting suppresses speech.

## Privacy and permissions

Approval records, logs, and the voice cache are stored locally under `~/.dsh/jarvis` by default — no cloud storage. **Local storage is not offline processing**: your configured model provider receives the relevant conversation context, and the built-in edge-tts sends spoken text to Microsoft's speech service.

The plugin does not request `danger-full-access`; the shortcut uses Carbon RegisterEventHotKey and needs no accessibility keyboard monitoring; there is no microphone capture today. Approval records and logs may contain sensitive operation context — manage what you share.

## Roadmap

After 0.7.x, the full Jarvis vision lands step by step (details published as they ship):

- Voice input — talking to Jarvis, including wake words
- A prebuilt panel shipped in the npm package, no local Swift build
- Commander capabilities: session coordination, tiered approvals, long-term memory
- Panels beyond macOS

## Known limitations

- The native panel targets macOS 14+ only; dictation and prebuilt distribution are pending.
- The security review and manual acceptance pass are not complete; we do not claim release-security sign-off yet.

## Development

```sh
npm ci
npm run build
npm test
(cd macos && swift test && ./build.sh)
npm run docs:config          # regenerate the configuration tables above
npm run docs:config -- --check
npm pack --dry-run
```

Restart DSH after building, then run `npm run smoke`. Rebuild and restart after panel changes; screenshots regenerate from demo data:

```sh
JARVIS_SNAPSHOT=/tmp/jarvis-snapshots ./macos/jarvis-panel
```

## License

MIT © 2026 zane — see [LICENSE](LICENSE).
