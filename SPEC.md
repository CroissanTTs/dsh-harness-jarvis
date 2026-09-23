# dsh-harness-jarvis — 设计 Spec

> 状态:草稿 v0.9 · 2026-09-17
> 单一真相源。MVP 砍 STT(悬浮窗文本输入窗口替代);权限面彻底干净(无 danger-full-access)。多对话核心:瘦编排+干净 worker+虚拟交错显示(§3.2);悬浮窗 dsh-notch 基(§12)。待研究:次要(见 §18)。

---

## 0. 一句话

**贾维斯是暴露给用户的"概念与感觉"**(管家/指挥官体验);**本体是一个被贾维斯插件"塑造"过的普通 DSH agent**:cordis.yml config 声明 → loop 启动时 create/resume → 贾维斯 hook `agent/created` 经 `agent.ctx` 给它追加指挥官人格 + 编排工具 + 共享记忆 + 锁(scoped 到该 agent),跑在正常 DSH loop 上——**不是单独引擎**。外加**文本输入入口(悬浮窗)**+ 悬浮窗(具象)。STT 后续、不进 MVP。**生命周期 = agent 生命周期,关 DSH 即关贾维斯。**

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
| `ctx.on('session/event')`(`turn/end`、`approval/asked`、`ask_user_question`、`turn/start`、`todo/write`、`assistant/message`) | 事件桥监听托管会话 | voice-mini 实证 |
| `ctx.get('agents').get(sessionId)` → `Agent` | 按会话 id 拿目标 Agent | dsh-voice-call 实证 |
| `agent.inject(UserMessage)` | 向目标会话发消息(双向) | dsh-voice-call 实证(确切签名见 §13) |
| `ctx.userQuestions.ask({questions, agent?, signal?})` | 语音问用户拿回答(relay) | dsh-voice-call 实证 |
| `ctx.jobs.start({kind, label, owner?, run})` + `declare module 'dsh-jobs'` | 后台任务 + 自定义 job kind | dsh-voice-call 实证 |
| `ctx.inject(['llm']).stream()` + `BlockAssembler` | answerer/续轮里纯推理 | voice-mini 实证 |
| `ctx.get('approval')`(PreToolDecision `allow`\|`deny`\|`ask`) | 守门人审批 answerer | dsh-tools 类型实证 |
| `ctx.inject(['systemPrompt']).section({name, order, text})` | 给 Jarvis 会话灌人设 | voice-mini 实证 |

### 可选层(全部 graceful,在就增强,不在就降级)

| 可选层 | 在 | 不在 |
|---|---|---|
| `ctx.inject(['webServer'])`(dsh-host-webserver) | 挂状态/mic/悬浮窗 IPC 路由 + 客户端面板 | 纯 host 跑 |
| `ctx.inject(['settings'])`(dsh-settings) | 出现在设置页 | 自己持久化 `~/.dsh/jarvis/config.json`(同 voice-mini) |
| `ctx.inject(['sessionTitle'])` | 会话名好听 | 用 cwd basename |
| `desktopBrowserAccess`(dsh-desktop) | 原生宠物(若做) | 无宠物 |
| 外部 TTS 服务(`voice:tts` 约定,见 §5) | 切到它(白嫖音色/口播化) | 内置 TTS |

**原则**:核心层只用核心脊梁服务 → vanilla dsh 能跑;可选层全部 `ctx.inject` graceful 或 `ctx.get` 机会式,任一缺失不崩。

## 3. 生命周期与组装

Jarvis agent = cordis.yml config 声明的普通 DSH agent,loop 启动时 create/resume;贾维斯 hook `agent/created` 经 `agent.ctx` 给它追加(scoped):指挥官人格 section + 编排工具 + agent-scoped listener(续轮/完成判断)。该 agent 用**正常 DSH loop** 跑——贾维斯不造引擎。组装流程见 §3.1。

每轮 Jarvis(模型)推理后三选一:
- (a) 与用户沟通:仅对话 / 讨论执行计划 / 询问是否执行某思路
- (b) 调用工具向具体会话发内容:`inject_to_session`(硬约束:不能发给自己,且 ∈ 托管集)
- (c) 监听某会话的状态与最后结果:`monitor_session` → 事件桥把状态/turn-end 注入回 Jarvis

