# 贾维斯待办清单（Backlog）

> 维护人：主会话（负责保持本文件完整、准确）。实现由其他会话认领完成。
> 基线提交：`feb29ab`（托管集合、转发唤醒、say/ask 工具、按目标切换对话记录）。
> 设计依据：`SPEC.md`（下文写作 §N）、`docs/superpowers/specs/2026-09-23-jarvis-ui-design.md`（UI 规格）。

## 0. 使用方法（实现会话必读）

1. **认领**：从「1. 总览」挑一个状态为「待办」且前置已完成的条目，把状态改为「进行中（会话名/日期）」。
2. **实现**：照条目里的「实现逻辑」「验收标准」「测试」做。条目写的是推荐方案；遇到条目没覆盖的情况，按「2. 通用约定」处理，并在该条目的「实现记录」里写清你做了什么决定。
3. **完成**：测试全绿、构建通过后提交，把状态改为「已完成（提交号）」，在「实现记录」写一两句要点（改了哪些文件、偏离条目的地方）。
4. **别改别人的条目**。发现条目写错或缺信息，在条目末尾「实现记录」里留言，由维护人修订正文。
5. 标了「⚠ 待用户拍板」的决策，按「推荐默认」实现即可；若用户已拍板，以「6. 决策记录」为准。

## 1. 总览

| 编号 | 条目 | 前置 | 规模 | 状态 |
|---|---|---|---|---|
| J0 | 修复贾维斯会话标题设置（改用 `rename`） | — | 小 | 待办 |
| J1 | 任务台账：记录"交给哪个会话做什么" | — | 小 | 待办 |
| J2 | 完成判断 + 播报 + 续轮闭环（事件桥 turn/end） | J1 | 大 | 待办 |
| J3 | 审批记录（带上下文写入长期记忆） | —（J1 可选增强） | 中 | 待办 |
| J4 | 输出协调（播报合并、同一时间只问一个问题） | J2 | 中 | 待办 |
| J5 | voice-mini 让出托管会话的轮末播报 | J2 | 小 | 待办 |
| M1 | 记忆存储底座：目录布局 + 按 store 读写锁 | — | 中 | 待办 |
| M2 | `remember` / `recall` 工具 | M1 | 中 | 待办 |
| M3 | 自动抓取 temp（pass A） | M1 | 中 | 待办 |
| M4 | 处置分类器（pass B） | M2、M3、J2 的 LLM 助手 | 大 | 暂缓（D4，别认领） |
| M5 | 固化 / 长期清理 / 归档（pass C、E、F） | M4 | 大 | 暂缓（D4，别认领） |
| M6 | 长期记忆注入贾维斯人设（L1 section） | M2 | 小 | 待办 |
| J6 | DSH 设置页（`settings.installSection`） | J2（要暴露它的开关） | 中 | 待办 |
| J7 | 拦截托管会话的提问（低风险自答，默认关） | M2、J2 的 LLM 助手 | 中 | 待办 |
| J8 | 清理：过期注释、残留字段、SPEC 同步 | — | 小 | 待办 |
| Q1 | 真机验收清单（人工） | — | 小 | 待办 |

**可并行的组**：`J0`、`J1→J2→J4/J5`、`J3`、`M1→M2→M6`、`M1→M3`、`J8` 互不冲突。`J2` 与 `J3` 都会改 `src/index.ts` 的事件监听区，合并时注意冲突。

**不在本清单（规格明确放到以后）**：语音输入（STT、唤醒词）、Phase-2 四级自动审批、全局快捷键、多化身、跨平台移植、L3 摘要（pass D）。

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
- 当前基线：插件 67 项、面板 208 项，全部通过。

### 2.3 构建、重启、提交

- 插件：`npm run build`（tsc → `lib/`），**需要用户重启 DSH 才生效**，完成时要在汇报里提醒。
- 面板：`cd macos && ./build.sh`，然后重启：
  ```
  pkill -x jarvis-panel; cd macos && perl -MPOSIX -e 'exit if fork; POSIX::setsid(); exit if fork; open STDIN,"</dev/null"; open STDOUT,">/dev/null"; open STDERR,">/dev/null"; exec "./jarvis-panel"'
  ```
- 面板截图验收：`JARVIS_SNAPSHOT=/tmp/jv-snap ./jarvis-panel`（场景定义在 `Snapshotter.swift`）。
- 每个条目一个提交，英文提交信息，风格参考 `git log`。
- 调试日志：`~/.dsh/jarvis/debug.log`（`debug(entry, msg)`）。

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
- **实现记录**：（空）

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
- **实现记录**：（空）

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
- **实现记录**：（空）

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
- **实现记录**：（空）

### J4 输出协调（规格里的"输出锁"）

