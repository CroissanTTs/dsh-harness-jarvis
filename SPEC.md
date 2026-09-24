# dsh-harness-jarvis — 设计 Spec

> 状态：H1 全局快捷键输入实现同步 · 2026-09-24
> 已落地：J0/J1/J2/J3/J4/J5/J6/J7/U1/U2/H1/M1/M2/M3/M6；实现进度以 [backlog](docs/superpowers/plans/2026-09-24-jarvis-backlog.md) 为准。§10 的存储底座、显式记忆工具、自动 temp 抓取、人设记忆注入和审批记录已落地；播报字幕、全局快捷键输入和 DSH 设置页已接通，可选低风险代答已接通且默认关闭，语音输入尚未实现。
> 单一真相源。MVP 砍 STT(悬浮窗文本输入窗口替代);权限面彻底干净(无 danger-full-access)。多对话核心:瘦编排+干净 worker+虚拟交错显示(§3.2);悬浮窗 dsh-notch 基(§12)。待研究:次要(见 §18)。

---

## 0. 一句话

**贾维斯是普通 DSH agent 上的编排助手**：插件通过 `agentLoop.createAgent` 创建独立会话，已存在时 `resume`；在 setup 回调里通过 `agentCtx` 注册指挥官人格与工具。它在正常 DSH loop 上运行，管理独立 worker 会话，通过原生悬浮窗接受文字输入、反馈状态和转发审批。**生命周期随 DSH；STT 留后续。**

## 1. 身份

| 项 | 值 |
|---|---|
| 插件名(cordis `export const name` / npm) | `dsh-harness-jarvis` |
| 仓库(拟) | `CroissanTTs/dsh-harness-jarvis`(与 dsh-voice-mini 同账号) |
| 许可证 | MIT(与 voice-mini 一致) |
| 形态 | DSH 插件:`dsh.bundle`(cordis.patch.yml)+ host 半边 + 可选 client 半边 + 可选独立原生悬浮窗二进制 |

## 2. 依赖模型(硬约束)

**贾维斯不硬依赖任何插件存在**——不依赖 dsh-web、dsh-desktop、voice-mini。必须在**原生/vanilla dsh**(含 headless)直接接入。voice-mini 与贾维斯各自独立运行。

### 核心脊梁(必有,vanilla dsh agent harness 服务,非 host 层)

| 缝 | 用途 | 验证来源 |
|---|---|---|
| `ctx.tools.register` + `defineTool`(`exec.agent.session.id`=调用方会话) | 暴露贾维斯工具 | voice-mini 实证 |
| `ctx.on('session/event')`(`turn/start`、`turn/end`、`user/message`) | 更新状态；托管且有未结任务时判断完成度 | voice-mini 实证 |
| `ctx.get('agents').get(sessionId)` → `Agent` | 按会话 id 拿目标 Agent | dsh-voice-call 实证 |
| `deliver(agent, UserMessage)`（`src/sessions.ts`） | 空闲优先 followup、运行中优先 steer，最后回退 inject | dsh-voice-call 实证(确切签名见 §13) |
| `ctx.userQuestions.ask({questions, agent?, signal?})` | 问用户并等待选项或文字回答 | dsh-voice-call 实证 |
| `ctx.inject(['llm'], c => c.get('llm'))` + `llm.stream()` | 独立完成判断，不启动 worker 轮次 | voice-mini 实证 |
| `approval/request` / `user-questions/request` | `live.holdApproval` / `live.holdAsk` 让面板和 DSH 窗口竞答 | `src/index.ts` 接线 |
| `ctx.inject(['systemPrompt']).section({name, order, text})` | 给 Jarvis 会话灌人设 | voice-mini 实证 |

### 可选层(全部 graceful,在就增强,不在就降级)

| 可选层 | 在 | 不在 |
|---|---|---|
| `ctx.inject(['webServer'])`(dsh-host-webserver) | 挂状态/文字输入/悬浮窗 IPC 路由 | 纯 host 跑 |
| DSH 设置页（J6） | `settings.installSection` 注册 `jarvis`，内置 watch 读取持久化覆盖 | 服务缺失或安装失败沿用插件配置，服务卸载回退 |
| `ctx.inject(['sessionTitle'])` | 创建/恢复后固定 Jarvis 标题 | 跳过固定标题，不影响启动 |
| `desktopBrowserAccess`(dsh-desktop) | 将 rendererHeader 写入 runtime.json 供面板请求 | 不写该可选头 |
| voice-mini HTTP 接口（见 §5） | 委托语音合成和播放 | 内置 TTS |

**原则**:核心层只用核心脊梁服务 → vanilla dsh 能跑;可选层全部 `ctx.inject` graceful 或 `ctx.get` 机会式,任一缺失不崩。

## 3. 生命周期与组装

插件创建或恢复一个普通 Jarvis agent。每轮可与用户沟通、调用 `inject_to_session` 给托管 worker 下达任务，或用 `list_managed` 查看托管与候选会话。任务成功投递后自动记账，由全局事件桥处理完成判断，不需要额外“监听”工具。

完成判断是独立的 `llm.stream()` 调用；只有需要用户决定续做时，才向 Jarvis 会话投递通知。不会把全部 worker 内容搬入 Jarvis 的上下文。

### 3.1 组装流程（两个挂点）