**生命周期 = agent 生命周期**:关 DSH 即关贾维斯。无"常驻进程"原语。多个"单独 llm.stream() pass"被吸收进 Jarvis agent 本轮推理(优化说法、完成判断、给审批解释都是它自己想)。

### 3.1 组装流程(贾维斯两挂点)

```
[DSH 启动] → Cordis 读 cordis.yml
  → 核心服务 mount(dsh-scope/session/agent/system-prompt/tools/llm/user-questions/jobs,全 scope-scoped)
  → dsh-agent-loop mount(AgentFactory,读 config 的 agents:[...])
  → host 层 mount(可选,与插件并发)
  → 插件层 mount ← ★贾维斯 apply()【挂点1·全局】★
       · 审批 answerer(ctx.get('approval') 缝)
       · 全局 listener:agent/created(装饰 Jarvis agent)+ session/event(filter 到 worker)
       · 内置 TTS 服务 voice:tts(voice-mini 在则消费它)
       · 锁状态 + .jarvis 共享状态(插件进程内,跨 agent)
       · ctx.inject(['webServer']) 挂悬浮窗 IPC 路由(可选)
  → loop 按 cordis.yml 的 agents:[{id:'jarvis',...}] create/resume Jarvis agent
  → agent/created 事件 ★贾维斯 hook【挂点2·per-agent scoped】★
       · 经 agent.ctx 注册:指挥官人格 section(scoped)
       · 贾维斯工具 inject_to_session/recall/remember/monitor_session/ask_user/say_to_user(scoped)
       · agent-scoped listener:turn-stopping(续轮)、turn/end(完成判断)
  → Jarvis agent 跑首轮:loop 组装 system prompt(scope-scoped sections)+ 可见工具(scope-scoped)
    → Jarvis 此刻看到指挥官人格+贾维斯工具;worker 会话看不到 → 不污染
```

**两挂点切分**:挂点1(全局)= 跨 agent/跨会话的东西(answerer / 全局 listener / TTS / 锁 / 共享状态 / IPC);挂点2(per-agent scoped)= 只属于 Jarvis agent 的(人格 / 工具 / 续轮 listener)。隔离靠 scope-scoped 注册自然成立,不靠 mode。

### 3.2 瘦编排 agent + 干净 worker + 虚拟交错显示(多对话核心)

- **worker 各自是独立干净 session**:每个 worker 有自己的 SessionID / cwd / transcript,**model context = 它自己的干净 surface**(`session.deriveMessages()`,已确认 dsh-session)。worker 的活在它自己 session 里跑,工具在它自己 cwd。worker 互不交错。
- **Jarvis = 瘦编排 agent**:自己的独立 session(lean),只干**路由 / 口播 / inject 决策 / 续轮判断的编排**,**不堆 worker 内容**进自己 surface。Jarvis surface 保持瘦(决策日志)。
- **完成判断等放 worker session 里跑**(像 dsh-answer-reviewer 那样的 reviewer,在 worker 的干净 context 里判),不挪进 Jarvis surface。
- **虚拟交错显示**:用户看"一个 Jarvis 管 A/B/C、交错展示"是**虚拟视图**(从 worker sessions + Jarvis 路由渲染出来),**不是 Jarvis session 的真 surface**——这样 Jarvis surface 才能保持瘦。
- **模型从不看交错 blob**:worker 的 model call 用它自己干净 surface;Jarvis 的 model call 用它瘦 surface。两头都干净,**无需"过滤 transcript"——头号风险(context≠transcript)moot**。
- **路由(显式,无默认)**:用户在悬浮窗**选中目标会话** → 在输入窗口打字 → 发 Jarvis(瘦)→ 优化说法 + `inject_to_session(目标)`。**无默认场景——必须显式选会话再输入**;不靠分类器自动判(MVP 砍 P2)。见 §6/§12。
- **输出锁**:输出渠道只有一个(单 Jarvis),多 worker 抢着跑 → 锁协调"现在哪个 worker 的 turn 独占"(类多线程)。跟记忆写锁(§10.3 规则8)是两回事,同一套锁思路。
- **激活** = 拉上下文思考;输入 → Jarvis 路由 → inject 进目标 worker → worker loop 跑(激活);Jarvis 自己的路由决策也在它瘦 session 里跑一轮。
- **缓存**:worker session 各自稳定前缀(append)→ 命中;Jarvis 瘦 session 也稳定。切 worker = 切到那个 worker 的 session(各自 prefix)。条件:同 provider/key + TTL 内 + append-stable。
- **session 数 = 1(Jarvis 瘦)+ N(worker 干净)**;worker 和 workspace 一一对应(cwd,见 §9.2)。
- **不动 loop、不分叉、不自定义 context 插件**:用 DSH 默认 loop,worker 各自干净 session + Jarvis 瘦编排即可。早先"分类器预判组装该会话分离流 + context≠transcript 风险"那套被这条路取代、不再需要。