- **目的**：多个会话同时完成时，播报别乱成一锅；贾维斯同时只向你提一个问题。
- **新文件**：`src/output.ts`，`class OutputCoordinator`（纯，时钟可注入）：
  - `announce(session, text)`：进入 1.5 秒合并窗口；窗口内来自不同会话的多条完成播报合并成一句："hammer 和 anvil 都做完了"（≥3 个："hammer、anvil 等 3 个会话做完了"），然后调用注入的 `say`。单条则原样播。失败类播报不合并，立即播。
  - `ask(fn)`：贾维斯发起的 `ask_user` 串行执行，同一时间只有一个在等你回答，其余排队（FIFO）；排队中的问题若其会话已被移出托管则丢弃。
  - 播报**不等**提问结束（问题挂着时仍可播报完成消息）。
- **接入**：J2 的所有播报走 `announce`；`ask_user` 工具和 `deps.ask` 走 `ask`。删掉 `inject_to_session` 里的 `// TODO §3.2: acquire output lock` 注释（发消息给会话不需要锁）。
- **验收**：让两个托管会话几乎同时完成，只听到一句合并播报。
- **测试**（`tests/output.test.ts`，假时钟）：合并窗口内 2 条/3 条/跨窗口不合并；失败类不合并；ask 串行、第二个在第一个结束后才开始；fn 抛错不阻塞队列；同一会话窗口内两条只播最后一条。
- **实现记录**：（空）

### J5 voice-mini 让出托管会话的轮末播报

- **问题**：voice-mini 在每个会话 turn/end 都会总结播报；J2 上线后，托管会话的结果会被 voice-mini 和贾维斯各说一遍。
- **方案**（决策 D1 已定）：贾维斯接管"交给他的任务"的轮末播报，voice-mini 让出。
  1. 贾维斯插件：在 `ctx.provide('jarvis', {...})` 暴露的服务里加 `claimsTurnEnd(sessionId: string): boolean`，当 `managed.has(id) && ledger.current(id)` 存在且 `judgeEnabled` 时返回 true。
  2. voice-mini（仓库 `../dsh-voice-mini`）：`turn/end` 分支开头，若 `jarvisService?.claimsTurnEnd?.(sid)` 为 true 则 `return`（状态提示音和工具播报照旧，只跳过轮末总结和模板）。
  3. 贾维斯没装时 `jarvisService` 为 undefined，voice-mini 行为不变。
- **测试**：voice-mini 侧仿照现有 `test-jarvis-speech.mjs` 加检查（claims 为 true 时不入队、false 时照旧、服务缺失时照旧、claimsTurnEnd 抛错时照旧）；贾维斯侧把判定抽成纯函数测三段式。
- **注意**：这是跨仓库改动，两边各自提交；voice-mini 提交信息注明依赖贾维斯的 `claimsTurnEnd`。
- **实现记录**：（空）

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
- **实现记录**：（空）

### M2 `remember` / `recall` 工具

- **注册位置**：`registerJarvisTools`，与现有工具同样用 `textOutput`。
- **`remember`**：参数 `{ content: string (必填), tag?: string, session?: string, expiresDays?: number }`。`session` 为空写 general，否则写该会话长期。`content` 第一句作为 `<key>`，其余作为 `<detail>`。返回"记住了"。
- **`recall`**：参数 `{ query: string (必填), session?: string, limit?: number (默认 5, 最多 10) }`。
  - 检索范围：general + （指定 session 时）该会话长期 + approvals（query 含"审批/批准/拒绝"时）。
  - 打分：query 按空白和中文单字切词，命中 key 权重 3、tag 2、detail 1；过期条目跳过；同分按新旧。
  - 返回每条：`- [tag] key（来源：session 或 general，日期）`，不返回 detail 全文（§10 原则 1：关键点 + 源指针）。
- **人设**：`COMMANDER_PERSONA` 加："用户说'记住…'就用 remember；需要回忆过去的约定或决定时先 recall。"
- **测试**：打分排序、limit 边界（0、11）、过期过滤、中英文 query、空库、会话目录不存在、条目文件损坏被跳过。
- **实现记录**：（空）

### M3 自动抓取 temp（pass A）

- **监听**：`session/event`，只对托管会话和贾维斯自己。
- **记什么**（一行一条 JSON，带 `session`、`at`、`type`）：
  - `user/message`：文本前 500 字。
  - `assistant/message`：只记最终文本块前 800 字（不记推理、不记工具调用参数）。
  - `tool/result`：只记工具名和是否出错，不记输出。
  - `turn/end`：reason.kind。
- 写入走 `store.appendTemp`，异步、失败只记日志；单个会话单日文件超过 2 MB 停止追加并记一条 `truncated`。
- **测试**：事件到记录的映射（纯函数 `toTempRecord(event)`）三段式；超限截断边界；未知事件类型返回 null。
- **实现记录**：（空）

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
- **实现记录**：（空）

## 5. 条目详情：设置、提问拦截、清理、验收

### J6 DSH 设置页