```text
DSH / Cordis 加载插件 → apply()（全局）
  · 载入 managed.json 与 tasks.json
  · 连接 CompletionJudge、OutputCoordinator、审批记录、TTS
  · session/event 更新状态并对托管任务触发完成判断
  · approval/request、user-questions/request 连接面板与 DSH 竞答
  · ctx.provide('jarvis') 提供 sessionId、cwd、speech、claimsTurnEnd
  · 可选 webServer 路由、runtime.json、原生面板子进程
  → agentLoop.createAgent(ctx, {sessionId, meta, agentOptions, setup})
    已存在则 resume(ctx, {resumeSessionId, agentOptions, setup})
    → setup(agentCtx)（Jarvis scope）注册人格与工具
    → 成功后尝试设置标题（§9.1）；首次问候启动首轮，恢复时播欢迎语
```

人格和工具只注册到 Jarvis agent；完成判断与输出协调在插件层，不注册 `agent/turn-stopping` 钩子，也不在轮次关闭过程中等用户。

### 3.2 瘦编排 agent + 干净 worker + 虚拟交错显示(多对话核心)

- **worker 各自是独立干净 session**:每个 worker 有自己的 SessionID / cwd / transcript,**model context = 它自己的干净 surface**(`session.deriveMessages()`,已确认 dsh-session)。worker 的活在它自己 session 里跑,工具在它自己 cwd。worker 互不交错。
- **Jarvis = 瘦编排 agent**:自己的独立 session(lean),只干**路由 / 口播 / inject 决策 / 续轮判断的编排**,**不堆 worker 内容**进自己 surface。Jarvis surface 保持瘦(决策日志)。
- **完成判断读取 worker 本轮助手文本与任务台账**，由独立的一次性模型调用完成，不改 worker transcript，也不调用 `recall`。
- **显示与模型上下文分离**：面板当前按所选目标切换对话记录，转发消息可显示路由标记；不会把跨会话记录合并成 Jarvis 的真实 surface。
- **模型从不看交错 blob**:worker 的 model call 用它自己干净 surface;Jarvis 的 model call 用它瘦 surface。两头都干净,**无需"过滤 transcript"——头号风险(context≠transcript)moot**。
- **路由（显式选择）**：目标是“贾维斯”时直接对话；选择托管会话后，输入经 Jarvis 改写再 `inject_to_session`。面板记住上次目标，目标失效时回退“贾维斯”；不靠分类器猜测。见 §6/§12。
- **输出协调**：完成播报在 1.5 秒窗口内合并，`ask_user` 按 FIFO 串行；播报不等待问题回答。worker 仍可并行运行，不独占输出轮次（§8.2）。
- **激活** = 拉上下文思考;输入 → Jarvis 路由 → inject 进目标 worker → worker loop 跑(激活);Jarvis 自己的路由决策也在它瘦 session 里跑一轮。
- **缓存**:worker session 各自稳定前缀(append)→ 命中;Jarvis 瘦 session 也稳定。切 worker = 切到那个 worker 的 session(各自 prefix)。条件:同 provider/key + TTL 内 + append-stable。
- **session 数 = 1(Jarvis 瘦)+ N(worker 干净)**;worker 各自保留 cwd，不要求 workspace 唯一(见 §9.2)。
- **不动 loop、不分叉、不自定义 context 插件**:用 DSH 默认 loop,worker 各自干净 session + Jarvis 瘦编排即可。早先"分类器预判组装该会话分离流 + context≠transcript 风险"那套被这条路取代、不再需要。

## 4. 半托管定位

贾维斯是**半托管**会话助手:**权限只有两个核心功能**——① 管理会话(向托管会话发消息、监听其状态/结果)② 与用户反馈(口播、语音问)。**拍板永远在用户**;贾维斯不自作主张批准(Phase-1)。分级自动批准是 Phase-2 的后续优化(见 §11)。

## 5. TTS：内置 + voice-mini 可选协作

- `speakAsJarvis` 先检查静音；同宿主 voice-mini 存在时，经 `/voice-mini/test`（`{text, jarvis:true}`）委托合成、提示音和播放；不存在时回退内置 edge-tts。
- 当前 `voice:tts` 注入只记录服务发现日志，不是实际播放切换接口。
- 插件用 `ctx.provide('jarvis')` 暴露 `speech`（同步面板口播状态）和 `claimsTurnEnd(sessionId)`。后者仅在**已托管 + 台账有未结任务 + judgeEnabled** 时返回 true。
- voice-mini 在处理 `turn/end` 时查询可选的 `claimsTurnEnd`；明确返回 true 才跳过该会话的轮末总结及兜底播报。提示音、工具播报、运行状态等保持原行为；服务缺失或查询抛错沿用旧行为。
- 已知配置边界：`judgeEnabled=false` 时 voice-mini 不让出；J2 仍会按 `unclear` 模板播报，因此此配置下可能重复播报。本次清理不改变这条既有行为。

## 6. 输入:MVP 用悬浮窗文本输入窗口(STT 后续)

**MVP 不做 STT**——不引 host mic / 本地 ASR / `danger-full-access`,权限面彻底干净(STT 本是唯一重权限点,砍了就没了)。入口 = 悬浮窗**文本输入窗口**(打字)。

- **MVP 入口**：悬浮窗目标选“贾维斯”时直接对话；选托管会话时输入经 Jarvis 改写并投递。保留上次目标；没有有效选择时回退“贾维斯”，不自动猜 worker。
- **全局快捷键 H1**：默认 `⌃⌥J`，设置页可点击录制新组合，保存在 `panel.json` 的可选 `hotKey` 字符串（nil/缺省用默认）。面板通过 Carbon 独占注册，无需辅助功能权限；注册失败提示“快捷键被占用”，保留旧组合及注册。关闭时按键打开并聚焦；已打开且输入聚焦时关闭；已打开但未聚焦时重新聚焦。输入打开期间覆盖全屏、启动器、指定应用隐藏规则，关闭后恢复。
- **STT(后续,不在 MVP)**:host 端 ASR(SenseVoice/whisper-local,参考 dsh-voice-call transcribe、dsh-voice-scribe)+ 快捷键/点按说话;要 `danger-full-access`,信任边界收口(只在 trigger 时采、音频不出本机、引擎进程隔离)。与"严厉禁止高位危权限"有张力,故留后续、不进 MVP。
- 不选唤醒词 always-on(常驻 mic,重且隐私张力大)。