## 4. 半托管定位

贾维斯是**半托管**会话助手:**权限只有两个核心功能**——① 管理会话(向托管会话发消息、监听其状态/结果)② 与用户反馈(口播、语音问)。**拍板永远在用户**;贾维斯不自作主张批准(Phase-1)。分级自动批准是 Phase-2 的后续优化(见 §11)。

## 5. TTS:内置 + 服务检测切换

- **内置 host 端 TTS**(零依赖、永远能响):edge-tts 云端 + host 播放(`afplay` macOS / SoundPlayer Windows / `aplay` Linux),与 voice-mini 默认后端同款。
- **TTS service 约定**(DSH 目前无原生 TTS service 缝——voice-mini / dsh-voice-call 都把 speak 注册成 tool 不是 service):
  - 服务名:`voice:tts`(暂定,待确认 DSH 服务目录有无现成名)
  - 接口:`synthesize(text, opts) → audioPath` + `play(path)`
- 贾维斯 `ctx.inject(['voice:tts'], graceful)` 机会式消费:有插件注册就用(白嫖音色/口播化/宠物);没有用内置。
- voice-mini 加一段**可选** `ctx.set('voice:tts', {...})` 导出(非破坏,自己照跑)→ 两者同装时贾维斯自动切到 voice-mini,各自独立、互不硬依赖。

## 6. 输入:MVP 用悬浮窗文本输入窗口(STT 后续)

**MVP 不做 STT**——不引 host mic / 本地 ASR / `danger-full-access`,权限面彻底干净(STT 本是唯一重权限点,砍了就没了)。入口 = 悬浮窗**文本输入窗口**(打字)。

- **MVP 入口**:悬浮窗里**选中目标会话**(无默认,必须显式选)→ 在输入窗口打字 → 发给 Jarvis(瘦)→ 优化说法 + `inject_to_session(目标)`。
- **STT(后续,不在 MVP)**:host 端 ASR(SenseVoice/whisper-local,参考 dsh-voice-call transcribe、dsh-voice-scribe)+ 快捷键/点按说话;要 `danger-full-access`,信任边界收口(只在 trigger 时采、音频不出本机、引擎进程隔离)。与"严厉禁止高位危权限"有张力,故留后续、不进 MVP。
- 不选唤醒词 always-on(常驻 mic,重且隐私张力大)。

## 7. 工具面(贾维斯插件暴露给 Jarvis 会话调的工具)

| 分支 | 工具 | 参数(草稿) | guard |
|---|---|---|---|
| (a) 与用户沟通 | `say_to_user` | `{text}` | voice-mini 在→委托其 speak;不在→内置 edge-tts |
| | `ask_user` | `{question, choices?}` | 包 `ctx.userQuestions.ask`;用于"是否执行思路"、续轮批准、审批 relay |
| (b) 向会话发内容 | `inject_to_session` | `{session, message}` | **target ≠ Jarvis 自己 且 ∈ 托管集**;包 `agents.get(id).inject(UserMessage)` |
| (c) 监听会话 | `monitor_session` | `{session}` | target ∈ 托管集;纳入监听集后事件桥对其触发 |
| | `stop_monitoring` | `{session}` | 移出监听集 |
| 辅助(随时可调,非分支) | `recall` | `{query}` | grep `~/.dsh/jarvis/{temp,memory}/*`(JSONL+HTML) + 读 top hits;返回**关键点 + 源指针**(§10 原则1) |
| | `remember` | `{tag, content, intent?, session?, ...}` | **显式写长期**(HTML);auto 抓的走 temp(JSONL),见 §10 |
| | `list_managed` | — | 返回托管集 + 当前监听集 |

