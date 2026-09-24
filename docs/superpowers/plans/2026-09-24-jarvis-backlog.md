# 贾维斯待办清单（Backlog）

> 维护人：主会话（负责保持本文件完整、准确）。实现由其他会话认领完成。
> 基线提交：`feb29ab`（托管集合、转发唤醒、say/ask 工具、按目标切换对话记录）。
> 设计依据：`SPEC.md`（下文写作 §N）、`docs/superpowers/specs/2026-09-23-jarvis-ui-design.md`（UI 规格）。
> 派发用 prompt：`docs/superpowers/plans/2026-09-24-jarvis-dispatch-prompts.md`（每个条目一段，按阶段排序）。

## 0. 使用方法（实现会话必读）

1. **认领**：从「1. 总览」挑一个状态为「待办」且前置已完成的条目，把状态改为「进行中（会话名/日期）」。
2. **实现**：照条目里的「实现逻辑」「验收标准」「测试」做。条目写的是推荐方案；遇到条目没覆盖的情况，按「2. 通用约定」处理，并在该条目的「实现记录」里写清你做了什么决定。
3. **完成**：测试全绿、构建通过后提交，把状态改为「已完成（提交号）」，在「实现记录」写一两句要点（改了哪些文件、偏离条目的地方、新的测试数字）。然后快进合回 `main`；合不进去（有冲突或 `main` 已前进导致测试失败）就先 rebase 到最新 `main` 重新跑测试，仍有问题就停下来问用户。
4. **汇报**：用中文告诉用户做了什么、是否需要重启 DSH 或面板、需要用户手动验收哪些点。
5. **别改别人的条目**。发现条目写错或缺信息，在条目末尾「实现记录」里留言，由维护人修订正文。
6. 标了「⚠ 待用户拍板」的决策，按「推荐默认」实现即可；若用户已拍板，以「12. 决策记录」为准。

## 1. 总览（按阶段）

同一阶段内按表格顺序派发；标了「可并行」的可以同时交给不同会话。前一阶段不必全部完成才开始下一阶段，只要前置条目已在 `main` 上。

### 阶段 1：会话闭环（已完成）

| 编号 | 条目 | 前置 | 规模 | 状态 |
|---|---|---|---|---|
| J1 | 任务台账：记录"交给哪个会话做什么" | — | 小 | 已完成（`j1-task-ledger-20260924`） |
| J2 | 完成判断 + 播报 + 续轮闭环（事件桥 turn/end） | J1 | 大 | 已完成（`j2-completion-20260924`） |

### 阶段 2：闭环收尾

| 编号 | 条目 | 前置 | 规模 | 状态 |
|---|---|---|---|---|
| J5 | voice-mini 让出托管会话的轮末播报（J2 上线后会重复播报，优先做） | J2 | 小 | 已完成（`j5-voice-mini-yield-20260924`） |
| J4 | 输出协调（播报合并、同一时间只问一个问题） | J2 | 中 | 已完成（`j4-output-20260924`） |
| J0 | 修复贾维斯会话标题设置（改用 `rename`）（可并行） | — | 小 | 已完成（`j0-title-20260924`） |
| J3 | 审批记录（带上下文写入长期记忆）（可并行） | —（J1 可选增强） | 中 | 已完成（`j3-approval-records-20260924`） |
| U2 | 目标列表显示任务进度（判断中 / 未满足） | J1、J2 | 小 | 已完成（`u2-task-state-20260924`） |
| J8 | 清理：过期注释、残留字段、SPEC 同步（放在本阶段最后） | — | 小 | 已完成（`j8-cleanup-20260924`） |
| J5a | 关闭完成判断时的重复播报（J5 实现记录留下的边界） | J5 | 小 | 已完成（`j5a-judge-off-silence-20260924`） |

### 阶段 3：稳定性

| 编号 | 条目 | 前置 | 规模 | 状态 |
|---|---|---|---|---|
| W1 | 面板崩溃自动拉起 | — | 小 | 已完成（`w1-panel-supervisor-20260924`） |
| O1 | 日志轮转与播报缓存清理（可并行） | — | 小 | 已完成（`o1-log-rotation-20260924`） |
| T1 | 真实 DSH 冒烟检查脚本（可并行） | — | 小 | 已完成（`t1-smoke-20260924`） |
| Q1 | 真机验收清单（人工，由用户执行；本阶段后做第一轮） | — | 小 | 待办 |

### 阶段 4：记忆

| 编号 | 条目 | 前置 | 规模 | 状态 |
|---|---|---|---|---|
| M1 | 记忆存储底座：目录布局 + 按 store 读写锁 | — | 中 | 已完成（`m1-memory-store-20260924`） |
| M2 | `remember` / `recall` 工具 | M1 | 中 | 已完成（`m2-remember-recall-20260924`） |
| M3 | 自动抓取 temp（pass A）（与 M2 可并行） | M1 | 中 | 已完成（`m3-temp-capture-20260924`） |
| M6 | 长期记忆注入贾维斯人设（L1 section） | M2 | 小 | 已完成（`m6-memory-section-20260924`） |

### 阶段 5：面板体验

| 编号 | 条目 | 前置 | 规模 | 状态 |
|---|---|---|---|---|
| U1 | 面板显示播报字幕（§12 口播内容） | — | 中 | 已完成（`u1-captions-20260924`） |
| H1 | 全局快捷键呼出输入框（可并行） | — | 中 | 已完成（`h1-hotkey-20260924`） |

### 阶段 6：设置与提问

| 编号 | 条目 | 前置 | 规模 | 状态 |
|---|---|---|---|---|
| J6 | DSH 设置页（`settings.installSection`） | J2 | 中 | 已完成（`j6-settings-20260924`） |
| J7 | 拦截托管会话的提问（低风险自答，默认关） | M2、J6 | 中 | 已完成（`j7-ask-intercept-20260924`） |

### 阶段 7：语音输入

| 编号 | 条目 | 前置 | 规模 | 状态 |
|---|---|---|---|---|
| S0 | 语音输入技术验证（权限、本机识别） | — | 小 | 待办 |
| S1 | 按住说话（语音输入） | S0、H1 | 大 | 待办（等 S0 结论） |

### 阶段 8：分级自动审批

| 编号 | 条目 | 前置 | 规模 | 状态 |
|---|---|---|---|---|
| P0 | 审批"总是允许"预设 | J3 | 中 | 已完成（`p0-approval-presets-20260924`） |
| P1 | 分级自动审批（Phase-2，默认关） | J3、P0、J6 | 大 | 已完成（`p1-tiered-approval-20260924`） |

### 阶段 9：发布

| 编号 | 条目 | 前置 | 规模 | 状态 |
|---|---|---|---|---|
| SEC1 | 安全审查与加固 | 阶段 2–8 中计划发布的条目 | 中 | 待办 |
| R1 | README、LICENSE、包信息 | — | 小 | 已完成（`r1-readme-20260924`） |
| R2 | 面板随插件分发（预编译通用二进制） | R1 | 中 | 待办 |
| R3 | 提交 awesome-dsh-plugin 收录 | R1、R2、SEC1 | 小 | 待办 |

### 暂缓 / 条件触发 / 不做

| 编号 | 条目 | 前置 | 规模 | 状态 |
|---|---|---|---|---|
| M4 | 处置分类器（pass B） | M2、M3 | 大 | 暂缓（D4，别认领） |
| M5 | 固化 / 长期清理 / 归档（pass C、E、F） | M4 | 大 | 暂缓（D4，别认领） |
| M7 | L3 摘要（pass D） | M3 | 中 | 条件触发（别认领） |
| A1 | 多个贾维斯化身 | J2、J4 | 大 | 条件触发（别认领） |
| X1 | 移植到其他平台 | — | — | 不做（仅记录结论） |

**合并冲突提醒**：`J3`、`J4`、`J5`、`O1` 都会改 `src/index.ts`；`H1` 与 `S1` 都会改 `AppController.swift`；`U1` 与 `U2` 都会改 `Snapshot.swift`。并行时后合入的一方负责解决冲突。

**状态说明**：「条件触发」= 设计已写好，但要等条目里写的触发条件出现才值得做，维护人确认后改为待办；「不做」= 只记录结论，防止重复讨论。唤醒词（常驻麦克风）规格明确不做，不列条目。

## 2. 通用约定

### 2.1 代码结构

- 插件：`src/index.ts` 只做 DSH 接线；逻辑放独立纯模块（参考现有 `src/managed.ts`、`src/conversation.ts`、`src/sessions.ts`、`src/live-state.ts`），纯模块**不 import DSH 包**，方便单测。
- 面板：`macos/Sources/JarvisPanelCore` 放纯逻辑（可测），`macos/Sources/JarvisPanel` 放界面。
- 注释只写代码本身表达不了的约束；风格、命名照周边代码。
- 插件自定义事件**绝不写会话日志**（§13 rc.6 坑：未知事件类型会毒化会话日志）。给会话发消息只用 `UserMessage`。

### 2.2 测试（用户硬性要求）

每个条目都要按**三段式**写测试：**等价类 / 边界值 / 异常路径**，测试文件内用 `describe('等价类')` 等分组（Swift 用 `// MARK: - 等价类`）。

- 插件：`node --test tests/*.test.ts`。import 带 `.ts` 后缀；**不要用构造函数参数属性**（`constructor(private x)`），Node 的类型剥离不支持。
- 面板：`cd macos && swift test`。改 PanelModel 的配套 `FakeAPI` 在 `macos/Tests/JarvisPanelCoreTests/FakeAPI.swift`。
- 当前基线（J2 合入后）：插件 163 项、面板 208 项，全部通过。完成条目时在实现记录里写新的数字。

### 2.3 构建、重启、提交

- 插件：`npm run build`（tsc → `lib/`），**需要用户重启 DSH 才生效**，完成时要在汇报里提醒。重启 DSH 后运行 `npm run smoke`。
- 面板：`cd macos && ./build.sh`，然后重启：
  ```
  pkill -x jarvis-panel; cd macos && perl -MPOSIX -e 'exit if fork; POSIX::setsid(); exit if fork; open STDIN,"</dev/null"; open STDOUT,">/dev/null"; open STDERR,">/dev/null"; exec "./jarvis-panel"'
  ```
- 面板截图验收：`JARVIS_SNAPSHOT=/tmp/jv-snap ./jarvis-panel`（场景定义在 `Snapshotter.swift`）。
- 每个条目一个提交，英文提交信息，风格参考 `git log`。
- 分支：每个条目从 `main` 开分支（如 `codex/j2-judge`），完成并验证后合回 `main`，依赖它的条目才能开工。开工前先确认前置条目已在 `main` 上。
- **主目录必须始终停在 `main`，实现一律在独立 worktree 里做。** DSH 通过软链接直接加载主目录（`~/.dsh/profiles/bailian-dev/node_modules/dsh-harness-jarvis` → 本仓库），主目录检出哪个分支、`lib/` 编的是什么，DSH 就跑什么；多个会话共用主目录切分支也会互相踩。做法：
  ```
  cd "/Users/zane/Vibe coding/dsh-plugin-discovery/dsh-harness-jarvis"
  git worktree add "../jarvis-wt/<slug>" -b codex/<slug> main
  cd "../jarvis-wt/<slug>" && ln -s "/Users/zane/Vibe coding/dsh-plugin-discovery/dsh-harness-jarvis/node_modules" node_modules
  ```
  在 worktree 里实现、测试、提交。合并：`git -C "<主目录>" merge --ff-only codex/<slug>`（主目录在 `main` 且干净时，这会同时更新主目录的文件）；合完在主目录运行 `npm run build`，改了面板再运行 `macos/build.sh` 并重启面板；最后 `git worktree remove "../jarvis-wt/<slug>"`。voice-mini 同样通过软链接被 DSH 加载，改它时照此办理。
- 调试日志：`~/.dsh/jarvis/debug.log`（`debug(entry, msg)`）。
- 本文中 `../dsh-voice-mini`、`../awesome-submission` 等相对路径都从**主目录**（本仓库根目录）出发，指向 `/Users/zane/Vibe coding/dsh-plugin-discovery/` 下的同名目录；在 worktree 里要换成绝对路径。

### 2.4 已确认的 DSH 接缝（实现时直接用）

| 用途 | 用法 | 备注 |
|---|---|---|
| 取会话的 Agent | `ctx.get('agents').get(id)` | 有 `.status`（'idle'/'running'）、`.session.deriveMessages()`、`followup/steer/inject` |
| 给会话发消息并唤醒 | `deliver(agent, userMessage)`（`src/sessions.ts`） | 空闲 followup、运行中 steer，最后才 inject |
| 构造插件消息 | `{ id: MessageId('jarvis-…'), role: 'user', content: [{type:'text', text}], source: { kind: 'plugin', plugin: 'dsh-harness-jarvis', form: 'notice', summary } }` | 见 `inject_to_session` 工具 |
| 会话事件 | `ctx.on('session/event', (session, event) => …)` | `turn/start`、`turn/end`（`event.data.reason.kind` ∈ completed / aborted / blocked / error / max-tokens / interrupted）、`user/message` |
| 续轮缝 | `ctx.on('agent/turn-stopping', ({agent, turn}) => …)` | 串行监听器，可 `agent.steer()` 让轮次保持打开；**不能在里面等用户**（会卡住轮次） |
| 问用户 | `userQuestions.ask({ questions:[{id, question, header?, options?:[{label}]}], agent?, signal? })` → `{answers:[{id, selected[], custom?}]}` | 已封装为 `deps.ask` |
| 贾维斯播报 | `deps.say(text)` → `speakAsJarvis`：静音 → voice-mini → 内置 edge-tts | |
| 一次性模型调用 | `ctx.inject(['llm'], c => c.get('llm'))`，`llm.stream({provider, model, messages, system, maxTokens, reasoningEffort?, purpose, signal})`，读 `text-delta` 分片，以 `finish` 结束 | 参考 `dsh-voice-mini/src/index.ts` 的 `summarizeReply`：先带 `reasoningEffort`，若 finish 报 "does not support reasoning effort" 则去掉重试 |
| 会话 cwd | `sessions.get(id).header.cwd`（已封装 `sessionWorkspace`） | |
| 归档集合 | `workspaceRegistry.archivedSessionIds` | 归档不卸载 agent |
| 会话标题 | `ctx.get('sessionTitle')`：`get(session)`、`rename(session, title)`、`refresh(session, signal?)` | 参数 `session` 是**会话对象**（`ctx.sessions.get(id)`），不是 id；`rename` 会"钉住"标题，之后不再自动改 |
| 设置 | `ctx.settings.installSection(owner, ns, schema, entry, hooks)`；`get(ns)`、`watch(cb)`、`update(ns, patch)` | ns 只能小写字母、数字、连字符 |
| 审批/提问转发 | `live.holdApproval(req, next, command)` / `live.holdAsk(req, next)` | 已在 `index.ts` 挂好，面板与 DSH 窗口谁先答算谁 |