## 7. 工具面（仅 Jarvis 会话可见）

| 工具 | 参数 | 当前行为与约束 |
|---|---|---|
| `say_to_user` | `{text}` | 非空文本，静音 → voice-mini → 内置 TTS |
| `ask_user` | `{question, choices?, session?, task?}` | FIFO 串行问用户；不带 session/task 时为普通问题 |
| `inject_to_session` | `{session, message}` | 目标不能是 Jarvis 且必须托管；成功投递后记账 |
| `list_managed` | `{}` | 返回托管会话与其他可托管候选，含标题、工作区、状态和 id |
| `manage_session` | `{session}` | 用户明确交付后纳入托管；目标必须是可见 worker |
| `release_session` | `{session}` | 移出托管，终止未结任务并清除过期续做与排队问题 |
| `recall` | `{query, session?, limit?}` | 检索 general + 指定会话长期；含审批/批准/拒绝时加审批库，返回关键点、来源、日期；默认5、最多10 |
| `remember` | `{content, tag?, session?, expiresDays?}` | 第一句为关键点、其余为补充；session 空写 general，否则写该会话长期；成功返回“记住了” |

续做问题的 `session` / `task` 都是可选字符串，但**必须一起提供**，原样传递到协调器和完成判断器；固定选项为“继续 / 不用了”。问题出队时校验任务与轮次，回答后再校验；已变化的任务不接受旧答案。“不用了”关闭对应任务，“继续”后由 Jarvis 再调用 `inject_to_session`，不会在 `ask_user` 内自动投递。

## 8. 事件桥（完成判断仅对“托管 + 台账有未结任务”触发）

### 8.1 任务台账与续轮

`tasks.json` 保存任务 id、session、用户原话 request、实际投递 message、createdAt、status、rounds 和 lastVerdict。面板 `/input` 成功投递给 Jarvis 后暂存原话，10 分钟未使用即过期；`inject_to_session` 成功投递 worker 后才开启任务，缺少原话则以 message 回退。新需求替换旧任务；续做复用原任务 id 和原话，更新 message 并增加 rounds。未结状态是 `open / judging / unsatisfied`；`done / dropped` 已结。未结任务超过 24 小时终止，记录上限 200，优先淘汰最旧已结项。

| 事件 / 结果 | 实际动作 |
|---|---|
| `turn/start` | 使旧判断和旧续做问题失效，取消进行中的模型请求 |
| `turn/end: completed` | `open → judging`；读取台账原话、投递消息及最后一条 user 之后的助手文本，剔除代码块、截取最多 3000 字，独立模型判断 |
| `satisfied` | 任务 done，交给输出协调器播报摘要（最多 40 字） |
| `unclear` | 任务 done，播“会话名做完了”；模型不可用、超时、格式错误、缺少回复或关闭判断均采用此回退 |
| `unsatisfied` 且未达上限 | 任务 unsatisfied，向 Jarvis 投递含缺少项（最多 60 字）、session、task 的 UserMessage；Jarvis 用 `ask_user` 征求续做，再按答案投递具体新消息或结束任务 |
| 未满足且达到续轮上限 | 任务 done，立即播报“还没做完…已经续了 X 次…交给你看看”，不合并成成功提示 |
| `aborted` | dropped，不播报 |
| `error / blocked / max-tokens / interrupted` | 保持 open，立即播报失败原因，不调用判断模型 |
| 移出托管 / 新轮次 / 新任务 / 插件卸载 | 旧判断和续做答案失效，迟到结果不得覆盖新任务 |

默认 `judgeEnabled=true`、`judgeTimeoutMs=20000`、`maxContinueRounds=2`；模型默认沿用 Jarvis 的 provider/model，可单独配置 judgeProvider/judgeModel。优先请求 `reasoningEffort:'low'`，不支持时去掉后重试。

DSH 设置页 `jarvis` 暴露 provider、model、edgeVoice、greetings 与全部五个 judge 字段。judge 字段下一次判断生效；超时为 1000–120000 毫秒整数，续轮上限为 0–10 整数。provider/model 在创建或恢复 agent 前读取已保存配置，之后需要重启 DSH；judge 留空时沿用该运行中 agent 的模型选择。edgeVoice 仅控制 voice-mini 不可用时的内置音色，下一次播报生效，音频缓存按音色和文本区分；greetings 是重启欢迎语的附加列表。服务缺失时使用插件配置，服务卸载后即时字段回退插件配置。内部路径及会话身份不暴露在页面，askInterception 默认关闭，控制 §8.3 的低风险代答。

续轮顺序固定为 **轮次结束 → 判断 → ask_user → 用户决定 → 投递新 UserMessage**。`session/event` 监听器不等待判断或用户回答；不使用 `agent/turn-stopping`，不向会话日志写自定义事件。

### 8.2 输出协调（J4）

完成播报从第一条到达起等待固定 1.5 秒，按 session 去重、同会话保留最新文本。单会话保留原文；两个会话播“hammer 和 anvil 都做完了”；三个以上播“hammer、anvil 等 N 个会话做完了”。失败和续轮上限提醒立即播报。