**待定**:`read_session({session})`(读某托管会话最近结果)——可能被 monitor 的事件注入覆盖,不需要单独工具。落地时定。

## 8. 事件桥(插件监听器,只对 `monitor_session` 纳入的会话触发)

| 托管会话事件 | 动作 |
|---|---|
| `turn/end` | 注入回 Jarvis 会话:"会话 X 结束,结果摘要:…" + `recall(原始需求)` → Jarvis 判满足度 → 满足走 (a)`say_to_user` 口播 / 不满足走 (a)`ask_user` 问续轮 → 你点头则 (b)`inject_to_session` 注入"继续 X" |
| `approval/asked` | answerer 处理(Phase-1:`ask_user` relay 用户决定 + `remember` 写审批记录含 context;Phase-2:分级规则,见 §11) |
| `ask_user_question` | 拦截:低风险从上下文答 / 拿不准 `ask_user` 升级给用户(relay) |

事件桥用 `agent.inject(UserMessage)` 把 heads-up 注入回 Jarvis 会话(双向 inject 的"事件→Jarvis"方向)。`turn/end`→判断→续轮的自然流复用社区先例 `dsh-loop-continue`(judge + steer one more step)。

## 9. Jarvis agent 来源 + 托管集

### 9.1 Jarvis agent(本体)
- **cordis.yml config 声明**:`agentLoop.agents:[{id:'jarvis', provider, model, sessionId?, cwd?}]` → loop 启动时 create/resume。
- 贾维斯 hook `agent/created`,判断"是 Jarvis agent"(by config `id` 或 `meta.agentPreset` 标签)→ 经 `agent.ctx` 追加人格+工具+listener(scoped,见 §3.1 挂点2)。
- **MVP:单 Jarvis agent**(config 声明一个)。多化身(按需 `ctx.agentLoop.createAgent(...)` 造额外化身)是后续。
- **两把锁,都 MVP 需要**:① **记忆写锁**(§10.3 规则8,并发 pass 写记忆);② **输出锁**(§3.2,单输出渠道 vs 多会话流抢输出,协调哪个会话 turn 独占)。都不靠多化身。
- **不造引擎、不 live 切 mode**:scope 在 create 时组装,不是运行时 flip。

### 9.2 托管集(worker 会话,被管对象)
- 用户把某会话"交给贾维斯"→ 进托管集。入口:语音("贾维斯,管 hammer 这个会话")或 web 会话头开关(`conversation.session.header.actions` 槽,web 在时)。持久化 `~/.dsh/jarvis/managed.json`。
- `inject_to_session` / `monitor_session` 的 target 必须 ∈ 托管集。
- **托管 ≠ 监听**:托管集 = 贾维斯**可以**管的会话(安全边界);监听集 = Jarvis 本轮**主动选择** `monitor_session` 的子集(动态)。
- **worker 各在各 workspace**:每个 worker session 的 `cwd` = 它那个项目目录(`SessionHeader.cwd`,已确认,dsh-session);worker 的工具在它自己 cwd 里跑。worker **不嵌套在 Jarvis 下**,Jarvis 按 session id 引用、不动 cwd。Jarvis 是跨 workspace 的编排者。
- **worker 来源**:用户已有 session(已在各自 cwd)→ Jarvis 按 id 托管;或 Jarvis 按需 `ctx.agentLoop.createAgent({sessionId, meta:{cwd:<项目目录>}, ...})` / `resume` 造,给它那个 cwd。
- **worker 标题前缀(必需)**:Jarvis 造/托管的 worker,title 加 **"贾维斯-"(或 "[贾维斯]")前缀**(经 sessionTitle 服务 / session meta),让用户认得是贾维斯管的、不是没用散落的会话。已有 session 托管时优先加标记而非改名。

