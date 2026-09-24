# dsh-harness-jarvis · 贾维斯

桌面上的贾维斯：一颗常驻悬浮的粒子光球，替你盯住权限审批，随时唤起快速对话。

A floating desktop assistant for DSH Desktop — a particle orb that keeps an eye on permission approvals and is always one shortcut away for a quick conversation.

当前 **0.7.1** 是"助手版"：聚焦两件事——**快速权限审批**与**悬浮式快速对话**。会话托管是已经具备的进阶能力（见[功能](#功能--features-071)末尾），完整的贾维斯愿景在[路线图](#路线图--roadmap)中继续推进。

Version 0.7.1 is the *assistant* release: quick approvals and floating chat first. Session coordination is already there as an advanced capability; the full vision ships in later releases.

## 形象 / The orb

贾维斯的本体是一颗 Metal 粒子光球：六边形核心，向外两次扩散成环，粒子在环间呼吸。空闲时安静悬浮，思考、说话、等待决策、出错各有一套动效；把它拖到屏幕边缘，光球会"融"进墙里，变成一条贴边的扁条，要用时一碰又涨回球形。

The orb is a Metal particle field — a hex core that diffuses into two rings and breathes between them. Each state (idle, thinking, speaking, attention, error) has its own motion. Drag it to a screen edge and it melts flat into the wall; touch it and it blooms back.

- 交互式设计稿（克隆后本地打开即可看动效）/ Interactive design sketches, open locally after cloning:
  - [docs/design/orb-states.html](docs/design/orb-states.html) — 各状态的粒子动效与实际尺寸对比
  - [docs/design/orb-visual-direction.html](docs/design/orb-visual-direction.html) — 早期视觉方向探索
- 以下截图由仓库内 Snapshotter 用演示数据生成，不含真实会话。All screenshots use Snapshotter demo data, never real conversations.

<p>
  <img src="docs/images/01-idle.png" width="420" alt="空闲悬浮的贾维斯光球 / The orb at rest">
  <img src="docs/images/11-corner-topright-strip.png" width="360" alt="拖到屏幕角落融成扁条 / Melted flat into a screen corner">
</p>
<p>
  <img src="docs/images/05-attention.png" width="420" alt="等待决策的提醒状态 / Attention state">
  <img src="docs/images/19-approval-presets.png" width="420" alt="审批卡片与工作区预设 / Approval card with a workspace preset">
</p>

## 功能 / Features (0.7.1)

- **权限审批 / Approvals**：DSH 弹出权限请求时，悬浮窗出现审批卡片，直接**允许 / 拒绝 / 总是允许（此工作区）**；面板和 DSH 主窗口竞答，先到者生效。悬停可查看最近五条自动审批记录并撤销对应预设。分级自动审批默认**关闭**，开启后仍把高危或拿不准的请求交还给你，绝不自动拒绝。Approve or deny from the floating card — the panel races the DSH window, first answer wins. Tiered auto-approval is off by default and never auto-rejects.
- **悬浮式对话 / Floating chat**：全局快捷键 `⌃⌥J`（默认，可在面板设置中修改）随时唤出快速输入条。可以和贾维斯直接聊，也可以在目标列表选中某个会话，把话交给贾维斯改写后转发；对话记录内嵌在面板里随点随看。One shortcut summons the input bar; talk to Jarvis directly or route a message through him to a chosen session, with inline history.
- **播报与字幕 / Narration and captions**：任务完成与提问的播报带屏幕字幕；有 voice-mini 时优先协作播放（避免重复播报），没有则用内置 edge-tts。Completed tasks and questions are spoken with on-screen captions, via voice-mini when present or built-in edge-tts otherwise.
- **形象与手感 / Presence**：粒子光球 + 五种状态动效 + 贴边融变 + 悬停唤醒，不用时安静待在角落。The orb itself: five state motions, edge melting, hover wake.
- **进阶：会话协调 / Advanced: session coordination**：在面板目标列表里把工作会话"交给贾维斯"，即获得任务进度跟踪、轮末完成判断（拿不准会先问你）、结果转述与提问排队。不需要的用户可以完全忽略这一层——它不改变审批与对话的使用方式。Optional: mark worker sessions as managed to get task tracking, completion judging and relayed results. Ignorable if you only want the assistant.

## 安装 / Installation

当前提供源码安装。面板需要 macOS 14+ 与 Swift 6 工具链（Xcode 或 Command Line Tools）；宿主建议 Node.js 22.18+。Source install for now; the native panel needs macOS 14+ and Swift 6.

1. 构建仓库 / Build from the repository root:

   ```sh
   npm ci
   npm run build
   (cd macos && ./build.sh)
   ```

2. 在你使用的 DSH profile 的 `package.json` 中合并以下条目（把路径换成此仓库的绝对路径，保留原有条目）：

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

3. 在 profile 目录执行 `pnpm install` 解析 `link:` 依赖（不要在仓库里安装此链接）。插件的 `dsh.bundle.patch` 指向 [cordis.patch.yml](cordis.patch.yml)；插件会自己创建贾维斯会话，不要在 profile 里重复插入同 ID 条目。
4. 在 profile 覆盖配置或 DSH 的贾维斯设置页里，选择你已配置好的 `provider` / `model`（仓库默认 `bailian` / `qwen3.8-max-0902`，不保证与你的环境匹配）。重启 DSH 后执行 `npm run smoke` 验证。Pick a provider/model your DSH already has, restart DSH, then run the smoke check.

硬依赖服务为 `tools`、`userQuestions`、`jobs`；`agentLoop`、`llm`、`systemPrompt`、`webServer`、`settings` 等按可用性接入，缺少时插件降级运行（无 webServer 则没有面板通信入口）。Required: `tools`, `userQuestions`, `jobs`; everything else attaches opportunistically and degrades gracefully.

## 首次使用 / First use

1. 重启 DSH 后，屏幕上出现悬浮光球；按 `⌃⌥J` 唤出输入条即可开始对话。The orb appears after restart; press `⌃⌥J` to start chatting.
2. 下一次 DSH 弹权限审批时，面板会出现审批卡片——点一下即可，也可以回到 DSH 主窗口处理，两边先答先得。The next approval shows up as a card; answer in either surface.
3. 悬停光球可控制声音、查看自动审批记录；展开输入区可查看当前目标的对话记录。Hover for voice controls and approval history; expand for the conversation log.
4. （进阶）在面板目标列表把某个工作会话"交给贾维斯"，即可获得任务进度与完成播报；不需要就跳过这一步。Optionally mark a session as managed to get task tracking.

## 配置 / Configuration

下表由 `src/index.ts` 的 `Config` 与 `SettingsSchema` 生成。路径与身份经 profile 配置；设置页中的 provider/model 改动需重启 DSH，其余开关下次请求即生效。Generated from the actual schemas.

<!-- CONFIG:START -->
| 字段 / Field | 类型 / Type | 默认值 / Default | DSH 设置页 / Settings |
|---|---|---|---|
| `locale` | "zh" / "en" | `"zh"` | 否 / No |
| `audioDir` | string | `"~/.dsh/jarvis"` | 否 / No |
| `managedFile` | string | `"~/.dsh/jarvis/managed.json"` | 否 / No |
| `tasksFile` | string | `"~/.dsh/jarvis/tasks.json"` | 否 / No |
| `memoryRoot` | string | `"~/.dsh/jarvis"` | 否 / No |
| `approvalsDir` | string | `"~/.dsh/jarvis/memory/approvals"` | 否 / No |
| `lockFile` | string | `"~/.dsh/jarvis/lock.json"` | 否 / No |
| `runtimeFile` | string | `"~/.dsh/jarvis/runtime.json"` | 否 / No |
| `titlePrefix` | string | `"贾维斯-"` | 否 / No |
| `ttsBackend` | "edge" | `"edge"` | 否 / No |
| `edgeVoice` | string | `"zh-CN-YunjianNeural"` | 是 / Yes |
| `archiveIdleDays` | number | `7` | 否 / No |
| `judgeEnabled` | boolean | `true` | 是 / Yes |
| `askInterception` | boolean | `false` | 是 / Yes |
| `autoApprove` | "off" / "safe" / "safe+grey" | `"off"` | 是 / Yes |
| `managedNarration` | "self" / "relay" | `"self"` | 是 / Yes |
| `judgeProvider` | string | `""` | 是 / Yes |
| `judgeModel` | string | `""` | 是 / Yes |
| `judgeTimeoutMs` | number | `20000` | 是 / Yes |
| `maxContinueRounds` | number | `2` | 是 / Yes |
| `provider` | string | `"bailian"` | 是 / Yes |
| `model` | string | `"qwen3.8-max-0902"` | 是 / Yes |
| `jarvisSessionId` | string | `"jarvis"` | 否 / No |
| `jarvisCwd` | string | `"~/jarvis"` | 否 / No |
| `greetings` | string[] | `[]` | 是 / Yes |
<!-- CONFIG:END -->

- `judgeProvider` / `judgeModel` 留空时沿用贾维斯的模型；`autoApprove` 的保守规则见[功能](#功能--features-071)。Empty judge fields reuse Jarvis's model.
- `locale` 控制启动问候语言，不是完整的面板双语开关；面板外观与快捷键设置保存在 `~/.dsh/jarvis/panel.json`。`locale` is not a full panel translation switch.
- `memoryRoot` 下保存 `temp/`、`memory/` 与审批记录；`runtimeFile` 含面板连接凭据，不要分享。`runtimeFile` holds panel credentials — keep it private.

## 与 voice-mini 配合 / Working with voice-mini

voice-mini 可选。可用时贾维斯优先用它的播报与播放控制（含 `claimsTurnEnd` 与字幕 `text` 信号，避免托管轮末重复播报）；不可用时退回内置 edge-tts。静音会抑制播报。voice-mini is optional; Jarvis prefers it when present and falls back to built-in edge-tts.

## 隐私与权限 / Privacy and permissions

任务台账、托管集合、审批记录、记忆、日志与语音缓存默认保存在本机 `~/.dsh/jarvis`，没有云端记忆库。**本机存储不等于离线处理**：所配置的模型服务会收到相应的任务与判断上下文，内置 edge-tts 会把播报文本发给 Microsoft 语音服务。Local storage by default; but your configured model provider and the built-in edge-tts service do receive relevant text.

插件不申请 `danger-full-access`；快捷键走 Carbon RegisterEventHotKey，不需要辅助功能按键监听；当前没有麦克风录音。自动代答与自动审批默认关闭；审批记录与日志可能包含敏感操作上下文，请自行管理分享范围。No danger-full-access, no accessibility keyboard monitor, no microphone. Auto-answering and auto-approval are off by default.

## 路线图 / Roadmap

0.7.x 之后的正式版将逐步补齐"指挥官"愿景，优先级从高到低：

- 语音输入（对贾维斯说话，含唤醒词）/ Voice input and wake words
- 预编译面板随 npm 包分发，免本地 Swift 构建 / Prebuilt panel in the npm package
- 托管深化：更聪明的续做判断与任务编排 / Smarter continuation judging and task orchestration
- 自动记忆整理与长期记忆固化 / Memory consolidation
- 跨平台面板（非 macOS 桌面）/ Panels beyond macOS

## 已知限制 / Known limitations

- 原生面板仅面向 macOS 14+；语音输入与预编译分发尚未完成。macOS-only panel; dictation and prebuilt distribution pending.
- 自动审批是保守规则加可选模型判断，不是命令执行沙箱；撤销预设不影响已执行的操作。Classification is not an execution sandbox; revoking a preset does not undo past operations.
- SEC1 安全审查与 Q1 真机验收未完成，暂不声称已通过发布安全验收。Security review and manual acceptance are pending.

## 开发 / Development

```sh
npm ci
npm run build
npm test
(cd macos && swift test && ./build.sh)
npm run docs:config          # 重新生成上方配置表
npm run docs:config -- --check
npm pack --dry-run
```

构建后重启 DSH 再执行 `npm run smoke`；`--write` 会临时切换一个未托管会话并尝试恢复原状。面板改动后重建并重启；截图用演示数据从仓库根目录生成：Restart DSH after building. Screenshots regenerate from demo data:

```sh
JARVIS_SNAPSHOT=/tmp/jarvis-snapshots ./macos/jarvis-panel
```

## 许可证 / License

MIT © 2026 zane — see [LICENSE](LICENSE).