## 3. 条目详情：会话管理闭环

### J0 修复贾维斯会话标题设置

- **问题**：`trySetTitle`（`src/index.ts`）调用 `set` / `setTitle` / `update`，但 DSH 的标题服务只有 `rename(session, title)`。`debug.log` 里 10 次全部是 `titleService no set/setTitle/update`，也就是贾维斯标题从来没设成功过。
- **实现逻辑**：
  1. 改为 `const s = ctx.get('sessions')?.get(entry.jarvisSessionId); if (s) titleService.rename(s, '贾维斯')`。
  2. `rename` 会钉住标题，所以**只需在创建/恢复成功后调一次**；删掉"每次 turn/end 重设标题"的逻辑（`session/event` 里 `trySetTitle` 那段）以及那段诊断日志。
  3. 调用前先 `titleService.get(s)`，已经是"贾维斯"就跳过，避免每次启动都追加一条标题事件。
  4. 抛错（会话未 live 等）只写 debug 日志，不影响启动。
- **验收**：重启 DSH 后侧栏里贾维斯会话标题是"贾维斯"，对话几轮后不变；`debug.log` 不再出现 `titleService no set`。
- **测试**：这部分是接线代码，可把"决定是否需要 rename"抽成纯函数 `needsRename(current: string | undefined, wanted: string)` 做三段式测试（等价类：已是/不是；边界：空串、前后空格；异常：undefined、非字符串）。
- **实现记录**（Codex J0 / 2026-09-24）：`src/title.ts` 提供不依赖 DSH 的 `needsRename`；`src/index.ts` 等创建或恢复成功、标题服务可用后，使用 `sessions.get(id)` 得到的会话对象读取标题并调用 `rename(session, '贾维斯')`，同名跳过。标题服务延迟注入也能处理，每次启动最多尝试一次；删除轮末重设及消息数诊断，读取或重命名异常（包括异步拒绝）仅写 debug，不阻断首轮或欢迎语。
  - 边界决定：当前标题使用 `unknown` 接收宿主异常值，按严格相等比较，不修剪空白或隐式转换；会话缺失时跳过，不在后续轮次重试。纯函数及真实 `apply()` 接线均按等价类 / 边界值 / 异常路径测试，新增 17 项；`node --test tests/*.test.ts` 206/206、`cd macos && swift test` 208/208、`npm run build` 和 `git diff --check` 通过。表格使用标签 `j0-title-20260924` 定位单个实现提交；合入构建后需用户重启 DSH，验收侧栏标题及多轮后保持不变，面板无需重启。

### J1 任务台账

- **目的**：记住"用户让哪个会话做什么"，给 J2 的完成判断提供"原始需求"，给 J3 的审批记录提供上下文。只有台账里有未结任务的会话才会被判断和播报，用户自己在 DSH 里直接驱动的会话不受打扰。
- **新文件**：`src/tasks.ts`，`class TaskLedger`，持久化 `~/.dsh/jarvis/tasks.json`（写法同 `ManagedSet`：临时文件 + rename 原子写，写失败调 `onError` 但保留内存状态；读到损坏内容当空）。
- **数据**：
  ```ts
  interface Task {
    id: string;            // randomUUID
    session: string;
    request: string;       // 用户原话（没有就用贾维斯发出的消息）
    message: string;       // 贾维斯实际发给会话的内容
    createdAt: number;
    status: 'open' | 'judging' | 'done' | 'unsatisfied' | 'dropped';
    rounds: number;        // 已续轮次数
    lastVerdict?: { verdict: 'satisfied' | 'unsatisfied' | 'unclear'; summary: string; missing?: string; at: number };
  }
  ```
- **接口**：`expect(session, request)`、`open(session, message): Task`、`current(session): Task | undefined`（最新一个 open/judging/unsatisfied 的任务）、`setStatus(id, status, verdict?)`、`bumpRound(id)`、`dropSession(session)`、`prune(now)`。
- **写入时机**：
  1. `POST /jarvis/input` 且目标是会话时：`ledger.expect(session, text)`，暂存用户原话（内存即可，10 分钟过期）。
  2. `inject_to_session` 成功投递后：`ledger.open(session, message)`。如果有同会话、未过期的 `expect`，把它作为 `request` 并消费掉；否则 `request = message`。
  3. 同一会话已有 open 任务时再次 `open`：把旧任务标为 `dropped`（新指令覆盖旧指令），避免一次 turn/end 对应两个任务。
  4. `release_session` / 面板移出托管：`dropSession(session)`。
- **上限**：最多保留 200 条，`prune` 丢掉最旧的 done/dropped；open 状态超过 24 小时自动 dropped。
- **验收**：通过面板给某托管会话发一句话后，`tasks.json` 里出现一条 open 任务，`request` 是原话，`message` 是贾维斯改写后的内容。
- **测试**（`tests/tasks.test.ts`）：
  - 等价类：有 expect 时 request 取原话；无 expect 时取 message；dropSession 只影响该会话。
  - 边界：expect 恰好 10 分钟过期；第 201 条触发 prune；同会话连续 open 两次前一条变 dropped；24 小时边界。
  - 异常：文件损坏、父目录不存在、写失败（onError 被调且内存仍更新）、空字符串 session/message。
- **实现记录**（Codex J1 / 2026-09-24）：`src/tasks.ts` 实现独立台账，`src/index.ts` 接入面板原话、投递成功、工具/面板移出托管，并以可配置的 `tasksFile`（默认原定路径）落盘；每分钟清理一次，卸载时撤销定时器。三段式测试位于 `tests/tasks.test.ts` 与 `tests/tasks-wiring.test.ts`，后者通过真实插件注册的工具和路由验证接线，不启动真实面板。
  - 边界决定：原话保留首尾空白，恰好 10 分钟失效；空白 session/message/request 拒绝；旧任务覆盖、移出托管及超过 24 小时过期均覆盖全部未结状态（open/judging/unsatisfied），恰好 24 小时仍有效。容量先淘汰最旧 done/dropped；若超过 200 条且全为未结任务，先丢弃最旧未结任务再淘汰，保证硬上限。`unsatisfied` 的续轮复用仍由 J2 按正文补充。
  - 验证：`node --test tests/*.test.ts` 102/102、`cd macos && swift test` 208/208、`npm run build` 通过；真实 DSH 重启后的面板验收待用户执行。为保持实现和台账更新在同一个提交，表格使用 Git 标签 `j1-task-ledger-20260924` 定位该提交（`git rev-parse j1-task-ledger-20260924` 可取提交号）。

### J2 完成判断 + 播报 + 续轮闭环

- **目的**：兑现 §8 的核心差异化——托管会话做完一轮后，贾维斯判断"满足需求没有"。满足就播报一句结果；不满足就问你要不要让它继续，你同意就自动续。
- **新文件**：
  - `src/llm.ts`：`oneShot(llm, opts): Promise<string | null>`，封装一次性模型调用（超时、`reasoningEffort: 'low'` 不支持时去掉重试、只收集 `text-delta`、任何错误返回 null）。**J2、M4、M5、J7 共用**，务必写成通用助手。
  - `src/judge.ts`（纯）：`finalReply(messages): string`（取最后一条用户消息之后所有 assistant 文本块，去掉代码块，截断到 3000 字）；`judgePrompt(task, reply): {system, prompt}`；`parseVerdict(raw): Verdict | null`（容忍 JSON 外包 markdown 围栏、多余文字；字段缺失或 verdict 非法 → null）。
- **触发**（`src/index.ts` 的 `session/event` 监听里，现有 `case 'turn/end': // TODO` 处）：
  1. 只处理 `managed.has(sid)` 且 `ledger.current(sid)` 存在的会话；否则什么也不做（未读计数照旧由 `live` 负责）。
  2. 按 `reason.kind` 分流：
     - `completed` → 进入判断。
     - `aborted`（用户手动停）→ 任务标 `dropped`，不播报。
     - `error` / `blocked` / `max-tokens` / `interrupted` → 播报"{会话名}失败了：{原因}"（原因文案复用 `live-state.ts` 的 `FAILED_KINDS`，interrupted 用"被中断"），任务保持 open（用户可能会让它重试）。
  3. **不要**用 `agent/turn-stopping` 做这件事：那里不能等用户回答。续轮统一走"轮次结束 → 判断 → 问用户 → `deliver` 新消息"。
- **判断流程**：
  1. 任务标 `judging`，记下当时的"轮次代号"（`live` 的 version 或自增计数）。
  2. `reply = finalReply(agent.session.deriveMessages())`；reply 为空 → 当作 `unclear`。
  3. `llm` 不可用（没注入）→ 当作 `unclear`。
  4. 调 `oneShot`，provider/model 默认用 `entry.provider`/`entry.model`，可由新配置 `judgeProvider`/`judgeModel` 覆盖；超时 `judgeTimeoutMs` 默认 20000；`maxTokens` 300。
  5. 提示词要求只输出 JSON：`{"verdict":"satisfied|unsatisfied|unclear","summary":"≤40字、能直接念出来的一句话结果，不含代码/路径","missing":"不满足时缺什么，≤60字"}`。输入：用户原始需求、贾维斯发出的指令、会话本轮最终回复。
  6. 返回前若该会话已开始新一轮（收到 `turn/start`）或任务已不是 judging → **丢弃结果**（过期判断）。
- **按判断结果处理**：
  - `satisfied` → `deps.say('{会话名}：{summary}')`，任务标 `done`。**不唤醒贾维斯**（省一轮模型调用，决策 D2 已定）。
  - `unclear` → `deps.say('{会话名}做完了')`（模板），任务标 `done`。
  - `unsatisfied` 且 `rounds < maxContinueRounds`（默认 2）→ 任务标 `unsatisfied`，用 `deliver(jarvisAgent, notice)` 唤醒贾维斯，notice 文本：
    ```
    [会话 {会话名}（id={sid}）本轮结束，判断未满足]
    原始需求：{request}
    缺少：{missing}
    请用 ask_user 问用户是否让它继续（选项：继续 / 不用了）。用户选继续，就用 inject_to_session 发一条具体的续做指令；选不用了就结束。
    ```
    贾维斯随后调用 `inject_to_session` 时，J1 的 `open` 逻辑会把这次视为同一任务的续轮：**同会话、上一个任务状态为 unsatisfied 时，不新建任务，而是 `bumpRound` 并改回 open**（J1 需要支持这个分支，J2 实现时补上并补测试）。
  - `unsatisfied` 且已达上限 → `deps.say('{会话名}还没做完：{missing}，已经续了 {n} 次，交给你看看')`，任务标 `done`。
- **人设更新**：`COMMANDER_PERSONA` 加一条："收到以 `[会话 … 判断未满足]` 开头的系统通知时，按通知要求用 ask_user 询问，不要自己决定续做。"
- **新配置**（`Config` 与 `JarvisConfig` 同步加）：`judgeEnabled: true`、`judgeProvider: ''`、`judgeModel: ''`、`judgeTimeoutMs: 20000`、`maxContinueRounds: 2`。`judgeEnabled=false` 时所有 completed 都走 `unclear` 模板播报。
- **与 voice-mini 的重复播报**：voice-mini 自己会在每个会话 turn/end 时总结播报（`summarizeReply`）。不处理的话同一件事会被说两遍。由 J5 解决；J2 先实现，J5 合入前会重复，属已知现象。
- **面板**：不需要改。播报时面板已有紫/青色区分；未读计数照旧。
- **验收**：
  1. 交给贾维斯一个简单任务，会话完成后听到贾维斯用自己的声音说一句结果。
  2. 交一个故意做不完的任务（比如要求读一个不存在的文件并总结），完成后面板弹出"是否继续"的选择题；选继续，会话自动开始新一轮。
  3. 在 DSH 里手动停掉会话，贾维斯不说话。
  4. 用户直接在 DSH 里和某托管会话聊天（没经过贾维斯），轮末贾维斯不判断。
- **测试**：
  - `tests/judge.test.ts`：`finalReply`（多条 assistant 合并、跳过工具块、去代码块、截断边界 3000、没有 assistant 返回空）；`parseVerdict`（纯 JSON、围栏包裹、前后有废话、verdict 非法、summary 超长截断、非 JSON、空串）。
  - `tests/llm.test.ts`：用假 `llm` 对象测 `oneShot`：正常拼接 text-delta；不支持 reasoningEffort 时自动重试一次；超时返回 null；stream 抛错返回 null；无 text 返回 null。
  - 把"收到 turn/end 后该做什么"抽成纯函数 `planTurnEnd({managed, task, reasonKind, verdict, rounds, max})` → 动作枚举，按三段式覆盖所有分支（含过期判断丢弃、达上限）。
- **实现记录**（Codex J2 / 2026-09-24）：新增 `src/llm.ts`（共享总超时、取消、reasoningEffort 单次降级重试）、`src/judge.ts`（回复提取、JSON 解析、纯动作判定）和 `src/completion.ts`（每会话轮次与任务身份校验的异步闭环）；`src/index.ts` 仅接入事件、五项配置、人设、播报与 UserMessage 通知，移除旧的 turn-stopping 空钩子，失败原因复用 `live-state.ts`。
  - 补充决定：`tasks.ts` 对无新面板原话的 unsatisfied 任务复用 id/原始需求/创建时间、更新指令并递增 rounds；新的面板原话仍覆盖旧任务。`ask_user` 增加可选、成对的 session/task 参数（未满足通知明确要求携带），用户选“不用了”关闭相应任务，过期答复不继续转发；重启后仍可回答未发生新活动的持久化未满足任务。新轮次、新面板输入、移出托管和卸载会取消旧判断；标题缺失回退会话 id，通知投递失败恢复 open 并记日志，先结算任务再等待播报以防覆盖新任务。
  - 验证：三段式测试覆盖 llm/judge/completion 和台账续轮，并扩展真实插件注册的工具/事件接线测试；`node --test tests/*.test.ts` 163/163、`cd macos && swift test` 208/208、`npm run build` 通过。临时副本移除事件桥后有 7 项接线测试失败，确认回归覆盖。未启动真实 DSH；重启后需人工验收声音及提问，J5 合入前的重复播报仍是已知现象。表格用 Git 标签 `j2-completion-20260924` 定位实现与状态更新的同一提交（`git rev-parse j2-completion-20260924` 可取提交号）。

### J3 审批记录