### 9.3 多对话管理
Jarvis 管 N 个 worker:见 §3.2(瘦编排 + 干净 worker)。**session 数 = 1(Jarvis 瘦)+ N(worker 干净)**——管理是 Jarvis 用 `inject_to_session`/`monitor_session` 作用于 worker,不造额外"管理 session"。worker 各自 linear transcript,互不交错。**输出锁**(单输出渠道 vs 多流)MVP 就需要(§3.2);多化身后续。

## 10. 记忆(两级:temp JSONL + 长期 HTML)

- **临时记忆 temp**:`~/.dsh/jarvis/temp/*.jsonl`,一行一事件(append-only,机器友好)。
- **长期记忆**:`~/.dsh/jarvis/memory/*.html`(语义标签,可 grep+read,人/agent 可读)。
- **捕获(hybrid)**:插件自动抓 Jarvis/worker 的 `session/event`(assistant/message、tool 结果、turn 边界)写 temp(无感、不丢);Jarvis 显式 `remember` 写**长期**(curated 提升)。到长期两条路:① **固化**(auto,temp→长期)② **Remember**(显式)。
- **固化触发**(四选一):temp 达阈值 / 用户主动 / 阶段完成 / 定时。
- **原则1 关键点 + 源指针**:记忆存关键点 + 源 session 指针;细节不进记忆(指回 worker transcript / 提示用户看 session)→ 多 worker 也不爆。
- **原则2 最终结果优先压缩**:固化/摘要 model pass 时 weight final result,压过程/解释(agent 可靠性/鲁棒性等)。
- **原则3 处置分类器(待细化,见 §18 P1)**:被监听 worker 的 end hook → 分类器逐条判 **4 去向**:丢弃 / 直接入 temp / 直接入长期 / 触发 Remember。**必须动态、可优化**(模型 pass + 规则护栏,可调)。
- **注入(瘦编排下)**:**L1** 稳定 `section`(general 长期关键点,scoped 到 Jarvis,缓存前缀命中)+ **L4** `recall` 工具(Jarvis / worker reviewer 按需拉,关键点+源指针)。worker 的完成判断在 worker session 里跑(reviewer,§3.2),按需 `recall` 它的 per-session 长期。**L2/L3**(per-session temp 注入某 context)在瘦编排 MVP 不用(Jarvis 瘦、不堆 worker temp);后续若 worker reviewer 要注入再上。
- **多会话源标注**:每条 temp/长期标 source session id;`recall` 可按 session 过滤;可跨会话综合。
- 选 HTML(长期)是为标签结构化、可按 intent/session/status 检索;JSONL(temp)为机器友好(易 grep/喂摘要模型/append)。

### 10.1 审批记忆 schema(Phase-1 就绪 / Phase-2 可消费)

```html
<!-- ~/.dsh/jarvis/memory/approvals/<fingerprint>-<ts>.html -->
<approval fingerprint="bash:rm-rf:node_modules" ts="2026-09-17T10:30Z">
  <session id="hammer" cwd="~/.../dsh-voice-mini" />
  <operation tool="bash" command="rm -rf node_modules" args="rm,-rf,node_modules" />
  <context>用户任务:给 voice-mini 补动图引流;本轮在清理 audioDir</context>
  <decision allow="false" source="user" reason="用户拒绝:删 node_modules 风险高" />
  <tier value="" notes="Phase1:未分级,Phase2回填" />
</approval>
```

| 字段 | Phase-1 作用 | Phase-2 作用 |
|---|---|---|
| `fingerprint`(tool+规范化命令) | 唯一标识 | 高危"精确同场景"匹配键(≈ dsh-approval-gate 操作指纹) |
| `operation`(raw tool/命令/参数) | 留底 | 灰权限判断的推理素材 |
| `context`(Jarvis 对当前任务的理解) | 你要的"附上下文" | 灰权限 LLM 判断的上下文 |
| `decision`(source=Phase1 永远 user / allow / reason) | 记录用户决定 | 高危"找到先例则按先例"的数据源 |
| `tier`(Phase1 留空) | — | Phase-2 分类器回填 safe/grey/medium/high,可对全语料重新分级 |