`ask_user` 使用独立 FIFO 队列，同一时间只执行一个提问；移出会话、调用方取消或卸载时丢弃相关排队项，执行中的请求保留原 agent/signal。播报不因等待回答而阻塞；该队列不串行化所有 worker 的原生审批/提问。

### 8.3 审批与提问转发

`approval/request` / `user-questions/request` 分别经 `live.holdApproval` / `live.holdAsk` 与 DSH 窗口竞答，先答者生效。审批先把决定返回 DSH，再异步记录（§10.1、§11）；提问默认只转发。开启 askInterception 后，仅当前托管 worker 的有选项问题可尝试代答，贾维斯自身与明确审批/review intent 始终转发。输入包含原问题、选项、当前任务原始需求，以及 general 和该会话的 recall 结果；提示要求只答已有依据的低风险实现细节，高风险决定或不确定时返回 null。

输出必须是严格 JSON，choice 与选项原文完全相等，confidence 为 0.85–1 的数字。最多四题、原问题结构和每次完整模型输入均不超过 16000 字符，超长直接转发，不截断任务或记忆；任一题不合格、开放题、读记忆或模型失败、超时，都将完整原请求交给原转发链。复用 judgeProvider/judgeModel（留空沿用当前 Jarvis 模型）及 judgeTimeoutMs，整个请求的检索与判断共享总时限。返回前复查开关、托管状态、任务、问题和取消信号，拒绝过期结果；卸载取消在途推理。

成功时按宿主 answers/id/selected 格式返回，然后异步口播“会话名问了问题，我替你选了选项”，在对应会话的 temp 写 question/auto-answer（问题与选项各最多 500 码点、置信度、问题/任务 id），不记模型推理或检索原文，不写 DSH 自定义事件。播报和记录失败只记日志，不改变已返回答案。

## 9. Jarvis agent 来源 + 托管集

### 9.1 Jarvis agent（本体）

- 插件自行调用 `agentLoop.createAgent`，会话已存在时 `resume`；两条路径都在 setup 里注册人格和工具，使用 DSH 正常 loop。
- 创建/恢复成功且标题服务可用后，从 `ctx.get('sessions').get(id)` 获取**会话对象**，先 `sessionTitle.get(session)`；标题不是“贾维斯”时调用 `rename(session, '贾维斯')`。rename 会钉住标题，每次启动最多尝试一次，不在每轮重设；服务延迟注入可触发，异常仅记 debug。
- 当前只有一个 Jarvis；多化身见 backlog A1。输出协调已实现（§8.2）；审批记录已接入 MemoryStore 的 approvals 写锁，当前审批记录独立原子写文件。

### 9.2 托管集（worker 会话）

- 面板目标菜单底部“＋ 交给贾维斯…”展开未托管候选；行悬停“移出”撤销托管。也可由 Jarvis 工具 `manage_session` / `release_session` 管理。集合持久化于 `~/.dsh/jarvis/managed.json`。
- 可见 worker 排除 Jarvis 自己及已归档会话；`inject_to_session` 只允许托管目标。**托管是投递边界，未结任务是完成判断边界**，无需单独维护监听集合。
- worker 保留自己的 session、cwd、工具执行目录、标题和 transcript；当前托管操作不创建 worker，也不添加标题前缀。不同 session 可以属于同一 workspace。
- `/jarvis/state` 提供可见 worker（含 `managed` 标记）和可选 `task:{status,summary?}`；目标列表只列托管项。任务徽标对应 open“进行中”、judging“判断中”、unsatisfied“未完成”（琥珀色），悬停显示缺少项或原话前 30 字；已结/过期任务不显示徽标。

### 9.3 多对话管理

一个 Jarvis 编排 N 个独立 worker，各自正常运行；通过任务台账和事件桥完成闭环，输出协调器合并播报和排队提问。切换面板目标同步切换该会话的对话记录，不把交错内容写入任何模型上下文。

## 10. 记忆(两级:temp JSONL + 长期 HTML)

> 实现边界：存储底座（M1）、显式 remember/recall（M2）、自动 temp 抓取（M3）、人设记忆注入（M6）和 §10.1 审批记录（J3）已落地；分类器与固化/清理 M4/M5 暂缓，L3 摘要 M7 条件触发，尚未运行。J2 判断直接读取台账与 worker 文本，不依赖记忆工具。