- **目的**：§11 Phase-1 要求每次审批都记下"做了什么、当时在干嘛、你怎么决定的"，给 Phase-2 自动分级攒样本。
- **新文件**：`src/approvals.ts`（纯）：
  - `fingerprint(tool, command)`：`tool + ':' + 规范化命令`。规范化：去首尾空白、连续空白合一、按空白切词后去掉以 `/` 或 `~` 开头的绝对路径前缀只保留最后一段、全部小写、最多 8 个词、`[^a-z0-9._-]` 替换成 `-`。例：`bash:rm-rf-node_modules`。
  - `renderApprovalHtml(record)`：输出 §10.1 的 HTML 结构（`<approval fingerprint ts>` 下有 `session`、`operation`、`context`、`decision`、`tier`）。**所有属性和文本都要 HTML 转义**。
  - `approvalFileName(fp, ts)` → `<fp>-<yyyyMMddTHHmmss>.html`。
- **写入**（`src/index.ts`，`approval/request` 监听处）：`live.holdApproval(...)` 返回的 Promise 结算后：
  - 只记录 `allowed-once` 与 `rejected`，`cancelled` / `unavailable` 不记。
  - `decision.source` 固定 `user`（面板或 DSH 窗口都是用户答的）；`reason` 留空。
  - `context`：优先 `ledger.current(sid)?.request`；没有就取该会话最后一条用户消息文本；截断 300 字。
  - `session` 带 `id`、`cwd`（`sessionWorkspace` 的完整路径）、`managed="true|false"`（所有会话的审批都会转发，所以都记）。
  - `tier` 留空、`notes="Phase1:未分级"`。
  - 路径 `~/.dsh/jarvis/memory/approvals/`。M1 完成前直接原子写文件；M1 完成后改走 `MemoryStore` 的 general 写锁（在 M1 的实现记录里提醒）。
  - 写失败只记 debug 日志，**绝不能影响审批结果的返回**（先把 outcome 返回给 DSH，再异步写）。
- **验收**：在某会话触发一次需要审批的命令，面板上点拒绝，`memory/approvals/` 下出现一个 HTML，打开能看到命令、会话、上下文和"拒绝"。
- **测试**（`tests/approvals.test.ts`）：
  - 等价类：普通命令、带绝对路径的命令、非 bash 工具（只有 path）。
  - 边界：空命令、超长命令（>8 词）、Unicode 命令、同一秒两条（文件名不能冲突，追加 `-2`）。
  - 异常：命令含 `<>&"'` 时 HTML 正确转义；undefined command；写目录无权限不抛出。
- **实现记录**（Codex J3 / 2026-09-24）：`src/approvals.ts` 提供指纹、文件名、全字段 HTML 转义及操作参数提取；`src/approval-store.ts` 将完整内容写入同目录临时文件，再用 hard link 原子发布（避免 rename 覆盖已有文件），同秒并发自动追加 `-2`、`-3`。`src/index.ts` 对托管及非托管会话只记录 allowed-once/rejected，保留原始参数和完整命令；面板仍截断显示 300 字。增加 `approvalsDir` 配置，默认规格路径。
  - 边界决定：审批请求进入时用新增的 `TaskLedger.peekCurrent` 只读查询冻结台账原话（无任务则最后一条 user 消息的全部文本块）、managed、操作和 cwd，上下文按 Unicode 码点截断 300 字；结算后用 `setImmediate` 延后所有落盘和错误日志，确保 DSH Promise 链先返回 outcome。只读查询沿用 24 小时 TTL 但不修改状态、不清理、不写盘，避免原 `current` 隐式 prune/save 阻塞审批；后续周期 prune 仍会正常持久化过期状态。元数据失败跳过该条并延后记日志，落盘及日志失败都不改变 outcome。现有 `sessionWorkspace` 实际返回目录末段，因此记录直接从 sessions 的 header.cwd 取完整路径；未改面板的目录显示逻辑。
  - 文件名保留合法指纹中的冒号，时间统一 UTC 秒，移除路径危险字符与前导点并限制指纹文件名前缀到 160 字节；空命令使用空规范化部分。HTML 保留 §10.1 全部属性，额外让 session/operation/decision 含转义后的可读文本，直接打开可见会话、命令和批准/拒绝。M1 尚未合入，按用户要求直接原子写文件；**M1 后续迁移提醒：改走 MemoryStore 的 general 写锁**（遵守不改其他条目，提醒仅留此处）。
  - 验证：`tests/approvals.test.ts`、`tests/approvals-wiring.test.ts`、`tests/tasks.test.ts` 按等价类 / 边界值 / 异常路径新增 29 项；真实注册监听器覆盖 DSH 与面板决定、返回前无文件系统调用、台账/消息回退、上下文冻结、异常隔离。`node --test tests/*.test.ts` 235/235（包含已合入的 J0，rebase 后重新全量验证）、`cd macos && swift test` 208/208、`npm run build`、`git diff --check bf88e80..HEAD` 通过。需重启 DSH 后人工触发一次审批，核验默认目录 HTML；无需单独重启面板。表格标签由维护人在审查并合入后创建，保持实现与记录在同一个提交。

### J4 输出协调（规格里的"输出锁"）

- **目的**：多个会话同时完成时，播报别乱成一锅；贾维斯同时只向你提一个问题。
- **新文件**：`src/output.ts`，`class OutputCoordinator`（纯，时钟可注入）：
  - `announce(session, text)`：进入 1.5 秒合并窗口；窗口内来自不同会话的多条完成播报合并成一句："hammer 和 anvil 都做完了"（≥3 个："hammer、anvil 等 3 个会话做完了"），然后调用注入的 `say`。单条则原样播。失败类播报不合并，立即播。
  - `ask(fn)`：贾维斯发起的 `ask_user` 串行执行，同一时间只有一个在等你回答，其余排队（FIFO）；排队中的问题若其会话已被移出托管则丢弃。
  - 播报**不等**提问结束（问题挂着时仍可播报完成消息）。
- **接入**：J2 的所有播报走 `announce`——J2 的 `CompletionJudge`（`src/completion.ts`）通过构造时传入的 `deps.say` 播报（`src/index.ts` 里 `say: text => deps.say(text)`），把这里换成协调器即可，不用改 `completion.ts` 内部。J2 给 `ask_user` 加了可选的 `session`/`task` 参数，串行化时要原样保留；`ask_user` 工具和 `deps.ask` 走 `ask`。删掉 `inject_to_session` 里的 `// TODO §3.2: acquire output lock` 注释（发消息给会话不需要锁）。
- **验收**：让两个托管会话几乎同时完成，只听到一句合并播报。
- **测试**（`tests/output.test.ts`，假时钟）：合并窗口内 2 条/3 条/跨窗口不合并；失败类不合并；ask 串行、第二个在第一个结束后才开始；fn 抛错不阻塞队列；同一会话窗口内两条只播最后一条。
- **实现记录**（Codex J4 / 2026-09-24）：新增纯模块 `src/output.ts`，固定 1.5 秒窗口按会话 id 合并完成播报、同会话只保留最新一条；提问独立 FIFO，排队时移出托管或取消即丢弃，异常不阻塞后续问题，卸载清理定时器与队列。`src/index.ts` 用异步会话上下文把 J2 文本播报交给协调器（不改 `completion.ts`），保留名称，失败与续轮达上限的未完成提醒立即播报；后者不合并，避免误报“都做完了”。`deps.ask` 统一排队，`ask_user` 的 session/task、agent/signal 原样传递，续做有效性在真正出队时重新检查；删除投递工具的输出锁 TODO。
  - 测试：`tests/output.test.ts` 假时钟三段式覆盖窗口 1499/1500ms、2/3 会话、跨窗口、同会话覆盖、提问期间播报、FIFO、移出/取消/异常与卸载边界；`tests/tasks-wiring.test.ts` 补充并发接线及续做参数/失效验证。插件 **189/189**、面板 **208/208**、`npm run build`、`git diff --check` 通过，独立代码审查无待修问题。
  - 前置 J2 已在 `main`，从最新 `main` 建独立 worktree / `codex/j4-output`。表格用标签 `j4-output-20260924` 定位含本记录的单个提交（`git rev-parse j4-output-20260924` 可取提交号）。需要重启 DSH，无需重启面板；真实 DSH 待手动验收两个托管会话近同时完成只播一句、问题依次出现、等待回答时仍能播报，以及移出后不再展示排队旧问题。

### J5 voice-mini 让出托管会话的轮末播报

- **问题**：voice-mini 在每个会话 turn/end 都会总结播报；J2 上线后，托管会话的结果会被 voice-mini 和贾维斯各说一遍。
- **方案**（决策 D1 已定）：贾维斯接管"交给他的任务"的轮末播报，voice-mini 让出。
  1. 贾维斯插件：在 `ctx.provide('jarvis', {...})` 暴露的服务里加 `claimsTurnEnd(sessionId: string): boolean`，当 `managed.has(id) && ledger.current(id)` 存在且 `judgeEnabled` 时返回 true。
  2. voice-mini（仓库 `../dsh-voice-mini`）：`turn/end` 分支开头，若 `jarvisService?.claimsTurnEnd?.(sid)` 为 true 则 `return`（状态提示音和工具播报照旧，只跳过轮末总结和模板）。
  3. 贾维斯没装时 `jarvisService` 为 undefined，voice-mini 行为不变。
- **测试**：voice-mini 侧仿照现有 `test-jarvis-speech.mjs` 加检查（claims 为 true 时不入队、false 时照旧、服务缺失时照旧、claimsTurnEnd 抛错时照旧）；贾维斯侧把判定抽成纯函数测三段式。
- **注意**：这是跨仓库改动，两边各自提交；voice-mini 提交信息注明依赖贾维斯的 `claimsTurnEnd`。
- **实现记录**（2026-09-24）：Jarvis 新增 `src/turn-end.ts` 纯判定、`src/index.ts` 的 `claimsTurnEnd` 服务及 `tests/turn-end.test.ts` / `tests/tasks-wiring.test.ts` 测试；仅托管、有未结任务且启用判断时接管。voice-mini 的 `src/index.ts` 在 `turn/end` 开头检查严格 `true`，缺失或抛错均回退原播报，状态提示音及工具播报不变；扩展 `test-jarvis-speech.mjs` 并同步受版本管理的 `lib/index.js`（包含基线源码已有的 replay 播报信号两行）。两侧测试按等价类 / 边界值 / 异常路径分组，Jarvis 插件 **171/171**、面板 **208/208**、voice-mini **41/41** 通过，两插件构建通过，独立代码审查无待修问题。
  - 提交：Jarvis 标签 `j5-voice-mini-yield-20260924` 指向含本记录的最终提交（`git rev-parse j5-voice-mini-yield-20260924` 可取提交号）；voice-mini `27ec197`，提交信息已注明依赖 Jarvis 的 `claimsTurnEnd`。两仓库均从各自最新 `main` 建独立 worktree 和同名分支 `codex/j5-voice-mini-yield`，前置 J2 已在 Jarvis `main`。
  - 按条目原条件实现，没有扩大 J2 行为：`judgeEnabled=false` 时 voice-mini 照旧，J2 仍有模板播报，此配置下的重复播报边界留维护人确认。未做真实 DSH 人工验收；重启 DSH 后检查托管任务只有 Jarvis 轮末播报、普通会话照旧、状态提示音和工具播报照旧；无需重启面板。

### J5a 关闭完成判断时的重复播报

- **问题**：`judgeEnabled=false` 时，`claimsTurnEnd`（`src/turn-end.ts`）返回 false，voice-mini 照常总结播报；但 J2 在判断关闭时仍对托管任务播"{会话名}做完了"的模板，失败原因也照播。同一轮会被说两遍。
- **方案**：判断关闭 = 贾维斯不接管轮末播报，全部交给 voice-mini（它的总结比模板信息量大）。
  1. `judgeEnabled=false` 时，贾维斯对 `completed` 和各类失败都**不播报**，只更新台账：`completed` 标 `done`，`aborted` 标 `dropped`，失败保持 open（与 J2 原逻辑一致）。
  2. `claimsTurnEnd` 保持现状（判断关闭时返回 false），两边规则正好互补：判断开 → 贾维斯说、voice-mini 让出；判断关 → voice-mini 说、贾维斯沉默。
  3. 未安装 voice-mini 且判断关闭时，托管任务的轮末不会有任何播报。这是可接受的：用户主动关了判断，面板未读标记照常出现。在 README 的配置说明里补一句。
- **位置**：优先在 `src/judge.ts` 的 `planTurnEnd` 里加一个 `judgeEnabled` 输入，由它产出"只更新台账、不播报"的动作，避免在 `index.ts` 里分支。
- **测试**：`planTurnEnd` 在判断关闭时对每种 `reasonKind` 的动作（等价类）；判断开关在运行中通过设置页切换后立即生效（边界，J6 的 watch）；台账写失败不影响（异常）。
- **实现记录**（Codex J5a / 2026-09-24）：`src/judge.ts` 的 planTurnEnd 接收 judgeEnabled，关闭时返回静默台账动作；CompletionJudge 直接完成 done / dropped / open 更新并撤销旧判断与续做问题，不取标题、不调模型、不播报。等待标题或模型时切换关闭也会重新应用同一策略，迟到结果不会播报或发起续做；未管理、终态、未知原因和过期事件仍忽略。保留判断开启时的模型及失败/unclear 回退行为，不改 index.ts、claimsTurnEnd 或 voice-mini。
  - README 补充“未装 voice-mini 且关闭判断时轮末不播报”，同步 SPEC 旧边界说明。三段式新增 26 项测试，覆盖全部结束原因及未结状态、真实 settings watch 开关切换、迟到模型/标题、台账写失败仍更新内存；先红后绿，插件全测 883/883、Swift 307/307、npm run build、macos/build.sh、配置表 --check 与 git diff --check 均通过。单提交标签 `j5a-judge-off-silence-20260924`；合回 main 后重建插件，面板行为未变无需专门重启。需用户重启 DSH 后执行 npm run smoke，并切换 judgeEnabled 验收已托管任务完成/失败时关闭无重复播报、开启恢复贾维斯播报。


## 4. 条目详情：记忆系统（§10）

> 规格里的记忆设计很大（A–H 八个 pass）。本清单只做到能用的程度：M1–M6。pass D（L3 摘要）和 pass G（路由）不做——前者瘦编排下用不上，后者已由面板显式选择目标替代。

### M1 记忆存储底座

- **新文件**：`src/memory/store.ts`。
- **目录**（§10.3）：
  ```
  ~/.dsh/jarvis/
    temp/<sessionId>/<yyyy-MM-dd>.jsonl
    memory/general/*.html
    memory/<sessionId>/*.html
    memory/approvals/*.html     # J3
  ```
  sessionId 用作目录名前先做安全化（只保留 `[A-Za-z0-9._-]`，其余替换为 `_`），防路径穿越。