**关键设计**:**Phase-1 写的记忆带上下文,就是 Phase-2 高危先例 + 灰权限判断要吃的数据**。Phase-1 不是"傻瓜转述以后推倒",是给 Phase-2 喂原子样本。所以 schema 现在就得 Phase-2 就绪。

### 10.2 处置分类器(end-hook 的"衡量标准")

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

### 10.3 记忆子系统:存储 + 流程 + 协调

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

### Phase-1(本轮):纯 relay + 记忆

```
托管会话 approval/asked
  → Jarvis 经 ctx.userQuestions.ask 提问:"会话 hammer 要 rm -rf node_modules,批吗?"
     (悬浮窗显示 op + context + 批准/拒绝按钮,见 §12;无悬浮窗则纯文本问)
  → 你点选按钮 / 打字答 yes/no(MVP 用悬浮窗按钮;口头答需 STT 后续)
  → answerer 把你的决定 relay 回 ctx.get('approval')
  → 同时 remember() 写一条 approval 记录(§10.1 schema,含 context,fingerprint,tier 留空)
```

贾维斯**永不自批**,只传话 + 记录。记录带上下文是为 Phase-2 攒样本。完全落在已确认缝。

### Phase-2(后续):四级权限

| 级 | answerer 返回 | 机制 | 社区先例 |
|---|---|---|---|
| 安全 | `allow` | safe 白名单/分类器直接放行 | dsh-approval-gate 白名单 |
| 灰色 | `allow`/`deny`/`escalate` | Jarvis(LLM)读 operation+context+近似历史判断;低置信→`ask_user` | dsh-approval-llm 三态 + ESCALATE |
| 中危 | escalate→relay | 直接 `ask_user` 问你,拿决定 relay | = Phase-1 逻辑 |
| 高危 | `deny`(默认)/`allow`(仅当命中) | `recall` fingerprint 精确同场景 或 用户 preset;**无则 deny + 告知** | dsh-approval-gate 硬风险永远人审 + 操作指纹 |

**Phase-2 两个设计点(现在记,不在本轮)**:
1. **"精确同场景"= fingerprint 定义**:tool + 规范化命令(args 顺序无关、路径相对化?)。Phase-1 schema 现在就记 raw + 规范化两份,Phase-2 直接用。
2. **"用户设定"(preset)**:高危的放行出口——需一种让用户预声明"允许 X 在 Y 场景"的记忆类型(`preferences/*.html`),Phase-2 才做。

## 12. 悬浮窗(基于 dsh-notch)