- **临时记忆 temp**:`~/.dsh/jarvis/temp/<sessionId>/*.jsonl`,一行一事件(append-only,机器友好)。
- **长期记忆**:`~/.dsh/jarvis/memory/{general,<sessionId>,approvals}/*.html`(语义标签,可 grep+read,人/agent 可读)。
- **捕获(hybrid)**：M3 只抓贾维斯自身和当前托管 worker 的 session/event：user 文本前500码点、assistant 最终文本块前800码点（跳过 interrupted 前缀）、工具名与是否出错、轮末 reason.kind；不记推理、工具参数、输出或 stream。按 event.time 的 UTC 日期异步写 temp，失败只记日志；同会话每日预计追加超过2 MiB时写一条 truncated 并停止当日追加，次日恢复。Jarvis 显式 `remember` 写**长期**；自动固化仍为后续设计。
- **固化触发**(四选一):temp 达阈值 / 用户主动 / 阶段完成 / 定时。
- **原则1 关键点 + 源指针**:记忆存关键点 + 源 session 指针;细节不进记忆(指回 worker transcript / 提示用户看 session)→ 多 worker 也不爆。
- **原则2 最终结果优先压缩**:固化/摘要 model pass 时 weight final result,压过程/解释(agent 可靠性/鲁棒性等)。
- **原则3 处置分类器(待细化,见 §18 P1)**:被监听 worker 的 end hook → 分类器逐条判 **4 去向**:丢弃 / 直接入 temp / 直接入长期 / 触发 Remember。**必须动态、可优化**(模型 pass + 规则护栏,可调)。
- **注入(瘦编排下)**:**L1** 已实现 `jarvis:memory` section（order 60，仅贾维斯作用域；general 最新 20 条 key，按创建时间倒序，总长最多 1500 码点；按 store version 缓存，无变化不重读或重排，空库不显示）+ **L4** `recall` 工具(Jarvis / worker reviewer 按需拉,关键点+源指针)。未来若给完成判断接入记忆，可按需检索 per-session 长期；当前 J2 使用 §8.1 的独立调用。**L2/L3**(per-session temp 注入某 context)在瘦编排 MVP 不用(Jarvis 瘦、不堆 worker temp);后续若 worker reviewer 要注入再上。
- **多会话源标注**:每条 temp/长期标 source session id;`recall` 可按 session 过滤;可跨会话综合。
- 选 HTML(长期)是为标签结构化、可按 intent/session/status 检索;JSONL(temp)为机器友好(易 grep/喂摘要模型/append)。

### 10.1 审批记录（J3 已实现）

记录范围是收到的审批请求，包括未托管会话。请求到达时冻结 session id、完整 cwd、managed 标记及原始 operation。context 优先取该会话未结任务的 request，否则取最近 user 文本，按 Unicode 字符截取 300 字。台账使用只读快照，读取审批上下文不会触发台账落盘；operation 的完整 command/args 保留，面板命令展示单独截短到 300。

```html
<!-- ~/.dsh/jarvis/memory/approvals/bash:rm-rf-node_modules-20260924T103000.html -->
<approval fingerprint="bash:rm-rf-node_modules" ts="2026-09-24T10:30:00.000Z">
  <session id="hammer" cwd="/projects/voice-mini" managed="true">hammer — /projects/voice-mini</session>
  <operation tool="bash" command="rm -rf node_modules" args="{&quot;command&quot;:&quot;rm -rf node_modules&quot;}">bash: rm -rf node_modules</operation>
  <context>给 voice-mini 补测试</context>
  <decision allow="false" source="user" reason="">拒绝</decision>
  <tier value="" notes="Phase1:未分级" />
</approval>
```

- 只记录 `allowed-once` / `rejected`；取消、不可用等结果不写。`source` 固定 user，`reason` 当前为空，不伪造用户解释，tier 留空供未来消费。
- 先返回审批结果，`setImmediate` 再异步写文件；目录或写入失败只写 debug，绝不改变审批结果。
- HTML 所有外部文本与属性均转义。默认目录 `~/.dsh/jarvis/memory/approvals`（可配置 approvalsDir）；临时文件写完后原子发布，同名加 `-2`、`-3` 等后缀，互不覆盖。已接入 MemoryStore 的独立 approvals 写锁，记忆检索使用同库读锁。
- fingerprint 为小写工具名 + `:` + 规范化命令前 8 个词：空白合并，以 `/` 或 `~` 开头的路径取 basename，只保留安全字符。它是粗粒度检索键，**不是唯一记录 id，也不是自动授权凭据**；文件名增加 UTC 秒级时间和碰撞后缀。完整原始操作仍在记录中。
- 显式 remember/recall 已实现：中英文词项按 key/tag/detail 的 3/2/1 权重排序，同分取新记录，跳过到期与损坏条目；recall 可检索现有审批记录。自动批准仍未实现。

### 10.2 处置分类器（后续设计，backlog M4 暂缓）

被监听 worker 的 `turn/end`(经事件桥)触发。temp 在 turn 期间已 auto 抓全,分类器不是"抓不抓",是**对这轮内容做处置标注 + 提取关键点**。

**输入**:worker 本轮结果+context(事件桥)· 用户原始 task/intent(`recall`)· worker session id + 近期 temp · 可调规则/few-shot。

**流程**:① 按原则2 提取关键点(weight final result,压过程/解释)→ ② 每条 piece 判去向 + 置信度 + key_point + source_ref。

**4 去向**:
- **扔了**:噪声(原始中间工具输出、冗长过程、例行状态、重复)→ 标记清除(固化时清)。
- **留 temp**:短期相关的工作事实 → 默认留(按 TTL/4 触发固化时再处理)。
- **直接存长期**:重要且稳(关键决定、最终结果、用户偏好)→ 立即 auto 写长期(带 存期+保质期)。
- **喊贾维斯自己记**:需贾维斯框定(特殊要求、洞察、跨会话规律)→ `agent.inject` 打个招呼 → 贾维斯下轮自己 `remember`(用自己的话)。

核心:**不用贾维斯加工的稳定事实→直接存;需贾维斯亲自想的→喊他记**。对应 hybrid(auto 直存 + 显式 Remember)。

**动态 + 可调(硬要求)**:两层——① 规则护栏(清 case 快过,如某类工具 raw 输出恒扔、`user_preference` 标签恒直存)② 模型判灰色。判据 prompt + few-shot + 规则**配置可改**(你能调)。
- **判模型 = 主模型 + 低推理强度**(默认,零配置;`ctx.inject(['llm']).stream({reasoningEffort:'low'...})`),模型不支持调强度就正常跑(不报错,参考 voice-mini verbalizer 的兜底);可选配独立判模型省更多。
- **低置信默认留 temp**(不乱扔/乱存)。