- **锁**（§10.3 规则 8）：按 store 分读写锁——每个会话一把（管它的 temp + 长期），general 一把，approvals 一把。进程内用 Promise 队列实现读写锁：读可并发、写互斥、写优先（有写在等时新读排队）。`lock.json`（配置 `lockFile`）只记录"正在写哪个 store、开始时间"，启动时发现残留且超过 60 秒则视为崩溃遗留、直接清掉。
- **接口**：
  - `appendTemp(session, record)`（写锁）
  - `readTemp(session, {since?})`（读锁）
  - `writeLong(scope: 'general' | sessionId | 'approvals', entry: LongEntry)`（写锁，原子写单文件）
  - `listLong(scope)`、`readLong(scope, file)`（读锁）
  - `removeLong(scope, file)`（写锁）
- **长期条目格式**（HTML，一条一文件）：
  ```html
  <memory id="…" tag="…" intent="…" session="…" created="ISO" expires="ISO|" source="remember|classifier|consolidate">
    <key>一句话关键点</key>
    <detail>可选补充，≤500 字</detail>
    <ref session="…" turn="…"/>
  </memory>
  ```
  提供 `renderMemory` / `parseMemory`（纯函数，转义与反转义对称）。
- **测试**：锁的并发语义（两个写串行、读写互斥、多读并发、写优先）、路径安全化（`../x`、空串、Unicode）、HTML 往返、`lock.json` 残留清理、磁盘写失败时锁能释放。
- **实现记录**（Codex M1 / 2026-09-24）：新增 `src/memory/{store,lock,journal,format}.ts`，提供按会话 / general / approvals 分离且写优先的进程内读写锁、UTC 日期 JSONL、原子长期 HTML 读写、对称转义解析与诊断恢复；`src/memory/README.md` 固定 M2/M3/J3/P0 的输入、返回、错误、锁与路径契约。`src/index.ts` 新增 `memoryRoot` 配置并替换空 loadLock 接线；J3 保留先返回 DSH 审批结果、setImmediate 异步落盘及 hard-link 防覆盖，只把完整发布过程迁入 approvals 写锁。**J3 旧记录的 general 锁提醒按本条及用户要求更正为独立 approvals 锁**，不修改其他条目。
  - 边界决定：空会话拒绝，general/approvals 保留；有损字符、大写、超长及包含编码分隔符的名称追加摘要，防止路径穿越、转换碰撞和 macOS 大小写覆盖；配置路径解析真实祖先，路径别名共享锁及诊断。temp 的 at/since 为毫秒、since 包含边界，at 限制为 epoch 至 UTC 9999 年末；损坏行跳过，残缺尾行补换行后再追加。长期相同 id 原子替换，listLong 返回 basenames，readLong 返回原始 HTML 以兼容审批格式；detail 按 Unicode 码点最多 500。诊断超过 60 秒清理，诊断错误不阻断业务，真实 I/O 错误释放锁后 reject；复合锁 callback 不可重入，M3 容量检查须在 appendTemp 内同锁扩展。
  - 测试：新增 27 项存储测试与 1 项真实审批接线测试，按等价类 / 边界值 / 异常路径覆盖锁调度、路径与大小写、配置别名、HTML 往返、原子发布失败、诊断残留及失败恢复；插件 **346/346**、面板 **222/222**、`npm run build`、`macos/build.sh`、`git diff --check` 全通过。独立审查发现的路径碰撞、别名锁 / 诊断和 JSONL 残片问题均补回归并修复，复验无合并阻断。标签 `m1-memory-store-20260924` 定位单个实现提交；合入后主目录重建插件，需用户重启 DSH 并运行 `npm run smoke`。面板代码未改，无需单独重启；人工可触发一次审批，确认先收到结果、随后 memory/approvals 出现可读记录。

### M2 `remember` / `recall` 工具

- **注册位置**：`registerJarvisTools`，与现有工具同样用 `textOutput`。
- **`remember`**：参数 `{ content: string (必填), tag?: string, session?: string, expiresDays?: number }`。`session` 为空写 general，否则写该会话长期。`content` 第一句作为 `<key>`，其余作为 `<detail>`。返回"记住了"。
- **`recall`**：参数 `{ query: string (必填), session?: string, limit?: number (默认 5, 最多 10) }`。
  - 检索范围：general + （指定 session 时）该会话长期 + approvals（query 含"审批/批准/拒绝"时）。
  - 打分：query 按空白和中文单字切词，命中 key 权重 3、tag 2、detail 1；过期条目跳过；同分按新旧。
  - 返回每条：`- [tag] key（来源：session 或 general，日期）`，不返回 detail 全文（§10 原则 1：关键点 + 源指针）。
- **人设**：`COMMANDER_PERSONA` 加："用户说'记住…'就用 remember；需要回忆过去的约定或决定时先 recall。"
- **测试**：打分排序、limit 边界（0、11）、过期过滤、中英文 query、空库、会话目录不存在、条目文件损坏被跳过。
- **实现记录**（Codex M2 / 2026-09-24）：确认 M1 已在 main 后，从最新 main 建 `codex/m2-remember-recall` 独立 worktree。新增 `src/memory/tools.ts` 与 `approval.ts`，remember 按首句/补充保存带 UUID、标签、来源及可选期限的长期条目；recall 读取 general、指定会话和按关键词启用的审批库，按 3/2/1 打分及创建时间排序，只返回关键点、来源和 UTC 日期。`registerJarvisTools` 沿用 textOutput 注册两工具，COMMANDER_PERSONA 加入使用指令，同步 SPEC 和存储接口文档；未修改 M1 存储实现或其他条目。
  - 边界决定：空白 content/query 拒绝，空白 session/general 写通用库，其他会话 id 原样传给存储层，approvals 保留；tag 默认 note。按中文句末标点、英文 !/?、后接空白/结尾的句点（含闭引号）及换行拆首句，detail 由存储层截到 500 码点。expiresDays 允许非负有限小数，0 立即到期；limit 默认5，向下取整后限0–10（0无结果、11取10），非有限值拒绝。英文不分大小写，空白/标点切词，汉字逐字切分并去重；无命中不返回，到期时刻起跳过。单个损坏/读失败文件跳过，目录级 I/O 错误抛出，不把写失败报成“记住了”。J3 HTML 只读投影为“批准/拒绝 + 工具/命令”关键点（最多160码点）、审批标签及源会话；完整参数/上下文仅参与检索，不回传。
  - 三段式测试新增 **28 项**，含真实 apply 注册、人设与 textOutput 接线、中英文混合分词、打分/新旧排序、0/11 limit、到期边界、并发写不覆盖、审批转义/损坏、空库及 I/O 异常。插件 **374/374**、面板 **222/222**、`npm run build`、`macos/build.sh`、`git diff --check` 全通过，独立审查无合并阻断。标签 `m2-remember-recall-20260924` 定位单个实现提交；合回 main 后主目录重建插件，需用户重启 DSH 并运行 `npm run smoke`，面板代码未改无需单独重启。人工验收：说“记住用中文回复”，再询问此前约定；分别验证指定会话记忆与审批历史检索。

### M3 自动抓取 temp（pass A）

- **监听**：`session/event`，只对托管会话和贾维斯自己。
- **记什么**（一行一条 JSON，带 `session`、`at`、`type`）：
  - `user/message`：文本前 500 字。
  - `assistant/message`：只记最终文本块前 800 字（不记推理、不记工具调用参数）。
  - `tool/result`：只记工具名和是否出错，不记输出。
  - `turn/end`：reason.kind。
- 写入走 `store.appendTemp`，异步、失败只记日志；单个会话单日文件超过 2 MB 停止追加并记一条 `truncated`。
- **测试**：事件到记录的映射（纯函数 `toTempRecord(event)`）三段式；超限截断边界；未知事件类型返回 null。
- **实现记录**（Codex M3 / 2026-09-24）：确认 M1 已在 main，从最新 main 建 `codex/m3-temp-capture` 独立 worktree。新增 `src/memory/capture.ts` 的纯白名单映射与容错抓取；`src/index.ts` 仅对当前托管会话及配置的贾维斯自身异步调用，不等待写盘，失败只写 debug。user 顶层文本合并后截500码点、assistant 只取最后一个文本块前800码点（跳过 interrupted 前缀），tool 只记工具名/isError，turn/end 只记 reason.kind；不拷贝原事件、工具参数/输出、推理、stream、附件或其他元数据。同步 SPEC 与存储接口文档。
  - 宿主适配决定：at 使用 SessionEvent.time，session 由 appendTemp 补入。实际 tool/result 没有工具名，使用 source.callId 和 toolCallId 校验后，在同轮已提交事件里查 tool/call.name；TOOL_NOT_STARTED 可无 tool/call，此时从 assistant/message 匹配 tool-call 块仅取 id/name，绝不读取 arguments/text/reasoning。纯映射可选 toolName 参数只接受该适配结果；无匹配、未知/非法事件或空文本跳过。移出托管后只停止新事件，已接受的异步写继续完成；不往 DSH 会话日志写自定义事件。
  - 容量决定：`MemoryStore.appendTemp` 同一会话写锁内检查 UTF-8 JSONL 字节数，2 MB 按 **2 MiB（2,097,152字节）**；预计追加后恰好等于上限允许，超过则改写单个 `{session,at,type:'truncated'}`，该标记允许少量越界。当日标记后不再追加，从文件尾识别标记以跨实例/重启去重；残缺尾行先补换行，UTC 次日与其他会话独立恢复。此方案比“先追加到超过上限”更严格，避免超大单条突破限制；原已超限文件保留原内容并只补标记。
  - 新增 **31 项**三段式测试，覆盖真实事件结构与工具名关联、禁止字段 getter、500/800 Unicode 边界、真实 apply 过滤/托管变更/异步容错、容量±1字节、并发竞争、单次截断及失败恢复。插件 **405/405**、面板 **222/222**、`npm run build`、`macos/build.sh`、`git diff --check` 全通过，独立审查含 TOOL_NOT_STARTED 路径复验无阻断。标签 `m3-temp-capture-20260924` 定位单个实现提交；合回 main 后主目录重建插件，需用户重启 DSH 并运行 `npm run smoke`。面板代码未改，无需单独重启；人工可在托管会话完成一轮带工具操作，核对 temp 对应日文件仅含上述摘要字段，未托管会话不生成记录。

### M4 处置分类器（pass B）

- **触发**：J2 判断完成后（复用同一个 `reply`，别重复读），对该轮做一次处置。无 `llm` 时跳过。
- **流程**（§10.2）：
  1. 规则护栏先过：工具原始输出一律丢；用户消息里出现"记住/以后都/我喜欢/别再"之类偏好措辞的直接进长期。
  2. 其余交给模型：输入 = 原始需求 + 本轮最终回复 + 该会话最近 20 条 temp。要求输出 JSON 数组，每项 `{key, destination: 'discard'|'temp'|'long'|'ask_jarvis', scope: 'general'|'session', confidence: 0-1, expiresDays?}`。
  3. 执行：`long` 直接 `writeLong`；`ask_jarvis` 汇总成一条 notice 用 `deliver` 发给贾维斯（"建议你记住：…"），由贾维斯自己决定是否 `remember`；`temp` / `discard` 只在 temp 里给对应记录打标（追加一条 `{type:'disposition', …}`，不改原行）。
  4. `confidence < 0.6` 一律按 `temp` 处理（§10.2 低置信默认留 temp）。
- **可调**：规则关键词和提示词放在 `src/memory/classifier.ts` 顶部常量，J6 可暴露到设置页。
- **测试**：规则护栏、JSON 解析（含非法 destination、置信度越界、空数组）、低置信降级、无 llm 跳过。
- **实现记录**：（空）

### M5 固化 / 长期清理 / 归档（pass C、E、F）

- **固化 C**：触发条件任一：某会话 temp 超过 500 行；每天首次启动；用户说"整理记忆"（贾维斯调新工具 `consolidate_memory`）。读该会话中打了 `temp` 标且超过 24 小时的记录，交模型判"还有没有长期价值"，有的写长期（general 或会话），然后把已处理的日期文件整体删除（当天文件不删）。
- **长期清理 E**：每天一次，删 `expires` 已过的条目；同 tag 且 key 高度相似（归一化后相同）的只留最新一条。
- **归档 F**：会话闲置超过 `archiveIdleDays`（已有配置，默认 7）或被 DSH 归档（`archivedSessionIds`）→ 对它跑一次 C，清空其 temp 目录。
- 所有 pass 在写锁下执行，失败不影响主流程；用 `setTimeout(...).unref()` 调度，插件卸载时清掉定时器。
- **测试**：触发条件判定（纯函数）、相似去重、过期删除边界（恰好到期）、归档会话识别。
- **实现记录**：（空）

### M6 长期记忆注入贾维斯人设（L1）

- 在 `decorateJarvisAgent` 里再注册一个 section：`name: 'jarvis:memory'`，`order: 60`，`text: () => 最近 20 条 general 长期的 key 列表`（按创建时间倒序，总长不超过 1500 字）。
- **缓存稳定**：内容只在 general 长期变化时才变（`store` 维护一个 version，section 文本按 version 缓存），不做按 query 的 top-K（§10.3：会破坏缓存前缀）。
- **测试**：截断边界、空库时返回空串（section 不显示）、version 不变时返回同一字符串实例。
- **实现记录**（Codex M6 / 2026-09-24）：新增 `src/memory/section.ts`，仅注入 general 长期最新 20 条 key，创建时间倒序、同时间按 id 稳定排序，含标题和列表符总长不超过 1500 Unicode 码点；空库返回空串。`MemoryStore` 对成功的长期写入/实际删除递增共享 version，`snapshotLong` 在同一读锁内返回版本与内容；section 按版本缓存并合并并发刷新，版本不变不读盘、不重排，读取失败保留旧缓存并下次重试。`src/index.ts` 在贾维斯作用域注册 order 60 的 `jarvis:memory`；同步 section provider 配合宿主异步 assembly waterfall 刷新，确保首次组装和 remember 后下一次组装即生效。记忆中 `{{…}}` 经 literal variable 保留原文，避免宿主模板展开或报错；同步更新 `SPEC.md` 与 memory README。
  - 边界决定：空白 key 和损坏 HTML 跳过，key 内换行折为空格；过期记录仅在初次加载或版本变化重建时过滤，单纯时间流逝不改变同版本文本，严格保持缓存前缀。version 为进程内、按规范化 store 路径共享；调用方使用 `writeLong/removeLong` 才会通知失效，手工改磁盘文件需重载。JavaScript 字符串是原始值，使用严格相等和 snapshot 调用次数验证原样返回与不重读。真实 DSH 的 section provider 不支持 Promise，因此采用 scoped assembly hook 等待刷新，是对条目示意接线的适配。
  - 验证：新增纯逻辑及真实 `apply()` 接线测试 23 项，按等价类 / 边界值 / 异常路径分组，覆盖 20 条、1499/1500/1501 码点、空库、版本隔离/跨实例、锁内快照、失败重试与模板字面量。插件 428/428、面板 222/222、`npm run build`、`macos/build.sh`、`git diff --check` 均通过；独立审查无阻断问题。表格标签 `m6-memory-section-20260924` 定位单个实现提交。合入主目录重新构建后需用户重启 DSH 并运行 `npm run smoke`，手动验收 general remember 后下一轮可使用该记忆、per-session 内容不注入；面板代码未改，无需单独重启。