- 用 `ctx.settings.installSection(ctx, 'jarvis', schema, entry, hooks)` 注册，替换 `src/index.ts` 里 `// TODO §2: installSettingsSection`。
- **暴露的字段**：`provider`、`model`、`edgeVoice`、`greetings`、`judgeEnabled`、`judgeProvider`、`judgeModel`、`maxContinueRounds`、`askInterception`（J7）。
- 用 `watch` 让 judge 相关字段即时生效；`provider`/`model` 改动只影响下次创建的贾维斯 agent（在设置说明里写明"重启 DSH 生效"）。
- 没有设置服务时一切照旧（installSection 自带降级）。
- **测试**：把"配置合并/校验"抽纯函数测三段式（非法 maxContinueRounds 负数、超大值、空 provider 回退默认）。
- **实现记录**：（空）

### J7 拦截托管会话的提问（默认关）

- **规格**（§8）：托管会话调用 ask_user_question 时，低风险的从上下文直接答，拿不准再转给你。
- **实现**：在现有 `user-questions/request` 监听里，当 `askInterception=true`、会话是托管的、且问题带选项时：
  1. 调 `oneShot`，输入 = 问题 + 选项 + 任务原始需求 + `recall` 到的相关记忆；要求输出 `{choice: "选项原文"|null, confidence}`。
  2. `confidence ≥ 0.85` 且 choice 是合法选项 → 直接返回答案，并 `deps.say('{会话名}问了{问题}，我替你选了{choice}')`，同时写一条 temp 记录。
  3. 否则走现有转发（`live.holdAsk`）。
  4. 无选项的开放问题一律转发。
- **默认关**：替用户做决定有风险，必须用户在设置里主动打开。
- **测试**：阈值边界 0.85、choice 不在选项里、无 llm、超时 → 全部回落到转发。
- **实现记录**：（空）

### J8 清理

- `src/index.ts` 顶部文件注释还写着 "execute bodies / TTS / answerer / memory / 悬浮窗 routes are STUBS"，按现状重写。
- `GET /jarvis/sessions` 返回里残留 `monitoring` 字段，删掉（确认面板 `JarvisClient` 不读它）。
- `SPEC.md`：§7 工具表去掉 `monitor_session` / `stop_monitoring`（改由 J1 台账 + J2 事件桥隐式完成），`recall`/`remember` 标注"见 backlog M2"；§8 触发条件改为"托管 + 台账有未结任务"。
- UI 规格文档 §6.1 补充：目标列表只列托管会话，底部"＋ 交给贾维斯…"展开候选，行悬停出现"移出"按钮；§8 数据接口补 `/jarvis/wait`、`/jarvis/managed`、`/jarvis/messages?session=`。
- **实现记录**：（空）

### Q1 真机验收清单（人工，由用户执行）

- [ ] CPU：待机时 `jarvis-panel` 占用 < 3%，播报时 < 10%（活动监视器看 1 分钟）。
- [ ] 打开启动台 / 全屏应用时光球自动隐藏，退出后恢复。
- [ ] 快捷输入框里用中文输入法打字：候选框位置正确，回车选词不会误发送。
- [ ] 光球以外的透明区域点击能穿透到下层窗口。
- [ ] 拖到屏幕边缘吸附不卡顿。
- 发现问题记到本条「实现记录」，维护人拆成新条目。
- **实现记录**：（空）

## 6. 决策记录

| 编号 | 问题 | 推荐默认 | 状态 |
|---|---|---|---|
| D1 | 托管会话的轮末播报由谁说？（voice-mini 已经会总结每个会话的结果） | 有贾维斯任务的托管会话由贾维斯说，voice-mini 让出（J5）；其他会话照旧由 voice-mini 说 | ✅ 用户已拍板，按推荐（2026-09-24） |
| D2 | 判断为"满足"时，是插件直接播报，还是唤醒贾维斯让它说？ | 插件直接播报（不花贾维斯一轮模型调用）；只有"不满足"才唤醒贾维斯 | ✅ 用户已拍板，按推荐（2026-09-24） |
| D3 | 托管会话要不要在 DSH 标题里加"贾维斯-"前缀？ | 不加。`rename` 会钉住标题、让 DSH 不再自动命名，破坏用户自己的标题；面板里已经把托管会话单独列出，足够区分。配置项 `titlePrefix` 保留给以后"贾维斯自己创建的会话" | ✅ 用户已拍板，按推荐（2026-09-24） |
| D4 | 记忆系统做到哪一步？ | 先做 M1–M3 + M6（能记、能查、自动留底），M4/M5 等用一段时间再定 | ✅ 用户已拍板，按推荐（2026-09-24）；M4、M5 暂缓 |

## 7. 变更日志

- 2026-09-24：用户拍板 D1–D4，全部按推荐默认；M4、M5 改为暂缓。
- 2026-09-24：初版。依据 SPEC.md 与 `feb29ab` 时的代码盘点；核实了 DSH 标题服务只有 `rename`（J0 的来源）、voice-mini 会在每个会话 turn/end 总结播报（J5/D1 的来源）。