**缝**:`turn/end`(session/event,filter 到被监听 worker)· `ctx.inject(['llm']).stream()` 判 pass · `agent.inject` 喊贾维斯 · 提取的 key_point 写长期 + 供 recall(§3.2 已无投影)。

### 10.3 记忆子系统：存储 + 流程 + 协调（后续设计）

**存储布局**:
```
~/.dsh/jarvis/
  temp/<sessionId>/*.jsonl          # 草稿,按会话分目录(archive flush + recall 读都干净)
  memory/general/*.html             # 通用长期(跨会话)
  memory/<sessionId>/*.html         # 每会话长期
  cache/summaries/<sessionId>/*.json # L3 摘要(缓存,给注入用)
```

**流程(pass)**:

| pass | 节奏 | 读 | 写 | 删 |
|---|---|---|---|---|
| A 自动抓 | turn 期间 | events | temp(+source) | — |
| B 处置分类器(§10.2) | worker end-hook | 结果+context、recall、近期temp | temp(标去向)、long-term(直存)、inject(喊贾维斯) | 标"扔"(不立即删) |
| C 固化 | 4 触发 | aged temp(留temp 的) | long-term(general/per-session) | temp(promote/discard 拿走) |
| D 摘要 | temp 老化进 L3 窗口 | aged temp | L3 摘要(缓存) | 不删 temp(非破坏) |
| E 长期清理 | 定期 | long-term(两类) | — | long-term(无效) |
| F 归档 | 会话闲置 N 天 | 该 session temp | per-session长期(经 C flush) | temp(flush 后清)+ 标 cold |
| G 路由 | Jarvis incoming | managed + 摘要 | Jarvis **主模型**本轮判目标 worker(非独立 pass,见 §3.2) | — |
| H 模型 context | 各 session turn | 各自 surface | 默认 `deriveMessages`(worker 干净 / Jarvis 瘦,非定制) | — |

**4 块设计**:
- **固化(C)**:4 触发(阈值/用户/阶段/定时);扫 aged temp,promote 够格的→long-term,其余扔。判:规则(新老/被翻次数)+ 模型"还相关吗",主模型低强度。
- **摘要(D)**:temp 老化进 L3 窗口 → 压成摘要+标记(L3)给注入;**非破坏**(不删 temp);摘要缓存别每轮重算。
- **长期清理(E)**:定期;删保质期到/被新事实盖/模型判不成立的(通用+每会话都管)。
- **L1 注入量**:L1 稳定前缀只装 **general长期**(慢变、缓存命中、有上限);每会话长期**不进 Jarvis L1**(由 worker reviewer / Jarvis 按需 `recall`);不用 top-K(破坏缓存)。
- **归档(F)**:会话闲置 N 天 → 经 C flush 该 session temp(promote→per-session长期,余扔)→ 清空 temp → 标 per-session长期 cold;路由到它先解档重载。

**长期分两类(关键)**:general(跨会话,进 Jarvis L1)+ per-session(某会话自己的,按需 recall,不进 L1)。B 和 C 写长期时用**同一条**判据路由(跨会话→general;会话专属→per-session)。

**协调规则(钉死就不冲突)**:
1. **一条草稿一个归宿**:immediate-long-term / immediate-discard(B 立即)/ deferred-promote / deferred-discard(C)/ 给 D 压成 context。B immediate 当场执行;C/D 只处理 B 标"留temp"的剩余。D 非破坏,C 破坏 → 不抢同一条 raw。
2. **写长期统一路由**:跨会话→general;会话专属→per-session。B 和 C 同判据。
3. **B 标"扔"不立即删**:实际 purge 在 C;D 跳过标 discard 的。
4. **保质期贯穿 B/C/E**:long-term 记录(通用+每会话)带 存期+保质期 字段;B/C 写时赋,E 删时用。
5. **F 用 C flush**:archive 触发 C 跑该 session temp → per-session长期,清空 temp,标 cold。E 仍清 cold(保质期到就删,冷藏≠免死)。
6. **G 路由到 archived 先解档**:重载 per-session长期进活跃集,temp 空,恢复可 recall。
7. **L1 只装 general长期**:per-session 不进 Jarvis L1(按需 recall),L1 慢变缓存稳。
8. **并发写锁(关键)**:多 pass 并发写同一 store 会竞态(B 多 worker 同时 end-hook、C 跑时 B 写、Jarvis turn recall/remember)→ **按 store 分读写锁**:每会话一把(管它的 temp+per-session长期+摘要)+ general长期一把;recall=读锁(并发读),A/B/C/D/E/F=写锁(互斥);单进程内存锁 + `lock.json` 防崩。锁挂 store 不挂 incarnation,单 Jarvis(并发 pass)和多化身(并发 incarnation)同一套都管。

**判 pass 全同套**:主模型低强度(不支持就正常跑),可选独立判模型,零配置。

## 11. 审批:两阶段

### Phase-1（已实现）：竞答 relay + 异步记录

```text
approval/request → 冻结审批上下文
  → live.holdApproval(req, next, command)
  → 原生面板显示命令与批准/拒绝，DSH 原窗口继续可答
  → 任一入口先回答即返回对应 outcome 给 DSH
  → setImmediate 后异步写审批 HTML（§10.1），写失败不影响审批
```

不经过模型自批，也不调用 remember 工具（审批独立保存，recall 按需检索）。`user-questions/request` 同样支持面板与 DSH 竞答；普通问题不生成审批记录。

### Phase-2(后续):四级权限