## 5. 条目详情：设置、提问拦截、清理、验收

### J6 DSH 设置页

- 用 `ctx.settings.installSection(ctx, 'jarvis', schema, entry, hooks)` 注册，替换 `src/index.ts` 里 `// TODO §2: installSettingsSection`。
- **暴露的字段**：`provider`、`model`、`edgeVoice`、`greetings`、`judgeEnabled`、`judgeProvider`、`judgeModel`、`maxContinueRounds`、`askInterception`（J7）。
- 用 `watch` 让 judge 相关字段即时生效；`provider`/`model` 改动只影响下次创建的贾维斯 agent（在设置说明里写明"重启 DSH 生效"）。
- 没有设置服务时一切照旧（installSection 自带降级）。
- **测试**：把"配置合并/校验"抽纯函数测三段式（非法 maxContinueRounds 负数、超大值、空 provider 回退默认）。
- **实现记录**（Codex J6 / 2026-09-24）：`src/settings.ts` 提供纯配置归并与数值校验；`src/index.ts` 从现有 Config 派生九字段 SettingsSchema，在可选服务注入中调用 `settings.installSection(ctx, 'jarvis', …)`。核对本机 DSH 实现后直接使用其内置 watch、持久化读取与服务卸载回退，不另建监听。初始持久化 provider/model 在 agent 创建前读取；创建开始后锁定当前模型，页面注明重启生效，judge 留空时仍跟随当前 agent。五个 judge 字段下一次判断生效；内置 edgeVoice 下一次播报生效，缓存键加入音色防止复用旧声线。同步 SPEC 与源码状态说明。
  - 边界决定：字段以实际 Config 为准，补入 judgeTimeoutMs，尚无 askInterception 因而留待 J7；不暴露路径或会话身份。判断超时为 1000–120000 毫秒整数，续做上限为 0–10 整数；非法值回退不可变插件配置，空 provider/model/edgeVoice 也回退。judge 空字段允许清除覆盖，greetings 空数组允许清除附加欢迎语。服务缺失、旧接口、安装异常均继续运行；读取异常保留上次有效值，插件卸载后的回调忽略。服务晚到时即时字段生效，模型待重启；服务卸载时即时字段回退插件配置。音色文案明确仅控制 voice-mini 不可用时的内置语音。
  - 验证：新增 37 项等价类 / 边界值 / 异常路径测试，覆盖真实 apply 接线、初始与延迟服务、卸载回退、运行中模型稳定、judge 开关/提供方/模型/续轮与超时、音色切换及缓存隔离。插件 **484/484**、面板 **258/258**、`npm run build`、`macos/build.sh`、`git diff --check` 全通过，独立审查无阻断。标签 `j6-settings-20260924` 定位单个实现提交；合入主目录重建后需重启 DSH 并运行 `npm run smoke`，人工验收设置页保存/重启保留、即时判断设置及模型重启生效；面板代码未改，无需单独重启。

### J7 拦截托管会话的提问（默认关）

- **规格**（§8）：托管会话调用 ask_user_question 时，低风险的从上下文直接答，拿不准再转给你。
- **实现**：在现有 `user-questions/request` 监听里，当 `askInterception=true`、会话是托管的、且问题带选项时：
  1. 调 `oneShot`，输入 = 问题 + 选项 + 任务原始需求 + `recall` 到的相关记忆；要求输出 `{choice: "选项原文"|null, confidence}`。
  2. `confidence ≥ 0.85` 且 choice 是合法选项 → 直接返回答案，并 `deps.say('{会话名}问了{问题}，我替你选了{choice}')`，同时写一条 temp 记录。
  3. 否则走现有转发（`live.holdAsk`）。
  4. 无选项的开放问题一律转发。
- **默认关**：替用户做决定有风险，必须用户在设置里主动打开。
- **测试**：阈值边界 0.85、choice 不在选项里、无 llm、超时 → 全部回落到转发。
- **实现记录**（Codex J7 / 2026-09-24）：新增纯模块 `src/ask-intercept.ts`，`src/index.ts` 在现有 user-questions/request 转发前接入；Config / 设置页增加默认关闭的 askInterception，实时开关沿用 J6。仅托管 worker 的有选项问题调用 oneShot，输入问题/选项、任务原始需求和 scoped recall；严格 JSON、原文选项精确匹配、数值置信度 0.85–1 才接受，失败保持原请求交给 live.holdAsk。复用 judgeProvider/judgeModel 和 judgeTimeoutMs，后者覆盖整个请求的检索及模型调用；无模型、读记忆异常、超时、非法输出均回退。
  - 边界决定：多题最多四题，整批全成功才代答，任一不确定整批转人工；重复题 id/选项、空白或非法结构、明确审批/review intent 直接转发。原问题结构及每次完整模型输入上限 16000 字符，超限转发，不截断任务约束；提示将外部内容视为不可信数据，高风险和无依据的决定返回 null。返回前再次检查开关、托管、任务、问题及取消状态，复查异常同样回退；卸载中止在途推理，已取消请求直接走宿主 next，不新增面板等待项。
  - 成功先返回宿主 answers/id/selected，再以 setImmediate 独立播报并写 worker temp 的 question/auto-answer；只保存问题/选项各前 500 码点、置信度、问题/任务 id，不写推理、检索全文或 DSH 自定义事件。播报/写入失败仅记日志，不改变已返回结果。新增 38 项三段式测试；插件 **522/522**、面板 **258/258**、`npm run build`、`macos/build.sh`、`git diff --check` 均通过，独立审查复验无阻断。标签 `j7-ask-intercept-20260924` 定位单个提交；合入主目录重建后需用户重启 DSH 并运行 `npm run smoke`，人工验收默认仍转发、显式开启后已知低风险选择题代答及不确定时转人工。面板代码未改，无需单独重启。

### J8 清理

- `src/index.ts` 顶部文件注释还写着 "execute bodies / TTS / answerer / memory / 悬浮窗 routes are STUBS"，按现状重写。
- `GET /jarvis/sessions` 返回里残留 `monitoring` 字段，删掉（确认面板 `JarvisClient` 不读它）。
- `SPEC.md` §8、§13：按 J2 实际实现同步——续轮走"轮次结束 → 判断 → ask_user → 投递新消息"，不用 `agent/turn-stopping`（J2 已删除该空钩子）；`ask_user` 新增可选 `session`/`task` 参数。
- `SPEC.md`：§7 工具表去掉 `monitor_session` / `stop_monitoring`（改由 J1 台账 + J2 事件桥隐式完成），`recall`/`remember` 标注"见 backlog M2"；§8 触发条件改为"托管 + 台账有未结任务"。
- UI 规格文档 §6.1 补充：目标列表只列托管会话，底部"＋ 交给贾维斯…"展开候选，行悬停出现"移出"按钮；§8 数据接口补 `/jarvis/wait`、`/jarvis/managed`、`/jarvis/messages?session=`。
- **实现记录**（Codex J8 / 2026-09-24）：确认 J1/J2 及阶段 2 的 J5/J4/J0/J3/U2 均已在 main 后，从 main 建 `codex/j8-cleanup` 独立 worktree。`src/index.ts` 更新过期文件头和转发注释，删除 `/jarvis/sessions.monitoring`；确认面板 `JarvisClient` 只从 state 读取会话、不消费旧字段。`SPEC.md` 与 UI 规格同步实际创建/标题、台账/判断/续轮、输出协调、voice-mini 让出、审批异步原子记录、托管选择及 U2 任务徽标/API；明确记忆、DSH 设置、自动答疑等仍为后续设计。
  - 范围决定：为消除同一文档内矛盾，同时修正 §3/§5/§9/§10.1/§11/§12 等关联旧描述，未改任何其他条目的状态或实现记录；除指定残留字段外不改变运行行为，保留并记录 judgeEnabled=false 的既有播报边界与 query token 兼容现状。新增 4 项真实路由回归测试，按等价类 / 边界值 / 异常路径覆盖集合变更、空集合、任务生命周期和未授权访问，先失败后通过；插件 249/249、面板 217/217、`npm run build`、`macos/build.sh`、`git diff --check` 全通过，独立审查问题已修正。标签 `j8-cleanup-20260924` 定位单个实现提交；合入后主目录重建插件，需用户重启 DSH；面板代码未改，无需单独重启。人工可核对托管目标选择、任务徽标和续做提问仍照常工作。

### Q1 真机验收清单（人工，由用户执行）

- [ ] CPU：待机时 `jarvis-panel` 占用 < 3%，播报时 < 10%（活动监视器看 1 分钟）。
- [ ] 打开启动台 / 全屏应用时光球自动隐藏，退出后恢复。
- [ ] 快捷输入框里用中文输入法打字：候选框位置正确，回车选词不会误发送。
- [ ] 光球以外的透明区域点击能穿透到下层窗口。
- [ ] 拖到屏幕边缘吸附不卡顿。
- 发现问题记到本条「实现记录」，维护人拆成新条目。
- **实现记录**：（空）

## 6. 条目详情：面板体验

### U1 面板显示播报字幕

- **目的**：§12 要求面板显示"贾维斯在说什么"。现在 `/jarvis/state` 的 `voice` 只有 `speaking/source/sessionId`，没有文字，嘈杂环境或静音时用户不知道他说了什么。
- **数据链路**：
  1. voice-mini（`../dsh-voice-mini/src/index.ts`）：`SpeechSignal` 加可选字段 `text`，`reportSpeech(item)` 在 `phase:'start'` 时带上 `item.text`（播报的原文，已经过 `scrubForSpeech`）。纯提示音（chime，text 为空）不带。
  2. 贾维斯 `src/live-state.ts`：`SpeechSignal`、`Speech` 加 `text?: string`；`speechSignal(raw)` 校验为字符串、去首尾空白、截断 120 字；`speech()` 返回时带上。
  3. 内置 TTS 分支（没装 voice-mini 时 `speakAsJarvis` 走 edge-tts + afplay）：播放前后调用 `live.speechSignal({phase:'start'/'end', id, source:'jarvis', text})`，让两条路径表现一致。
  4. `/jarvis/state` 的 `voice` 加 `text`（仅 speaking 时有）。
  5. 面板 `Snapshot.swift`：`VoiceState` 加 `text: String?`，与 `source` 一样只在 speaking 时保留；旧宿主没有该字段时为 nil。
- **界面**：
  - 说话时在光球旁显示一行字幕气泡（最多两行，超出省略号），颜色跟随说话来源（青 = 贾维斯，紫 = 其他会话），其他会话说话时前缀会话名（用 `PanelModel.label(for:)` 的消歧名称）。
  - 播报结束后保留 1.5 秒再淡出；新一句到来直接替换。
  - 快捷输入框打开时字幕显示在输入框上方的历史区域顶部，不另开气泡，避免遮挡。
  - 面板设置加开关 `showCaptions`（默认开），放在 `PanelSettings` 里持久化。
  - 系统"减少动态效果"时不做淡入淡出，直接显隐。
- **测试**：
  - 插件：`speechSignal` 的 text 处理（正常、恰好 120 / 121 字、空白串、非字符串、缺失）。
  - 面板 Core：`VoiceState` 解码（有 text、没 text、非 speaking 时 text 被丢弃、text 类型错误）；字幕显示逻辑抽成纯函数 `caption(for voice, now, lastEnd) -> Caption?`，覆盖 1.5 秒保留边界、来源切换、关闭开关。
  - 快照：`Snapshotter` 加场景 `16-caption-jarvis`、`17-caption-session`，DemoAPI 的 narrating 场景补上 text。
- **注意**：跨仓库改动，voice-mini 单独提交；voice-mini 未更新时面板只是不显示字幕，不能报错。
- **实现记录**（Codex U1 / 2026-09-24）：voice-mini 的每条播报 start 和缓存重播传递 `text`，end 不重复携带文字，提示音保持无字幕。贾维斯 `LiveState` 按 Unicode 码点 trim / 截断 120 字，`/jarvis/state` 仅在 speaking 时带文字；内置 TTS 在合成成功后、播放前发 start，并通过播放 Promise 的 finally 发匹配 id 的 end，覆盖播放结束和启动/异步失败，不等待音频完成阻塞工具返回。Swift 容错解码，独立 `CaptionState` 维护结束后 1.5 秒保留，`PanelModel` 定时清除、断线退场，并复用会话名消歧；青/紫两行气泡不参与鼠标命中，输入开启时放在历史区域顶部，设置立即应用且持久化，系统减少动态效果时字幕直接显隐。
  - 边界决定：新一句无 text（旧 voice-mini 或空白文本）立即清掉旧句，避免来源错配；连续空闲轮询不延长保留期，恰好 1.5 秒消失。voice-mini 的 assistant narration 路径已 scrub，字幕直接复用实际队列原文；`/test`、工具等既有路径并非全部 scrub，保持其现有播报行为，不额外修改或二次 scrub，仅透传实际播放文字。贾维斯内置路径沿用现有异步返回行为，静音/合成失败不发字幕，旧播放结束不能清除较新字幕。
  - 验证：三段式新增插件 19 项、Swift 11 项；插件 **447/447**、Swift **233/233**、两仓 `npm run build`、`macos/build.sh`、`git diff --check` 全过。voice-mini speech **46/46**（含新增 5 项）、Jarvis voice 双语言 **2/2**、pause **8/8**、queue-clear **7/7**、`npm test` 全过；关键字幕与路由回归已确认基线红灯、修改后绿灯。快照实际生成并用图像工具打开确认：[16-caption-jarvis.png](../evidence/2026-09-24-u1-captions/16-caption-jarvis.png)、[17-caption-session.png](../evidence/2026-09-24-u1-captions/17-caption-session.png)。
  - 两仓均在独立 `codex/u1-captions` worktree 实现，voice-mini 单独英文提交；本仓表格标签 `u1-captions-20260924` 定位单提交（整合后由主会话打标签）。由主会话 review / 串行合入后重建并重启面板；需用户重启 DSH 加载两插件并运行 `npm run smoke`，人工检查真实播放、输入开启、字幕开关及系统减少动态效果。旧 voice-mini 脚本测试曾覆盖 runtime 发现文件，主会话已恢复当前 origin/pid/rendererHeader 并保留 token；确认 NO_PERSIST 阻止配置写入，后续测试显式隔离 runtime/config 路径。