> 参考实现:[aa2246740/dsh-notch](https://github.com/aa2246740/dsh-notch)(voice-mini `pet/` 也抄它)。已研究其悬浮窗设计 + 内容显示规则,据此定稿。

- **形态(抄 dsh-notch)**:两部分——① **Host 插件**(同步会话,依赖 `sessions`/`webServer`/`approval`/`userQuestions`/`agents`,与贾维斯已确认缝一致);② **原生 Notch 程序**(`macos/` Swift AppKit/SwiftUI/Canvas,独立二进制,用户单独启动)。`~/.dsh/jarvis/runtime.json`(origin+token+pid+rendererHeader)自动管、不给 Agent;原生窗靠它发现插件。
- **IPC(定了)**:`runtime.json` + **HTTP routes**(loopback + bearer 守卫,同 voice-mini `pet.ts` / dsh-notch)。**要 webServer**(Desktop 语境);webServer 不在 → 悬浮窗不可用(贾维斯 core 仍 web 无关)。
- **显示规则(抄 dsh-notch)**:蓝数=运行中 worker 数、黄感叹=待处理问题/审批、绿数=未读完成结果、红数=失败、全空=待机形象;窗口随内容展开 + 达屏高上限后滚动;动画不调模型;系统"减少动态效果"→静态。
- **交互规则(抄 dsh-notch)**:点问题选项→直接提交(=答 userQuestion / 审批 relay,§11);点问题标题→回 DSH 看完整上下文;点会话→回 DSH。
- **贾维斯特有(在 dsh-notch 上加)**:
  - **会话选择 + 文本输入(=路由+入口)**:悬浮窗列托管会话(带"贾维斯-"前缀,§9.2),用户选中一个 → 在**输入窗口打字** → 发 Jarvis(瘦)→ 优化说法 + `inject_to_session(目标)`。**无默认,必须显式选**(MVP 砍 P2)。选中即路由,打字即输入。
  - **STT(后续,不在 MVP)**:点按说话→host ASR,见 §6。MVP 用文本输入替代。
  - **口播状态**:显示 Jarvis 在说什么/想什么(口播内容 + 思考状态),来自 TTS/verbalizer。
- **无悬浮窗 fallback**:无 webServer / 无悬浮窗 → 仅 host TTS 口播 + 日志,**无输入入口**(不能发会话)、审批走纯语音 `ctx.userQuestions.ask` relay。
- 待办:默认形象资源(先用占位;后续可接 OpenBotMotion 类待机机器人,dsh-notch 用 OpenBotMotion)。

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
target.inject(note);   // 包 try/catch:agent 可能 mid-job disposed

// 语音问用户(dsh-voice-call src/index.ts 的 askChannel)
ctx.userQuestions.ask({
  questions: [...],
  ...(agent ? { agent } : {}),
  ...(signal ? { signal } : {}),
});

// 后台 job(dsh-voice-call src/tools/speak.ts)
ctx.jobs.start({ kind: 'jarvis-...', label, owner?: Agent, run: () => ({cancel, done}) });
// 自定义 kind:declare module '@deepseek-ai/dsh-jobs' { interface JobKindMap { 'jarvis-speak':'jarvis-speak' } }

// 审批缝(dsh-tools lib/types/index.d.ts)
// PreToolDecision = {kind:'allow'} | {kind:'deny',reason} | {kind:'ask',reason?}
// ask 经 ctx.get('approval') 机会式消费;无 ApprovalService 则 fail-closed 到 deny

// 续轮缝(dsh-agent runtime-types.d.ts,已确认)
// agent/turn-stopping 事件(turn 要关闭时,scope-filtered)→ 监听器 agent.steer(UserMessage)
//   machine 重读 inbox 再跑一步 = dsh-loop-continue 的机制,贾维斯续轮直接用

// scope 隔离(dsh-scope + dsh-system-prompt,已确认)
// section()/tools() 注册"在 calling context 的 scope";scoped section shadow 全局同名
// agent.ctx = agent-scoped 注册面;经它注册只对该 agent 生效(销毁 unwind)
// agent/created 事件 → 在此经 agent.ctx 给 Jarvis agent 追加人格+工具(scoped)
```

**注意(rc.6 坑,voice-mini 已踩)**:插件自定义会话事件必须 `durableEvents=false`——rc.6 拒绝历史加载时的未知事件类型,append 的 `jarvis/*` 事件会毒化会话日志。贾维斯事件走内存/WebSocket,别写会话日志。

## 14. 差异化(对照 ethanplusai/jarvis,756★,Claude Code 上的贾维斯)

| 维度 | ethanplusai/jarvis | dsh-harness-jarvis |
|---|---|---|
| 宿主 | 包 Claude Code CLI(`claude -p`) | DSH in-framework 插件(原生) |
| 权限 | 全开 `--dangerously-skip-permissions` | **分级/relay**(Phase-1 relay,Phase-2 四级)——对立路线 |
| 完成判断续轮 | 只读 plan checkbox,无续轮闭环 | **判满足→不满足提二次要求→用户批准续轮** |
| TTS | 强绑 Fish Audio BYOK 无 fallback | 多后端(内置 edge + voice:tts 服务检测) |
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

## 16. 本轮范围 / 不在本轮

**本轮(Phase-1)**:
- 插件骨架(名/依赖分层/核心缝/内置 TTS/工具面/事件桥/记忆/relay answerer)
- 悬浮窗 dsh-notch 基(runtime.json + HTTP routes,§12)
- 输入:悬浮窗文本输入窗口(STT 不进 MVP,后续见 §6)
- 审批:纯 relay + 记忆(带 context)

**不在本轮**:
- Phase-2 四级权限规则(安全/灰色/中危/高危)
- 全局快捷键实现(留接口)
- 唤醒词 always-on
- 真贾维斯悬浮窗(等参考链接)
- slash 命令(暂不需要;后续可能作文本控制面)
- 多化身(MVP 单 Jarvis agent;按需 createAgent 造额外化身是后续)——注:**锁不是后续**(记忆写锁+输出锁都 MVP 需要,§9.1/§10.3 规则8)
- 跨平台移植(Cursor/Codex——它们不支持会话注入/审批接管,见 §17)

## 17. 平台移植性(为什么先只做 DSH)

| 能力 | DSH | Cursor | Codex CLI |
|---|---|---|---|
| 主动向会话发消息 | ✅ `agent.inject` | ❌ 无公开 API | ⚠️ stdin 包 CLI |
| 接管权限审批 | ✅ `ctx.get('approval')` answerer | ❌ UI 设置 only | ⚠️ 配置项非 answerer |
| 回答 ask_user_question | ✅ `ctx.userQuestions` | ❌ | ⚠️ stdin |

DSH 是唯一有"一级公民、可组合、可寻址"缝的平台。Cursor/Codex 只能"包 CLI 进程 + 看终端输出"(ethanplusai/jarvis 即如此),脆弱且吃不到审批缝。贾维斯在 DSH 跑通后,移植到其他平台只能做"降级外挂版"(语音反馈 + CLI 包进程,接管审批基本做不到)。

## 18. 待决问题(研究路线图)

**已解决(不再 TBD)**:人设 scope(scope-scoped 经 `agent.ctx`,§3.1/§13)、缓存模型(provider 内容盲,§3.2)、瘦编排+干净 worker+虚拟显示路径(§3.2 重写,**头号风险避开**)、slash 砍掉。

**待研究(优先级)**:

| 优先级 | 模块 | 要定的 |
|---|---|---|
| **P1** | 记忆机制 | **架构闭环**(§10.2 处置分类器 + §10.3 子系统协调含并发锁)。剩余=判据 prompt/few-shot 调参 + 固化阈值/保质期默认值(impl 阶段) |
| ~~P2~~ | ~~分类器~~ ·**砍** | MVP 路由 = 悬浮窗显式选会话(无默认),不需分类器。未来若要"说话自动判目标"再加 |
| ~~P3~~ | ~~STT~~ ·**MVP 砍** | MVP 不做 STT(悬浮窗文本输入够,无 danger-full-access)。STT(host ASR+热键+danger)后续,见 §6 |
| ~~P4~~ | ~~投影读取~~ ·**moot** | 新路径不投影进模型 context(worker 结果留 worker session)。读 worker 仅用于虚拟显示渲染 |
| ~~P5~~ | 悬浮窗(§12)·**设计定稿** | 基于 dsh-notch(已研究)。IPC=runtime.json+HTTP routes(定)。剩余=默认形象资源 + 原生 Notch 构建(macOS Swift) |
| 次要 | TTS service 名查证 / `agent/created` 怎么识别 Jarvis(config id vs preset 标签)/ `resume`-转换-live 会话(MVP config 声明可能不需要)/ npm scoped 与否 / fingerprint 规范化(Phase-2) | |

**头号风险已避开**(§3.2 重写为瘦编排+干净 worker):模型从不看交错 blob(worker 各自干净 surface + Jarvis 瘦 surface),无需 context≠transcript 定制,不动 loop。

**P1 闭环;头号风险避开;P2/P4/P5 关闭,P3 MVP 砍;MVP 权限面彻底干净(无 danger-full-access)。下一步=次要 TBD(TTS service 名 / agent/created 识别 / npm scoped)或开始搭骨架。**