| 级 | answerer 返回 | 机制 | 社区先例 |
|---|---|---|---|
| 安全 | `allow` | safe 白名单/分类器直接放行 | dsh-approval-gate 白名单 |
| 灰色 | `allow`/`deny`/`escalate` | Jarvis(LLM)读 operation+context+近似历史判断;低置信→`ask_user` | dsh-approval-llm 三态 + ESCALATE |
| 中危 | escalate→relay | 交给用户决定后 relay | 沿用 Phase-1 的人工决定原则 |
| 高危 | `deny`(默认)/`allow`(仅当命中) | `recall` fingerprint 精确同场景 或 用户 preset;**无则 deny + 告知** | dsh-approval-gate 硬风险永远人审 + 操作指纹 |

**Phase-2 两个设计点(现在记,不在本轮)**:
1. **"精确同场景"= fingerprint 定义**:tool + 规范化命令(args 顺序无关、路径相对化?)。Phase-1 schema 现在就记 raw + 规范化两份,Phase-2 直接用。
2. **"用户设定"(preset)**:高危的放行出口——需一种让用户预声明"允许 X 在 Y 场景"的记忆类型(`preferences/*.html`),Phase-2 才做。

## 12. 悬浮窗（原生 macOS）

详细交互以 [UI 规格](docs/superpowers/specs/2026-09-23-jarvis-ui-design.md) 为准：粒子形象、角标、输入条、待处理卡片及可展开对话记录。

- 插件在 webServer 可用时写 `~/.dsh/jarvis/runtime.json`（origin、token、pid、可选 rendererHeader）并启动 `macos/jarvis-panel`，DSH 卸载插件时终止子进程。该文件不给模型。
- IPC 使用 loopback HTTP + token 校验（面板发送 bearer，host 当前也兼容 query token）；面板每次读取 runtime.json，可跟随宿主端口/token 变化。通过 `/jarvis/wait` 长轮询与 `/jarvis/state` 刷新状态。
- 目标“贾维斯”用于直接对话，worker 目标只列托管会话；可展开候选纳入托管、悬停移出，显示任务进度（§9.2）。选中 worker 后文字经 Jarvis 改写再投递。
- 审批/提问卡片可直接回答；↗ 当前把 DSH 带到前台，尚未保证定位到指定会话。对话记录随目标切换，工具调用不逐条显示。
- 面板同步语音活动与声音控制；播报字幕仍待 U1，STT 待 S0/S1。
- 无 webServer 或面板时没有该原生输入入口；仍可在 DSH 的 Jarvis 会话直接输入，原生 DSH 审批/提问照常可用，TTS 不依赖面板。

## 13. 已确认缝的确切签名(核源记录)

```ts
// 获取目标会话的 Agent(dsh-voice-call src/index.ts)
const agents = ctx.get('agents') as { get(id: string): Agent | undefined } | undefined;
const target = agents.get(targetSessionId);

// 向目标会话发消息(dsh-voice-call src/tools/speak.ts 的 injectFailure)
import { MessageId } from '@deepseek-ai/dsh-llm';
import type { UserMessage } from '@deepseek-ai/dsh-llm';
const note: UserMessage = {
  id: MessageId(`jarvis-${...}`),
  role: 'user',
  content: [{ type: 'text', text: message }],
  source: { kind: 'plugin', plugin: 'dsh-harness-jarvis', form: 'notice', summary: '...' },
};
deliver(target, note); // src/sessions.ts：空闲 followup / 运行中 steer / inject 回退；调用方处理失败

// 向 DSH 提问；Jarvis 工具的调用先经过 OutputCoordinator 队列
ctx.userQuestions.ask({
  questions: [...],
  ...(agent ? { agent } : {}),
  ...(signal ? { signal } : {}),
});

// 后台 job（社区可用缝参考，当前 Jarvis 未使用）
ctx.jobs.start({ kind: 'jarvis-...', label, owner?: Agent, run: () => ({cancel, done}) });
// 自定义 kind:declare module '@deepseek-ai/dsh-jobs' { interface JobKindMap { 'jarvis-speak':'jarvis-speak' } }

// 当前审批/提问接线（prepend，与 DSH 默认处理器竞答）
ctx.on('approval/request', (req, next) => live.holdApproval(req, next, command), { prepend: true });
ctx.on('user-questions/request', (req, next) => askInterceptor.answer(req,
  () => disposed || req.signal?.aborted ? next() : live.holdAsk(req, next)), { prepend: true });
// 实际审批 handler 还在 outcome 返回后异步记录，见 §10.1。

// J2 续轮使用 session/event 的 turn/end（reason.kind），不使用 agent/turn-stopping。
// CompletionJudge 判断后，仅 unsatisfied 回注 UserMessage 给 Jarvis：
// ask_user({question, choices?, session?, task?})，续做必须带原样 session/task；
// 用户选择继续 → inject_to_session → deliver(worker, 新 UserMessage)。
// turn/start、移出托管、新任务使旧判断/答案失效。

// scope 隔离(dsh-scope + dsh-system-prompt,已确认)
// section()/tools() 注册"在 calling context 的 scope";scoped section shadow 全局同名
// agent.ctx = agent-scoped 注册面;经它注册只对该 agent 生效(销毁 unwind)
// createAgent/resume 的 setup(agentCtx) 回调给 Jarvis 追加人格+工具(scoped)
```

**注意(rc.6 坑,voice-mini 已踩)**:插件自定义事件绝不写会话日志；rc.6 拒绝历史加载时的未知事件类型，append 的 `jarvis/*` 会毒化日志。自定义状态走内存/HTTP，向会话发内容只用标准 `UserMessage`。