### U2 目标列表显示任务进度

- **目的**：交给贾维斯的任务现在处于什么状态，面板上看不到。J1/J2 有了任务台账和判断结果后，在目标列表里显示出来。
- **数据**：`/jarvis/state` 的每个 session 行加 `task`：`{ status: 'open'|'judging'|'unsatisfied', summary?: string }`，只输出未结任务（done/dropped 不输出）。`summary` 取 `lastVerdict.missing` 或请求原文前 30 字。
- **面板**：`SessionInfo` 加 `task: TaskInfo?`（解码容错：缺失或类型错误为 nil）。目标列表行在标题右侧显示小标签："进行中" / "判断中" / "未完成"（未完成用黄色），悬停显示 summary。
- **测试**：插件侧 state 行组装抽纯函数测试；面板侧解码与标签文案三段式；快照加 `18-targets-task-state`。
- **实现记录**（Codex U2 / 2026-09-24）：`src/session-state.ts` 抽出纯会话行组装，`src/index.ts` 经只读 `ledger.peekCurrent` 输出未结 task，避免状态轮询顺带写盘；`Snapshot.swift` 增加 `TaskInfo` / 标签文案，`PanelModel.swift` 传给目标项，`QuickBarView.swift` 在标题右侧显示三态标签、黄色未完成及悬停摘要。`DemoAPI.swift` / `Snapshotter.swift` 新增 `18-targets-task-state`，覆盖三态、有任务长标题及无任务行。
  - 边界决定：非空白 missing 优先，否则原文按 Unicode 码点取前 30 字，保留原文空白，空摘要省略；done/dropped/过期任务均不输出。面板对缺失/null task、未知状态、错误容器或字段类型均降级为 task=nil，summary 缺失/null 仍保留合法任务。原有会话状态、快捷键和目标选择行为不变。
  - 验证：插件纯函数及真实 `/jarvis/state` 接线、Swift 解码/标签/目标选择/演示移出行为均按等价类 / 边界值 / 异常路径测试；插件 **245/245**、面板 **217/217**、`npm run build`、`macos/build.sh`、差异检查通过，独立规格与质量审查无待修问题。快照生成后已用图像读取工具实际打开确认三态完整、黄色正确、长标题截断与快捷键正常，证据：[18-targets-task-state.png](../evidence/2026-09-24-u2-task-state/18-targets-task-state.png)。
  - J1/J2 已在 main，从最新 main 建独立 worktree 与 `codex/u2-task-state`；标签 `u2-task-state-20260924` 定位含本记录的单个提交。合入后主目录重建插件/面板并重启面板；仍需用户重启 DSH 加载插件字段，再人工观察判断中→未完成/任务结束时的标签更新及悬停摘要。

### H1 全局快捷键呼出输入框

- **目的**：不用找光球，在任何应用里按快捷键就能给贾维斯打字。
- **实现**：
  - 用 Carbon `RegisterEventHotKey`，**不要**用 `NSEvent.addGlobalMonitorForEvents(.keyDown)`（后者需要辅助功能权限，前者不需要）。
  - 新文件 `macos/Sources/JarvisPanel/HotKey.swift` 封装注册/注销；纯逻辑放 Core：`HotKeySpec { keyCode, modifiers }`，支持与显示字符串互转（如 `"⌃⌥J"`），存到 `PanelSettings.hotKey: String?`（nil = 用默认值）。
  - 默认 `⌃⌥J`（⌥Space、⌃Space 常被输入法占用）。设置页加录制控件：点一下后按下新组合即保存；注册失败（被别的应用占用）时在设置页提示"快捷键被占用"并保留旧值。
  - 行为：输入框关着 → 打开并聚焦输入；开着且聚焦 → 关闭。
  - 光球因全屏/启动台/隐藏应用而隐藏时，按快捷键**仍然打开**输入框（用户明确要用）。需要在 `VisibilityPolicy` 里加"输入框打开时强制可见"，关闭后恢复原规则。
- **测试**：`HotKeySpec` 解析与格式化（等价类：单修饰键/多修饰键；边界：无修饰键应拒绝、F 键、数字键；异常：空串、未知符号）；`VisibilityPolicy` 强制可见的组合情况。
- **实现记录**（Codex H1 / 2026-09-24）：新增 Core `HotKeySpec` / `HotKeyBinding` 与原生 `HotKey` / `HotKeyRecorder`；设置保存可选 `hotKey`（nil 默认 `⌃⌥J`），使用 Carbon 独占注册，候选成功后才释放旧注册；失败保留原组合并显示“快捷键被占用”。录制控件只接收自身焦点事件，Esc/失焦取消，无全局键盘监听或辅助功能权限；当前已注册组合由 Carbon 回调交还录制器。输入热键同步打开并解除隐藏，已聚焦关闭、未聚焦重新聚焦；`VisibilityPolicy.inputOpen` 优先显示，关闭恢复原策略。退出/析构释放注册和 handler，快照模式不注册。
  - 边界决定：显示标签按 ANSI 物理键位，不随输入法变化；至少一个 ⌃/⌥/⇧/⌘，支持字母、数字、F1–F20 及常见控制键；无效旧配置回退默认，冲突判定依 Carbon 注册结果。新增 25 项三段式测试，其中 10 项通过 native XCTest 直接验证 Carbon 生命周期、跨进程独占冲突、设置失败保留和录制焦点。`node --test tests/*.test.ts` 447/447、`cd macos && swift test` 258/258（无跳过）、`npm run build`、`macos/build.sh`、`git diff --check` 通过；独立审查无阻断；已 rebase 到包含 U1 的 `e7117c9` 并重新完成全量验证，保留字幕与快捷键两组设置及接线。
  - 交付验收：需重新启动面板使快捷键生效，单独 H1 不需重启 DSH；跨应用/全屏/启动器/指定隐藏应用中按快捷键输入、再次关闭恢复隐藏，以及实际设置录制冲突提示仍需用户真机验收。H1 分支由主会话统一整合、重建与重启；表格标签在整合后创建。

## 7. 条目详情：语音输入

> 规格 §6 原计划在 DSH 宿主端做语音识别，需要 `danger-full-access`，和"不开高危权限"冲突，所以放到了以后。面板现在是原生 macOS 程序，可以直接用系统的本机语音识别（Speech 框架），麦克风权限由系统授权，**不需要给 DSH 开任何高危权限**。这是推荐路线，但有打包问题要先验证（S0）。

### S0 语音输入技术验证

- **要回答的问题**：
  1. 面板是 SwiftPM 编出的裸可执行文件、由插件 `spawn` 启动（没有 .app 包）。调用 `AVAudioEngine` 录音时，系统麦克风授权弹窗会不会出现？授权记在谁名下（DSH 还是 jarvis-panel）？
  2. `SFSpeechRecognizer.requestAuthorization` 要求 Info.plist 里有 `NSSpeechRecognitionUsageDescription`，否则进程直接崩溃。裸可执行文件能否通过链接参数嵌入 Info.plist（`linkerSettings: .unsafeFlags(["-Xlinker","-sectcreate","-Xlinker","__TEXT","-Xlinker","__info_plist","-Xlinker","Resources/Info.plist"])`）解决？
  3. 用户这台机器上 `SFSpeechRecognizer(locale: zh-CN).supportsOnDeviceRecognition` 是否为 true；设 `requiresOnDeviceRecognition = true` 后识别质量和延迟如何（录 3 句普通话、1 句中英混杂的技术术语）。
- **做法**：给面板加隐藏启动参数 `--stt-probe`：申请权限 → 录 5 秒 → 本机识别 → 把每一步结果写到 `~/.dsh/jarvis/stt-probe.log` 后退出。分别在"终端直接运行"和"由插件启动"两种方式下各跑一次。
- **产出**：在本条「实现记录」写清三个问题的答案，并给出 S1 走哪条路：
  - A：面板内直接用 Speech 框架（嵌入 Info.plist 即可）。
  - B：把面板打包成 `.app`（`build.sh` 生成 bundle，插件改用 `open -a` 启动），权限记在 jarvis-panel 名下。
  - C：本机识别不可用时，退回规格原方案（宿主端 SenseVoice/whisper），需要用户同意开权限，维护人会先和用户确认。
- **注意**：探针代码验证完就删掉，不要留在正式构建里（Info.plist 嵌入如果走 A 路线则保留）。
- **实现记录**：（空）

### S1 按住说话

- **前置**：S0 结论为 A 或 B；H1（复用快捷键机制）。
- **触发**：
  - 按住语音快捷键（默认 `⌃⌥K`，可在设置里改）说话，松开结束。
  - 输入框里加一个麦克风按钮：点一下开始，再点一下或静音 2 秒自动结束。
  - 不做光球长按（和拖动冲突）。
- **流程**：
  1. 开始：如果贾维斯或 voice-mini 正在播报，先调 `POST /jarvis/voice {action:'pause'}` 暂停，避免把自己的声音录进去；结束后恢复（只恢复自己暂停的，用户本来就暂停的不动）。
  2. 录音中：光球进入"聆听"表现（复用 awaiting 外观 + 把音量 RMS 喂给 `ParticleSim` 的能量参数）；输入框实时显示识别中的文字（partial results）。
  3. 结束：最终文字填进输入框，**默认不自动发送**，用户按回车确认（设置 `voiceAutoSend` 默认关，可打开）。目标沿用当前选中的对话对象。
  4. Esc 取消，丢弃文字。
- **限制**：单次最长 60 秒；按下后不到 200 毫秒就松开视为误触，忽略；识别结果为空时提示"没听清"。
- **隐私**：只在按住期间录音；音频不落盘；`requiresOnDeviceRecognition = true`，不支持本机识别时报错提示，**不回退到云端识别**（见决策 D5）。
- **Core 纯逻辑**：`DictationMachine` 状态机：`idle → requesting → listening → finishing → idle`，外加 `denied`、`failed`。事件：press、release、partial、final、error、cancel、timeout。
- **测试**（Core 三段式）：
  - 等价类：正常按住-说话-松开；点按模式；自动发送开/关。
  - 边界：199/200 毫秒误触阈值；恰好 60 秒超时；静音 2 秒边界；空识别结果。
  - 异常：权限被拒；识别中途出错；录音中切换目标（文字保留，发给新目标）；录音中输入框被关闭（取消录音并恢复播报）。
- **实现记录**：（空）

## 8. 条目详情：分级自动审批（Phase-2）

> 规格 §11 Phase-2。核心原则不变：**贾维斯永不自动批准高危操作**；整个功能默认关闭，用户在设置里主动打开。

### P0 审批"总是允许"预设

- **目的**：给用户一个明确的放行出口（规格里的 preset），也是 P1 判断时的最高依据。
- **界面**：面板审批卡片在"批准 / 拒绝"之外加一个次级按钮"总是允许（此工作区）"。点击 = 本次批准 + 写一条预设。
- **协议**：`POST /jarvis/pending/answer` 的 `decision` 新增 `'always'`；插件按 allow 处理，并调用 `presets.add(...)`。
- **存储**：`~/.dsh/jarvis/memory/preferences/approvals.json`（结构化 JSON，不用 HTML，便于精确匹配）：`[{ fingerprint, tool, workspace, createdAt, expiresAt? }]`。匹配规则：同 tool、同 workspace（cwd 完整路径）、fingerprint 完全相同。
- **管理**：贾维斯工具 `list_approval_rules` / `remove_approval_rule`；面板设置页列出预设并可删除。
- **护栏**：P1 的高危分类命中时**不允许**创建预设（按钮不显示），避免"总是允许 rm -rf"。
- **测试**：匹配（同指纹不同工作区不命中、过期不命中）、写入失败不影响本次批准、高危时按钮隐藏（面板 Core 纯逻辑）。
- **实现记录**（Codex P0 / 2026-09-24）：`src/approval-presets.ts` 复用 MemoryStore 的 `preferences` 读写锁和原子替换，保存规定的 JSON 数组；提供严格三元组匹配、到期排除、重复项替换和精确删除，损坏文件不静默覆盖。`index.ts` 接入 `decision: always`、列表/删除路由与同名贾维斯工具（沿用 textOutput）；LiveState 只对赢得竞答的面板操作触发保存，先返回本次 allowed-once，再 setImmediate 写预设及原有 J3 记录，写失败不改变审批结果。无自动审批行为，P1 仍待实现。
  - 护栏决定：`approval-risk.ts` 在显示按钮、点击与写锁内均使用完整操作检查；高危或无法可靠判定时不显示按钮，伪造 always 返回 400，普通批准/拒绝仍可用。P0 暂只接受明确支持的工具、简单命令、子命令和选项；复杂 shell、未知选项、全局安装、用户配置写入、缺失/变更 cwd、含 `..` 的路径、悬空/越界符号链接均保留逐次审批。指纹沿用 J3 的规范化，不等价于原始命令字节相等；未来 P1 使用匹配接口时仍必须执行完整操作高危否决。
  - 面板新增可选能力字段（缺失/非法默认隐藏）、“总是允许（此工作区）”按钮、Core ApprovalRulesModel 和设置列表/删除；打开设置即刷新，错误可重试，404 删除刷新权威列表。新增快照 `19-approval-presets`，已生成并打开 `/tmp/p0-presets-snapshots/19-approval-presets.png` 确认普通/高危/提问卡片按钮与布局正确；同步 SPEC §11 及 UI 规格的 P0 行为和接口。
  - 验证：按等价类 / 边界值 / 异常路径新增插件 80 项、面板 22 项；`node --test tests/*.test.ts` 602/602、`cd macos && swift test` 280/280、`npm run build`、`macos/build.sh`、`git diff --check` 均通过。测试覆盖返回前无预设 I/O、竞答失效/取消、异步写失败、并发读改写、过期边界、跨工作区不匹配、高危绕过和真实 HTTP/工具接线。合入后主目录重建并重启面板；用户仍需重启 DSH，验收普通审批保存/设置删除、高危卡片无按钮，再运行 `npm run smoke`。单个实现提交由标签 `p0-approval-presets-20260924` 定位。

### P1 分级自动审批

- **新文件**：`src/approval-tier.ts`（纯）：`classify({ tool, command, path, cwd }) → 'safe' | 'grey' | 'medium' | 'high'`。
  - **safe**：只读工具（读文件、搜索、列目录）；bash 命令首词在白名单：`ls cat head tail wc rg grep find pwd echo which git(status|diff|log|show|branch)` 且不含重定向 `>`、管道到 shell、`;`/`&&` 串接其他命令。
  - **high**：`rm -rf`/`rm -r`、`sudo`、`git push --force`/`-f`、`git reset --hard`、`git clean -fd`、`chmod -R`/`chown -R`、`curl|wget … | sh/bash`、`mkfs`、`dd`、写入工作区之外的路径、`DROP TABLE`/`DROP DATABASE`、`kill -9 1`、`launchctl`、修改 `~/.ssh`、`~/.dsh` 配置。
  - **medium**：会写入或产生外部影响的：写文件、`npm/pnpm/pip install`、`git commit/push`（非 force）、`mv`、网络请求。
  - **grey**：以上都不命中的。
  - 规则表写成常量数组，便于 J6 设置页以后暴露。
- **决策**（`decide(req)`，在 `approval/request` 监听里 `holdApproval` 之前执行）：
  | 分级 | 自动审批关 | `autoApprove='safe'` | `autoApprove='safe+grey'` |
  |---|---|---|---|
  | safe | 转给你 | 直接批准 | 直接批准 |
  | grey | 转给你 | 转给你 | 模型判断：allow 且置信 ≥ 0.9 → 批准；deny → 转给你（附上理由）；其余 → 转给你 |
  | medium | 转给你 | 转给你 | 转给你；若命中 P0 预设或同指纹有 ≥2 次你批准且从未拒绝 → 批准 |
  | high | 转给你 | 转给你 | 仅命中 P0 预设才批准（P0 本身禁止高危预设，所以实际上永远转给你） |
  - 模型判断用 J2 的 `oneShot`，输入：操作、分级、会话任务上下文（J1 台账）、同指纹历史记录（J3 文件）。
  - **不会自动拒绝**，最坏情况是转给你（见决策 D6）。
- **可见性**：
  - 每次自动批准都写 J3 审批记录，`decision source="jarvis"`、`tier` 填分级。
  - grey 被自动批准时贾维斯播报一句（"替 hammer 批准了 npm test"）；safe 不播报。
  - 面板悬停层显示最近 5 条自动批准，可点"撤销此规则"（删除对应 P0 预设）。
- **配置**：`autoApprove: 'off' | 'safe' | 'safe+grey'`，默认 `'off'`，走 J6 设置页。
- **测试**（大量表驱动）：`classify` 每类至少 10 个正例与易混淆反例（如 `git push` vs `git push -f`、`rm file` vs `rm -rf dir`、`cat a > b`、`ls; rm -rf x`、`echo $(curl …|sh)`）；`decide` 覆盖上表每个格子；模型超时/非法输出一律转给你；写入工作区外路径的判断（符号链接、`..`、`~`）。
- **实现记录**（Codex P1 / 2026-09-24）：新增 `approval-tier.ts`、`auto-approval.ts`、`approval-history.ts` 和 `auto-approval-state.ts`，接入 J6 的 `autoApprove`（默认 off）及原审批竞答；高危先于预设/历史/模型直接转用户，绝不自动拒绝。safe 静默批准，grey 仅模型 allow 且置信 ≥0.9 放行并播报，medium 只接受 P0 预设或两次用户批准且无拒绝；异步 J3 写入 source=jarvis 和实际分级。面板悬停显示本次运行最近五条，精确撤销对应预设，同步 SPEC 与 UI 规格。
  - 边界决定：分类器使用保守 shell 子集；复杂语法、危险选项、全局安装和无法确定的写入路径均转用户，pip 只接受显式工作区内 --target。路径按组件检查符号链接，含 ..、悬空/越界链接及受保护配置目录均不放行。历史从 approvals 读锁快照读取，正向样本还须原始 command/args 一致，任一同指纹用户拒绝否决学习；损坏历史不提供批准依据。整个异步判断有超时；批准前重核设置、原始操作、任务和完整最新用户消息，防止等待模型期间改指令后采纳旧批准。面板兼容旧 host 缺少字段及非法单条数据，撤销 404 视为已移除，其他失败允许重试。
  - 验证：按等价类 / 边界值 / 异常路径新增插件 250 项（分类表 178 项，包含要求的易混淆命令）与 Swift 17 项；插件全测 852/852、Swift 全测 297/297、npm run build、macos/build.sh 与 git diff --check 通过。快照场景 `20-auto-approvals` 已生成并打开确认五条记录、分级和撤销入口；上下文竞态回归先红后绿，规格与代码复核后按单提交标签 `p1-tiered-approval-20260924` 定位。合回 main 后重建并重启面板；插件需用户重启 DSH 并运行 npm run smoke，再人工验收三档设置、灰区播报、高危转用户及撤销预设。


## 9. 条目详情：稳定性

### W1 面板崩溃自动拉起

- **问题**：插件 `spawnPanel`（`src/index.ts`）启动面板后，子进程退出只把 `panelChild` 置空，不会重启。面板一旦崩溃，要等下次重启 DSH 才会回来。
- **新文件**：`src/panel-supervisor.ts`（纯，时钟可注入）：`class PanelSupervisor`，`onExit(code, signal): { action: 'respawn'; delayMs } | { action: 'stay-down'; reason }`，外加 `markDisposed()`。
- **规则**：
  - 已调用 `killPanel`（插件卸载 / 重新 apply）→ 不拉起。
  - `code === 0` → 不拉起。面板的"退出"菜单走 `NSApp.terminate`（`AppController.swift`），退出码为 0；单实例保护 `exit(0)` 也是 0，避免和手动启动的面板互相拉起死循环。
  - 非零退出码或被信号杀死（我们自己发的 SIGTERM 除外）→ 视为崩溃，按 1 秒、5 秒、30 秒退避拉起。
  - 10 分钟内崩溃超过 3 次 → 停止拉起，写 debug 日志，并用 `deps.say` 播报一次"悬浮窗反复崩溃，已停止自动重启"。
  - 稳定运行 10 分钟后崩溃计数清零。
- **接线**：`child.on('exit', (code, signal) => …)` 调用 supervisor，按结果 `setTimeout(...).unref()` 再调 `spawnPanel`；卸载时清掉待执行的定时器。
- **测试**：三段式覆盖上述每条规则；退避序列边界（第 3 次、第 4 次）；10 分钟窗口边界；卸载后到达的 exit 事件被忽略。
- **实现记录**（Codex W1 / 2026-09-24）：新增纯 `src/panel-supervisor.ts`，通过可注入时钟决定 1/5/30 秒退避、正常退出保持关闭与崩溃上限；`src/index.ts` 按每次 apply 隔离 child/supervisor/timer，卸载先标记并清 timer 再发 SIGTERM，忽略旧实例与已替换 child 的迟到事件。同步 spawn 异常及异步 error 都按崩溃处理，error/exit 去重；第 4 次停止时仅调用一次 `deps.say` 播报指定提示。
  - 边界决定：使用滚动 10 分钟窗口，恰好 10 分钟前的崩溃记录过期；实际成功 `spawn` 时才记运行起点，稳定运行满 10 分钟清零，退避等待不计作稳定运行。重复 webServer 注入不重复启动，卸载或被新 apply 替换后的延迟注入不再启动面板；缺少二进制维持原有仅写日志行为。
  - 纯策略与真实 `apply()` 接线按等价类 / 边界值 / 异常路径新增 31 项；插件 `node --test tests/*.test.ts` 280/280、Swift `swift test` 217/217、`npm run build`、`macos/build.sh`、`git diff --check` 均通过。表格标签由维护人串行审查合入后创建以定位单个实现提交；尚未合入、未重启 DSH 或面板。合入主目录并重建后需用户重启 DSH，人工验收异常退出后重启、正常退出保持关闭以及反复崩溃停止播报。

### O1 日志轮转与播报缓存清理

- **问题**：
  - `~/.dsh/jarvis/debug.log`（插件 `debug()`）和 `panel-debug.log`（面板 `Log.write`，在 `Theme.swift`）只追加不清理。
  - `speakAsJarvis` 把每句播报缓存成 `say-<hash>.mp3`，不同句子会越积越多。
- **实现**：
  - 插件：`debug()` 每写 100 次检查一次文件大小，超过 1 MB 时重命名为 `debug.log.1`（覆盖旧的），重新开始写。
  - 面板：`Log.write` 同样逻辑，作用于 `panel-debug.log`。
  - 播报缓存：插件启动后延迟 30 秒清理 `audioDir` 下的 `say-*.mp3`：删除 7 天以上的，并且只保留最新 100 个。`greet-*` 文件不动。
  - 如果 J0 还没合入，顺手删掉 `session/event` 里每轮打印贾维斯消息数的诊断日志；J0 已合入就跳过这一步。
- **测试**：纯函数 `shouldRotate(size, limit)`、`cacheVictims(files, now, {maxAgeDays, keep})`（等价类：新旧混合；边界：恰好 7 天、恰好 100 个；异常：空目录、文件名不匹配、mtime 缺失）；Swift 侧 `LogRotation` 纯逻辑放 Core 测试。
- **实现记录**（Codex O1 / 2026-09-24）：`src/maintenance.ts` 提供纯 `shouldRotate` / `cacheVictims`，`src/maintenance-files.ts` 封装容错文件操作；`src/index.ts` 的 `debug()` 每成功写入 100 次检查一次，严格超过 1,048,576 字节后原子 rename 覆盖 `.1`，下一次写入新日志。`Theme.swift` 同步接入 Core `LogRotation`，用锁串行化计数和文件写入，使用可捕获错误的 FileHandle API。插件启动 30 秒后仅清理一次缓存，定时器 unref，卸载时撤销；J0 已在 main，未重复删除诊断代码。
  - 边界决定：恰好 7 天保留；最新 100 个按 mtime 降序、同时间按文件名升序保留；缺失或非法 mtime 保留且不占有效缓存配额，目录、符号链接及非 `say-*.mp3` 文件不参与清理，`greet-*` 不动。文件系统读写、轮转、删除失败均被隔离，单个删除失败继续处理其他候选。
  - 验证：三段式新增插件 24 项、Swift 5 项；TDD 红灯确认后，插件全测 304/304、Swift 全测 222/222、`npm run build`、`macos/build.sh`、`git diff --check` 通过。真实 I/O 测试覆盖旧归档覆盖、父路径为普通文件、非空目录阻止轮转及权限拒绝删除；接线测试覆盖 29999/30000 毫秒、仅执行一次及卸载撤销。合入 W1 后的集成适配：先确认 9 项定时器计数失败，再让 `tests/panel-wiring.test.ts` 按每次 apply 的首个注册位置隔离维护定时器，同时断言其 30 秒延迟和 unref；保留所有崩溃、30 秒退避和卸载断言，不改 W1 生产行为。单提交标签 `o1-log-rotation-20260924`；由主会话串行审查合入，尚未重启 DSH / 面板，合入后需重建并重启生效。

### T1 真实 DSH 冒烟检查脚本

- **目的**：每次重启 DSH 后，用一条命令确认插件路由都正常，不用手动点面板。也给 Q1 验收和各条目的"重启后验收"用。
- **新文件**：`scripts/smoke.mjs`（纯 Node，无依赖），`package.json` 加 `"smoke": "node scripts/smoke.mjs"`。
- **做法**：读 `~/.dsh/jarvis/runtime.json`（`origin`、`token`、`rendererHeader`），带 `Authorization: Bearer` 和渲染器头依次检查：
  1. `GET /jarvis/state`：有 `sessions` 数组、`voice` 对象、`pending` 数组，每个 session 行有 `id/title/status/managed`。
  2. `GET /jarvis/wait?since=<当前 version>&timeout=1`：1.5 秒内返回。
  3. `GET /jarvis/messages`：返回数组。
  4. `GET /jarvis/messages?session=__nope__`：404。
  5. `POST /jarvis/managed` 缺少参数：400。
  6. 可选 `--write`：挑一个未托管的可见会话，托管 → 确认 state 里 `managed=true` → 移出 → 确认恢复。无论成败都恢复原状。
- **输出**：每项一行 ✓/✗ 加耗时；有失败时退出码非 0。连不上时提示"DSH 没运行或插件未加载"。
- **测试**：把检查逻辑写成纯函数（输入响应对象，输出通过/失败原因），用预制响应做三段式测试；网络部分不测。
- **文档**：在「2.3 构建、重启、提交」加一句"重启 DSH 后运行 `npm run smoke`"。
- **实现记录**（Codex T1 / 2026-09-24）：新增无依赖的 `scripts/smoke.mjs`、`npm run smoke` 和包内脚本分发，默认依次检查 state、wait、messages、未知会话 404、缺参数 400；每项输出固定名称、✓/✗及耗时，失败退出非零。只接受本机 HTTP origin，Bearer 与 rendererHeader 仅放请求头，禁止重定向，错误提示不拼接 token、响应内容、运行配置或异常原文。
  - 接口适配：state 不提供 version，先以 `wait?since=-1&timeout=1` 取版本，再用该版本短轮询；源码的 timeout 单位为毫秒，两次 wait 均限制在 1.5 秒内。messages 实际为 `{messages:[…],count}`，校验其中数组及存在时的 count；兼容尚无贾维斯会话时的 `{messages:[],error:'no session'}`。正文“返回数组”按此实现，不改其他条目。
  - 可选 `npm run smoke -- --write`：前置检查通过后重新读取可见会话，挑未托管者，纳入并确认，最后移出并确认；没有候选时明确跳过。请求发出前进入 finally 保护，添加响应丢失、状态确认异常、SIGINT/SIGTERM 均尝试恢复；恢复请求或确认失败会报错并退出非零，不宣称恢复成功。未对真实 DSH 执行写检查。
  - 验证：`tests/smoke.test.ts` 新增 14 项等价类 / 边界值 / 异常路径测试，覆盖响应校验与注入内存请求的回滚控制流，不启动网络服务。`node --test tests/*.test.ts` 318/318、`cd macos && swift test` 222/222、`npm run build`、`macos/build.sh`、`git diff --check` 和 `npm pack --dry-run` 通过。主会话已在运行中的真实 DSH 上执行 `npm run smoke`（默认只读模式）：runtime、state、wait 获取版本/短轮询、messages、未知会话 404、缺参数 400 共 7 项全部通过，退出码 0，耗时依次为 0/19/1/3/2/2/7 ms；未打印 token，未执行真实 `--write`。这是当前宿主路由验证，W1/O1 的插件新逻辑仍需重启 DSH 生效；本条脚本本身无需重启，以后重启 DSH 后运行 `npm run smoke`。在已合入 W1/O1 的最新 main 上 rebase 后复验通过，仅合并清单相邻状态行冲突，保留三项记录。标签 `t1-smoke-20260924` 定位单个实现提交。

## 10. 条目详情：发布

### SEC1 安全审查与加固