## 14. 差异化(对照 ethanplusai/jarvis,756★,Claude Code 上的贾维斯)

| 维度 | ethanplusai/jarvis | dsh-harness-jarvis |
|---|---|---|
| 宿主 | 包 Claude Code CLI(`claude -p`) | DSH in-framework 插件(原生) |
| 权限 | 全开 `--dangerously-skip-permissions` | **分级/relay**(Phase-1 relay,Phase-2 四级)——对立路线 |
| 完成判断续轮 | 只读 plan checkbox,无续轮闭环 | **判满足→不满足提二次要求→用户批准续轮** |
| TTS | 强绑 Fish Audio BYOK 无 fallback | 内置 edge + voice-mini HTTP 委托 |
| 平台 | macOS + Chrome only | 跨平台 web(vanilla dsh 可跑) |
| 成熟度 | 6 个月 + 756★ + 1640 测试 + 5 条信任决策 | 起步 |

两个最硬的差异化点:**权限分级(它全开的对立面)** + **完成判断续轮闭环(它没有)**。

## 15. 社区先例(都已在 awesome-dsh-plugin,可借鉴)

| 能力 | 先例 | 借鉴点 |
|---|---|---|
| 续轮 | `dsh-loop-continue` | judge 模型判真伪 + steer 续一步 |
| 完成判断 | `dsh-answer-reviewer` / `CAI-MH/dsh-quality-review` | 独立 reviewer 给会话打分 + steer 修 |
| 审批 answerer | `dsh-approval-gate` / `dsh-approval-llm` | 操作指纹+确认制学习 / ALLOW-DENY-ESCALATE 三态 |
| 记忆 | `dsh-engram` | memory palace(我们用更轻的 HTML 文件) |
| 语音缝 API | `dsh-voice-call` | `agent.inject`/`ctx.userQuestions.ask`/`ctx.jobs`/`ctx.get('agents')` |
| host STT | `dsh-voice-scribe` | Alt-to-talk + 本地 SenseVoice |

贾维斯的价值不是单点功能,是**把这些独立品类缝成一个常驻 agent 中枢**——这在 DSH 社区目前是空白。

## 16. 实现范围与后续

**当前已落地**：插件创建/恢复与标题固定、托管集合、任务台账、轮末判断与用户批准续做、完成播报合并和提问排队、审批竞答与异步 HTML 记录、voice-mini 轮末让出、原生面板及任务进度。

**记忆基础能力 M1/M2/M3/M6 已落地。后续按 backlog 推进**：稳定性 W1/O1/T1 与真机验收 Q1；语音输入 S0/S1；审批预设 P0 与分级自动审批 P1。分类器/固化 M4/M5 暂缓，L3 摘要 M7 和多化身 A1 条件触发。唤醒词、跨平台移植不在当前范围。

## 17. 平台移植性(为什么先只做 DSH)

| 能力 | DSH | Cursor | Codex CLI |
|---|---|---|---|
| 主动向会话发消息 | ✅ `agent.inject` | ❌ 无公开 API | ⚠️ stdin 包 CLI |
| 接管权限审批 | ✅ `approval/request` relay | ❌ UI 设置 only | ⚠️ 配置项非 answerer |
| 回答 ask_user_question | ✅ `ctx.userQuestions` | ❌ | ⚠️ stdin |

DSH 是唯一有"一级公民、可组合、可寻址"缝的平台。Cursor/Codex 只能"包 CLI 进程 + 看终端输出"(ethanplusai/jarvis 即如此),脆弱且吃不到审批缝。贾维斯在 DSH 跑通后,移植到其他平台只能做"降级外挂版"(语音反馈 + CLI 包进程,接管审批基本做不到)。

## 18. 待决问题(研究路线图)

**已解决(不再 TBD)**:人设 scope(setup 回调经 `agentCtx`,§3.1/§13)、缓存模型(provider 内容盲,§3.2)、瘦编排+干净 worker+虚拟显示路径(§3.2 重写,**头号风险避开**)、slash 砍掉。

**待研究(优先级)**:

| 优先级 | 模块 | 要定的 |
|---|---|---|
| **P1** | 记忆机制 | **架构闭环**(§10.2 处置分类器 + §10.3 子系统协调含并发锁)。剩余=判据 prompt/few-shot 调参 + 固化阈值/保质期默认值(impl 阶段) |
| ~~P2~~ | ~~分类器~~ ·**砍** | MVP 路由 = 悬浮窗显式选目标（记住上次选择）,不需分类器。未来若要"说话自动判目标"再加 |
| ~~P3~~ | ~~STT~~ ·**MVP 砍** | MVP 不做 STT(悬浮窗文本输入够,无 danger-full-access)。STT(host ASR+热键+danger)后续,见 §6 |
| ~~P4~~ | ~~投影读取~~ ·**moot** | 新路径不投影进模型 context(worker 结果留 worker session)。读 worker 用于对话显示与独立完成判断，不混入 Jarvis 上下文 |
| ~~P5~~ | 悬浮窗(§12)·**设计定稿** | 基于 dsh-notch(已研究)。IPC=runtime.json+HTTP routes(定)。原生面板已实现；后续体验与发布工作见 backlog |
| 次要 | npm 发布包信息 / 自动审批所需精确匹配规则（当前 fingerprint 仅供检索） | |

**头号风险已避开**(§3.2 重写为瘦编排+干净 worker):模型从不看交错 blob(worker 各自干净 surface + Jarvis 瘦 surface),无需 context≠transcript 定制,不动 loop。

实现状态与后续顺序统一维护在 backlog；此处保留后续设计方向，不表示记忆或自动审批已上线。