- **范围**：插件暴露的所有 `/jarvis/*` 路由，以及面板到插件的通信。
- **已知问题**（先修这些，再做整体审查）：
  - `readBody` 不限大小（`src/index.ts`），改为超过 64 KB 返回 413 并断开。
  - JSON 解析失败目前落到 500，改为 400。
  - token 比较用的是 `===`，改为 `crypto.timingSafeEqual`（先比长度）。
  - `isAuthorized` 还接受 `?token=` 查询参数；确认面板是否用到（`JarvisClient.swift`），不用就删掉，避免 token 出现在日志和进程参数里。
  - `/jarvis/input` 文本不限长度，限制 4000 字。
  - `/jarvis/debug`、`/jarvis/agents`、`/jarvis/providers`、`/jarvis/models`、`/jarvis/config` 等调试路由：确认面板是否使用，不用的删除或只在配置 `debugRoutes: true` 时注册。
- **整体审查清单**：每个路由都经过回环地址检查 + token；所有写文件的地方路径都经过安全化（M1、J3、P0）；所有写 HTML 的地方都转义（J3、M1）；`spawn` 的参数不含用户输入；面板只连接 runtime.json 里的回环地址（`JarvisClient` 校验 host 为 127.0.0.1 或 ::1）。
- **测试**：每个修复点一组三段式测试（超大请求体、畸形 JSON、错误 token、长度边界）。
- **产出**：在实现记录里列出审查过的路由表及结论。
- **实现记录**：（空）

### R1 README、LICENSE、包信息

- **现状**：仓库没有 `README.md` 和 `LICENSE`，但 `package.json` 的 `files` 列了这两个文件；`version` 还是 `0.1.0-scaffold`；`description` 还写着 "monitor/续轮"、"per SPEC v0.9" 等过时内容。
- **实现**：
  - `README.md`（中英双语，参考 `../dsh-voice-mini` 的 README 结构）：一句话介绍、截图（用 `Snapshotter` 生成的图）、功能列表（以实际已实现的为准）、安装、首次使用（交给贾维斯、面板操作）、配置项表（从 `Config` 生成）、与 voice-mini 的配合、隐私与权限说明（不开高危权限、数据只在本机）、已知限制、开发（构建、测试、冒烟）。
  - `LICENSE`：MIT，作者与 `package.json` 一致。
  - `package.json`：`version` 改 `0.1.0`；`description` 重写为一句准确的英文，不含营销词，以句号结尾（awesome 列表会直接引用）。
  - 检查 `cordis.patch.yml` 与实际需要的服务一致。
- **验收**：`npm pack --dry-run` 列出的文件包含 README、LICENSE、lib、cordis.patch.yml。
- **实现记录**（Codex R1 / 2026-09-24）：新增中英双语 README 与 MIT LICENSE（zane），package/lock 版本统一为 0.1.0，description 改为准确英文句子。README 只列已完成能力，写明源码安装、首次使用、voice-mini 配合、默认关闭的自动审批/代答及尚未完成的 R2/SEC1/S0/S1/Q1；隐私区区分本机存储与模型/edge-tts 网络处理。`scripts/readme-config.mjs` 从实际 Config/SettingsSchema 生成全部 24 个字段的配置表，提供 `npm run docs:config` 和 --check。核对 cordis.patch 与插件服务接线一致，仅纠正旧注释，不改变运行配置。
  - Snapshotter 生成场景 18/19/20 并逐张打开检查，保存到 `docs/images/`；修正场景 19 的旧演示命令为符合 P1 预设规则的 npm install（演示数据与既有回归断言，未改真实审批行为）。files 补齐截图、README 引用的清单、生成脚本及此前遗漏的内置 TTS 脚本；面板二进制分发留给 R2。新增配置生成器三段式 5 项测试，Demo 断言先红后绿；插件 857/857、Swift 297/297、插件/面板构建、配置 --check、git diff --check 和 npm pack --dry-run 均通过，打包清单确认 README、LICENSE、lib、cordis.patch.yml 及截图/TTS 脚本齐全。单提交标签 `r1-readme-20260924`；合入 main 后重建，面板演示数据变更按约定重启面板，DSH 重启与 smoke 仍由用户执行。


### R2 面板随插件分发

- **问题**：`package.json` 的 `files` 不含 `macos/jarvis-panel`。用户从插件市场安装后没有面板，插件日志只会写 "panel binary not found"。
- **推荐方案**（⚠ 决策 D7）：随包发布预编译的通用二进制。
  - `build.sh` 加 `--release` 模式：`swift build -c release --arch arm64 --arch x86_64`，产物放 `macos/bin/jarvis-panel`，做 ad-hoc 签名（`codesign -s - --force`）。
  - `package.json` 的 `files` 加 `macos/bin/jarvis-panel`；`spawnPanel` 先找 `macos/bin/`，再找开发用的 `macos/jarvis-panel`。
  - 非 macOS 平台：跳过启动面板并写一次日志，插件其他功能照常。
  - 验证：在一个干净目录里 `npm pack` → 解包 → 确认二进制可执行、`file` 显示两种架构、直接运行能启动。
- **备选**：安装后首次启动时本地编译（需要用户装 Xcode 命令行工具，失败率高，不推荐）。
- **注意**：npm 安装不会给文件加隔离属性，一般不会触发 Gatekeeper；如果 S0 结论要求打包成 `.app`，本条要跟着改为分发 `.app`。
- **实现记录**：（空）

### R3 提交 awesome-dsh-plugin 收录

- **参考**：`../awesome-submission/README.md`（提交机制：在 `data/plugins/` 加 `owner__repo.yml`，开 PR，README 由脚本生成不要手改）和已有的 `CroissanTTs__dsh-voice-mini.yml`。
- **实现**：写 `../awesome-submission/CroissanTTs__dsh-harness-jarvis.yml`：`category` 按列表现有分类选（贾维斯更接近多会话编排/agent 类，提交前核对列表 Contents 的分类名）；`description` 中英文各一句，与 R1 的 `package.json` 描述一致；含 `: ` 的字符串加引号。
- **前置检查**：仓库已公开且 README 完整（R1）；`package.json` 声明了 `dsh.bundle`（CI 硬门槛）；安装后面板能出现（R2）；SEC1 已完成。
- **不要**替用户开 PR：准备好文件和提交步骤，由用户确认后自己提交。
- **实现记录**：（空）

## 11. 条目详情：条件触发 / 不做

### M7 L3 摘要（pass D）——条件触发

- **触发条件**：出现"需要把某会话的近期情况注入某个上下文"的真实需求，例如 J2 判断时发现仅凭最终回复经常判错，需要本轮过程摘要。
- **设计**：temp 老化进窗口后压成摘要，存 `cache/summaries/<sessionId>/<date>.json`，非破坏（不删 temp），按 temp 文件修改时间缓存，不每轮重算。模型调用复用 `oneShot`。
- **实现记录**：（空）

### A1 多个贾维斯化身——条件触发

- **触发条件**：J2 上线后，贾维斯单一会话经常积压（例如多个"未满足"通知排队、你的输入要等他处理完别的通知才响应）。
- **设计**：`agentLoop.createAgent` 按需创建 `jarvis-2…` 化身，共享同一套工具和托管集；输入按目标会话分配给固定化身；记忆锁已按 store 设计（M1），无需改动；输出协调（J4）改为跨化身共享一个实例。面板仍只显示一个贾维斯。
- **实现记录**：（空）

### X1 移植到其他平台——不做

- 结论见 SPEC §17：Cursor、Codex 没有"向会话注入消息"和"接管审批"的公开接口，只能包 CLI 进程做降级版。当前不投入；若以后要做，先单独立项调研。

## 12. 决策记录

| 编号 | 问题 | 推荐默认 | 状态 |
|---|---|---|---|
| D1 | 托管会话的轮末播报由谁说？（voice-mini 已经会总结每个会话的结果） | 有贾维斯任务的托管会话由贾维斯说，voice-mini 让出（J5）；其他会话照旧由 voice-mini 说 | ✅ 用户已拍板，按推荐（2026-09-24） |
| D2 | 判断为"满足"时，是插件直接播报，还是唤醒贾维斯让它说？ | 插件直接播报（不花贾维斯一轮模型调用）；只有"不满足"才唤醒贾维斯 | ✅ 用户已拍板，按推荐（2026-09-24） |
| D3 | 托管会话要不要在 DSH 标题里加"贾维斯-"前缀？ | 不加。`rename` 会钉住标题、让 DSH 不再自动命名，破坏用户自己的标题；面板里已经把托管会话单独列出，足够区分。配置项 `titlePrefix` 保留给以后"贾维斯自己创建的会话" | ✅ 用户已拍板，按推荐（2026-09-24） |
| D4 | 记忆系统做到哪一步？ | 先做 M1–M3 + M6（能记、能查、自动留底），M4/M5 等用一段时间再定 | ✅ 用户已拍板，按推荐（2026-09-24）；M4、M5 暂缓 |
| D5 | 语音识别在本机识别不可用时，能否退回云端识别？ | 不能。只用本机识别，不可用就提示，音频永远不出本机 | 暂按推荐执行（用户未选，可随时改） |
| D6 | 分级自动审批里，高危且无预设的操作怎么处理？（SPEC §11 原文是"默认拒绝并告知"） | 转给你决定，贾维斯不自动拒绝也不自动批准。自动拒绝会让会话莫名失败，而转给你同样安全 | 暂按推荐执行（用户未选，可随时改） |
| D7 | 面板怎么随插件分发？ | 随包发布预编译的通用二进制（arm64 + x86_64，ad-hoc 签名）；不要求用户本地编译 | ⚠ 待用户拍板（R2 开工前确认） |
| D8 | 托管会话的结果由谁播报？（修订 D1） | 两种方式：`self` 会话自己用 speak 汇报（省贾维斯的 token），`relay` 贾维斯以转述者口吻总结播报。全局默认 `managedNarration=self`，可在目标列表按会话单独切换；贾维斯每次转发时附一句"做完后用 speak 汇报" | ✅ 用户已拍板（2026-09-24），已实现（`594efa0`、`8c0795c`） |

## 13. 变更日志

- 2026-09-24 16:00：维护核查。阶段 2–6、8 及 R1 共 20 条已完成，22 个完成标签全部在 `main` 上；`main` 插件 857/857、面板 297/297、构建通过，`npm run smoke` 7 项通过；voice-mini 的 J5、U1 改动已合入其 `main`。新增 J5a（J5 记录中留给维护人的边界：判断关闭时重复播报）。W1 实现记录中"尚未合入"的措辞已过时，实际已合入（`d073436`）。S0 正在 `~/.codex/worktrees/s0-stt-probe` 进行，尚未提交。当前运行的 DSH 插件是 10:31 启动的，需重启才能加载今天的功能。
- 2026-09-24 18:00：维护人直接修复与新功能（均已合入两仓库 `main`，需重启 DSH 才生效）：
  - 打开输入框卡顿约 2.2 秒（`9edf0b6`）：历史里的长消息让 `ViewThatFits` 反复排版；改为气泡最多显示 8 行 / 280 字预览，并去掉 `ViewThatFits`。新增 `MessagePreviewTests`。
  - 误按 Esc 关窗（`03a1ba1`）：改为 0.6 秒内连按两次 Esc 才收起，第一次提示"再按一次 Esc 收起"；草稿不再被清空（只有发送才清），按住 Esc 的自动重复不算第二次。新增 `EscapeGateTests`。
  - 托管会话结果没有声音（voice-mini `15887e5`、`8e79627`）：voice-mini 把"本轮已播报 / 最新回复 / 已报工具"存成全局变量，任何会话（含贾维斯）说过一句话，其他会话的轮末总结就会被跳过；改为按会话记录。新增 `test-turn-state.mjs`。
  - 播报模式 D8（`594efa0` 宿主、`8c0795c` 面板）：`claimsTurnEnd` 改为只看播报方式（relay 才接管，不再看 `judgeEnabled`）；self 下贾维斯只静默结算，只在需要续做时开口；relay 下判断 summary 用转述口吻，关闭判断时改用一次 `jarvis-relay` 调用总结。新增 `POST /jarvis/narration`、`set_session_narration` 工具、DSH 设置页 `managedNarration`；面板目标列表悬停可切换，转述会话带"转述"标签。插件 915/915、面板 347/347。
  - J5a 已由其他会话完成（`1fff8bf`）；其"关闭判断即全静默"的规则现在只适用于 self 会话。
- 2026-09-24 16:40：修复吸附缺陷（`43b1052`，维护人直接修）。松手时 `orb.animator().setFrameOrigin` 对 `NSPanel` 不生效，窗口停在原地，却被标记成已吸附并存盘；改为 `animator().setFrame`，并在动画结束时强制落到目标位置。吸附阈值从 30pt 降到 10pt（从窗口边缘算，光球可见边缘约 20pt 内才触发），拖动时本来就会被限制在屏幕内，往边上推总能吸附。新增 `SnapThresholdTests`（等价类 / 边界值 / 异常路径，含"菜单栏下 16pt 被误判为吸附"的现场案例）；面板测试 307/307。

- 2026-09-24：新增派发 prompt 文件（25 条）。新增规则：主目录必须停在 `main`（DSH 通过软链接直接加载主目录），实现一律在 `../jarvis-wt/<slug>` worktree 中进行，合并后在主目录重新构建。使用方法补充合并与汇报步骤。

- 2026-09-24：J2 已完成并核实（`e54c207`，插件 163 项通过）。总览改为 9 个阶段；新增 W1 面板崩溃自动拉起（`spawnPanel` 退出后不重启）、O1 日志轮转与播报缓存清理（两个日志只追加、`say-*.mp3` 只增不删）、T1 冒烟脚本、SEC1 安全审查（`readBody` 不限大小等）、R1 README/LICENSE（`package.json` 的 `files` 列了但文件不存在）、R2 面板分发（包里不含面板二进制）、R3 收录提交；新增决策 D7。J4、J8 按 J2 实际实现修订。

- 2026-09-24：补齐剩余条目：U1 播报字幕（盘点发现 `VoiceState` 没有文字，§12 未兑现）、U2 任务进度、H1 全局快捷键、S0/S1 语音输入（改为面板本机识别路线，避免给 DSH 开高危权限）、P0/P1 分级自动审批、M7/A1 条件触发、X1 不做；新增决策 D5、D6。J1 已由其他会话完成（`b00e4ab`）。
- 2026-09-24：用户拍板 D1–D4，全部按推荐默认；M4、M5 改为暂缓。
- 2026-09-24：初版。依据 SPEC.md 与 `feb29ab` 时的代码盘点；核实了 DSH 标题服务只有 `rename`（J0 的来源）、voice-mini 会在每个会话 turn/end 总结播报（J5/D1 的来源）。
