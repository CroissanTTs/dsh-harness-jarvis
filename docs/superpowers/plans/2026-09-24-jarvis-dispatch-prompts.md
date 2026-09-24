# 贾维斯待办派发 Prompt

> 由维护会话生成，与 `2026-09-24-jarvis-backlog.md` 配套。按顺序把代码块整段交给新会话；同阶段内标了可并行的可以同时派发。
> 每条完成后可以回到维护会话，让它核实并更新清单。条目内容变化时维护会话会同步修改本文件。

## 阶段 2：闭环收尾

### 1. J5 voice-mini 让出托管会话的轮末播报

```text
在 /Users/zane/Vibe coding/dsh-plugin-discovery/dsh-harness-jarvis 实现待办条目 J5（voice-mini 让出托管会话的轮末播报），用中文回复我。
先读 docs/superpowers/plans/2026-09-24-jarvis-backlog.md 的「0. 使用方法」「2. 通用约定」和条目 J5 全文，然后严格按使用方法执行：确认前置（J2）已在 main 上 → 按通用约定 2.3 从最新 main 建独立 worktree 和分支 codex/j5-voice-mini-yield（不要在主目录切分支） → 把 J5 状态改为进行中 → 实现并按“等价类 / 边界值 / 异常路径”写测试 → 插件测试、面板测试、构建全部通过后提交 → 更新状态与实现记录 → 快进合回 main，并在主目录重新构建 → 汇报。
本条注意：跨两个仓库：voice-mini 仓库在 /Users/zane/Vibe coding/dsh-plugin-discovery/dsh-voice-mini，那边也开同名分支、单独提交并合回它自己的 main；voice-mini 的测试是 test-jarvis-speech.mjs。贾维斯侧通过 ctx.provide('jarvis') 暴露 claimsTurnEnd。
```

### 2. J4 输出协调

```text
在 /Users/zane/Vibe coding/dsh-plugin-discovery/dsh-harness-jarvis 实现待办条目 J4（输出协调），用中文回复我。
先读 docs/superpowers/plans/2026-09-24-jarvis-backlog.md 的「0. 使用方法」「2. 通用约定」和条目 J4 全文，然后严格按使用方法执行：确认前置（J2）已在 main 上 → 按通用约定 2.3 从最新 main 建独立 worktree 和分支 codex/j4-output（不要在主目录切分支） → 把 J4 状态改为进行中 → 实现并按“等价类 / 边界值 / 异常路径”写测试 → 插件测试、面板测试、构建全部通过后提交 → 更新状态与实现记录 → 快进合回 main，并在主目录重新构建 → 汇报。
本条注意：只在 src/index.ts 把 CompletionJudge 的 deps.say 换成协调器，不改 completion.ts 内部；ask_user 的 session/task 参数必须原样保留。
```

### 3. J0 修复贾维斯会话标题设置

```text
在 /Users/zane/Vibe coding/dsh-plugin-discovery/dsh-harness-jarvis 实现待办条目 J0（修复贾维斯会话标题设置），用中文回复我。
先读 docs/superpowers/plans/2026-09-24-jarvis-backlog.md 的「0. 使用方法」「2. 通用约定」和条目 J0 全文，然后严格按使用方法执行：确认前置（无）已在 main 上 → 按通用约定 2.3 从最新 main 建独立 worktree 和分支 codex/j0-title（不要在主目录切分支） → 把 J0 状态改为进行中 → 实现并按“等价类 / 边界值 / 异常路径”写测试 → 插件测试、面板测试、构建全部通过后提交 → 更新状态与实现记录 → 快进合回 main，并在主目录重新构建 → 汇报。
本条注意：标题服务 rename 的第一个参数是会话对象（ctx.get('sessions').get(id)），不是 id；同时删掉每轮重设标题和打印消息数的诊断日志。可以和 J3 并行。
```

### 4. J3 审批记录

```text
在 /Users/zane/Vibe coding/dsh-plugin-discovery/dsh-harness-jarvis 实现待办条目 J3（审批记录），用中文回复我。
先读 docs/superpowers/plans/2026-09-24-jarvis-backlog.md 的「0. 使用方法」「2. 通用约定」和条目 J3 全文，然后严格按使用方法执行：确认前置（无（J1 已在 main））已在 main 上 → 按通用约定 2.3 从最新 main 建独立 worktree 和分支 codex/j3-approval-records（不要在主目录切分支） → 把 J3 状态改为进行中 → 实现并按“等价类 / 边界值 / 异常路径”写测试 → 插件测试、面板测试、构建全部通过后提交 → 更新状态与实现记录 → 快进合回 main，并在主目录重新构建 → 汇报。
本条注意：先把审批结果返回给 DSH，再异步写文件，写失败绝不能影响审批；HTML 必须转义；M1 还没合入就直接原子写文件。
```

### 5. U2 目标列表显示任务进度

```text
在 /Users/zane/Vibe coding/dsh-plugin-discovery/dsh-harness-jarvis 实现待办条目 U2（目标列表显示任务进度），用中文回复我。
先读 docs/superpowers/plans/2026-09-24-jarvis-backlog.md 的「0. 使用方法」「2. 通用约定」和条目 U2 全文，然后严格按使用方法执行：确认前置（J1、J2）已在 main 上 → 按通用约定 2.3 从最新 main 建独立 worktree 和分支 codex/u2-task-state（不要在主目录切分支） → 把 U2 状态改为进行中 → 实现并按“等价类 / 边界值 / 异常路径”写测试 → 插件测试、面板测试、构建全部通过后提交 → 更新状态与实现记录 → 快进合回 main，并在主目录重新构建 → 汇报。
本条注意：插件和面板两边都改；面板加快照场景 18-targets-task-state，生成后用 Read 打开截图确认显示正常。
```

### 6. J8 清理与 SPEC 同步

```text
在 /Users/zane/Vibe coding/dsh-plugin-discovery/dsh-harness-jarvis 实现待办条目 J8（清理与 SPEC 同步），用中文回复我。
先读 docs/superpowers/plans/2026-09-24-jarvis-backlog.md 的「0. 使用方法」「2. 通用约定」和条目 J8 全文，然后严格按使用方法执行：确认前置（无（放在本阶段最后））已在 main 上 → 按通用约定 2.3 从最新 main 建独立 worktree 和分支 codex/j8-cleanup（不要在主目录切分支） → 把 J8 状态改为进行中 → 实现并按“等价类 / 边界值 / 异常路径”写测试 → 插件测试、面板测试、构建全部通过后提交 → 更新状态与实现记录 → 快进合回 main，并在主目录重新构建 → 汇报。
本条注意：只做清理和文档同步，不改行为。开工前先看清单里本阶段其他条目的状态，把已完成条目的实际行为同步进 SPEC 和 UI 规格。
```

## 阶段 3：稳定性

### 7. W1 面板崩溃自动拉起

```text
在 /Users/zane/Vibe coding/dsh-plugin-discovery/dsh-harness-jarvis 实现待办条目 W1（面板崩溃自动拉起），用中文回复我。
先读 docs/superpowers/plans/2026-09-24-jarvis-backlog.md 的「0. 使用方法」「2. 通用约定」和条目 W1 全文，然后严格按使用方法执行：确认前置（无）已在 main 上 → 按通用约定 2.3 从最新 main 建独立 worktree 和分支 codex/w1-panel-supervisor（不要在主目录切分支） → 把 W1 状态改为进行中 → 实现并按“等价类 / 边界值 / 异常路径”写测试 → 插件测试、面板测试、构建全部通过后提交 → 更新状态与实现记录 → 快进合回 main，并在主目录重新构建 → 汇报。
本条注意：退出码 0 不拉起，避免和手动启动的面板互相拉起死循环；卸载后到达的退出事件要忽略。
```

### 8. O1 日志轮转与播报缓存清理

```text
在 /Users/zane/Vibe coding/dsh-plugin-discovery/dsh-harness-jarvis 实现待办条目 O1（日志轮转与播报缓存清理），用中文回复我。
先读 docs/superpowers/plans/2026-09-24-jarvis-backlog.md 的「0. 使用方法」「2. 通用约定」和条目 O1 全文，然后严格按使用方法执行：确认前置（无）已在 main 上 → 按通用约定 2.3 从最新 main 建独立 worktree 和分支 codex/o1-log-rotation（不要在主目录切分支） → 把 O1 状态改为进行中 → 实现并按“等价类 / 边界值 / 异常路径”写测试 → 插件测试、面板测试、构建全部通过后提交 → 更新状态与实现记录 → 快进合回 main，并在主目录重新构建 → 汇报。
本条注意：J0 已合入就跳过删诊断日志那一步；面板侧改动后要 ./build.sh 并按通用约定重启面板。
```

### 9. T1 真实 DSH 冒烟检查脚本

```text
在 /Users/zane/Vibe coding/dsh-plugin-discovery/dsh-harness-jarvis 实现待办条目 T1（真实 DSH 冒烟检查脚本），用中文回复我。
先读 docs/superpowers/plans/2026-09-24-jarvis-backlog.md 的「0. 使用方法」「2. 通用约定」和条目 T1 全文，然后严格按使用方法执行：确认前置（无）已在 main 上 → 按通用约定 2.3 从最新 main 建独立 worktree 和分支 codex/t1-smoke（不要在主目录切分支） → 把 T1 状态改为进行中 → 实现并按“等价类 / 边界值 / 异常路径”写测试 → 插件测试、面板测试、构建全部通过后提交 → 更新状态与实现记录 → 快进合回 main，并在主目录重新构建 → 汇报。
本条注意：脚本输出里绝不能打印 token；--write 模式无论成败都要恢复原状。完成后如果 DSH 在运行，实际跑一次 npm run smoke 并把结果贴给我。
```

> 阶段 3 完成后：由你按清单 Q1 做第一轮真机验收，发现的问题告诉维护会话拆成新条目。

## 阶段 4：记忆

### 10. M1 记忆存储底座

```text
在 /Users/zane/Vibe coding/dsh-plugin-discovery/dsh-harness-jarvis 实现待办条目 M1（记忆存储底座），用中文回复我。
先读 docs/superpowers/plans/2026-09-24-jarvis-backlog.md 的「0. 使用方法」「2. 通用约定」和条目 M1 全文，然后严格按使用方法执行：确认前置（无）已在 main 上 → 按通用约定 2.3 从最新 main 建独立 worktree 和分支 codex/m1-memory-store（不要在主目录切分支） → 把 M1 状态改为进行中 → 实现并按“等价类 / 边界值 / 异常路径”写测试 → 插件测试、面板测试、构建全部通过后提交 → 更新状态与实现记录 → 快进合回 main，并在主目录重新构建 → 汇报。
本条注意：接口要稳定，M2、M3、J3、P0 都会用；如果 J3 已合入，把它的写入改走 approvals store 的写锁。
```

### 11. M2 remember / recall 工具

```text
在 /Users/zane/Vibe coding/dsh-plugin-discovery/dsh-harness-jarvis 实现待办条目 M2（remember / recall 工具），用中文回复我。
先读 docs/superpowers/plans/2026-09-24-jarvis-backlog.md 的「0. 使用方法」「2. 通用约定」和条目 M2 全文，然后严格按使用方法执行：确认前置（M1）已在 main 上 → 按通用约定 2.3 从最新 main 建独立 worktree 和分支 codex/m2-remember-recall（不要在主目录切分支） → 把 M2 状态改为进行中 → 实现并按“等价类 / 边界值 / 异常路径”写测试 → 插件测试、面板测试、构建全部通过后提交 → 更新状态与实现记录 → 快进合回 main，并在主目录重新构建 → 汇报。
本条注意：工具注册沿用 registerJarvisTools 里的 textOutput 写法，并更新 COMMANDER_PERSONA。可以和 M3 并行。
```

### 12. M3 自动抓取 temp

```text
在 /Users/zane/Vibe coding/dsh-plugin-discovery/dsh-harness-jarvis 实现待办条目 M3（自动抓取 temp），用中文回复我。
先读 docs/superpowers/plans/2026-09-24-jarvis-backlog.md 的「0. 使用方法」「2. 通用约定」和条目 M3 全文，然后严格按使用方法执行：确认前置（M1）已在 main 上 → 按通用约定 2.3 从最新 main 建独立 worktree 和分支 codex/m3-temp-capture（不要在主目录切分支） → 把 M3 状态改为进行中 → 实现并按“等价类 / 边界值 / 异常路径”写测试 → 插件测试、面板测试、构建全部通过后提交 → 更新状态与实现记录 → 快进合回 main，并在主目录重新构建 → 汇报。
本条注意：只记条目列出的字段，不要把工具输出和推理内容写进 temp。
```

### 13. M6 长期记忆注入贾维斯人设

```text
在 /Users/zane/Vibe coding/dsh-plugin-discovery/dsh-harness-jarvis 实现待办条目 M6（长期记忆注入贾维斯人设），用中文回复我。
先读 docs/superpowers/plans/2026-09-24-jarvis-backlog.md 的「0. 使用方法」「2. 通用约定」和条目 M6 全文，然后严格按使用方法执行：确认前置（M2）已在 main 上 → 按通用约定 2.3 从最新 main 建独立 worktree 和分支 codex/m6-memory-section（不要在主目录切分支） → 把 M6 状态改为进行中 → 实现并按“等价类 / 边界值 / 异常路径”写测试 → 插件测试、面板测试、构建全部通过后提交 → 更新状态与实现记录 → 快进合回 main，并在主目录重新构建 → 汇报。
本条注意：section 文本按 store 的 version 缓存，version 不变时返回同一个字符串，保证缓存前缀稳定。
```

## 阶段 5：面板体验

### 14. U1 面板显示播报字幕

```text
在 /Users/zane/Vibe coding/dsh-plugin-discovery/dsh-harness-jarvis 实现待办条目 U1（面板显示播报字幕），用中文回复我。
先读 docs/superpowers/plans/2026-09-24-jarvis-backlog.md 的「0. 使用方法」「2. 通用约定」和条目 U1 全文，然后严格按使用方法执行：确认前置（无）已在 main 上 → 按通用约定 2.3 从最新 main 建独立 worktree 和分支 codex/u1-captions（不要在主目录切分支） → 把 U1 状态改为进行中 → 实现并按“等价类 / 边界值 / 异常路径”写测试 → 插件测试、面板测试、构建全部通过后提交 → 更新状态与实现记录 → 快进合回 main，并在主目录重新构建 → 汇报。
本条注意：跨两个仓库（voice-mini 的 SpeechSignal 加 text），voice-mini 单独提交；voice-mini 没更新时面板只是不显示字幕，不能报错。加快照场景 16、17 并用 Read 看截图。
```

### 15. H1 全局快捷键呼出输入框

```text
在 /Users/zane/Vibe coding/dsh-plugin-discovery/dsh-harness-jarvis 实现待办条目 H1（全局快捷键呼出输入框），用中文回复我。
先读 docs/superpowers/plans/2026-09-24-jarvis-backlog.md 的「0. 使用方法」「2. 通用约定」和条目 H1 全文，然后严格按使用方法执行：确认前置（无）已在 main 上 → 按通用约定 2.3 从最新 main 建独立 worktree 和分支 codex/h1-hotkey（不要在主目录切分支） → 把 H1 状态改为进行中 → 实现并按“等价类 / 边界值 / 异常路径”写测试 → 插件测试、面板测试、构建全部通过后提交 → 更新状态与实现记录 → 快进合回 main，并在主目录重新构建 → 汇报。
本条注意：用 Carbon RegisterEventHotKey，不要用需要辅助功能权限的全局按键监听；VisibilityPolicy 要支持输入框打开时强制可见。可以和 U1 并行。
```

## 阶段 6：设置与提问

### 16. J6 DSH 设置页

```text
在 /Users/zane/Vibe coding/dsh-plugin-discovery/dsh-harness-jarvis 实现待办条目 J6（DSH 设置页），用中文回复我。
先读 docs/superpowers/plans/2026-09-24-jarvis-backlog.md 的「0. 使用方法」「2. 通用约定」和条目 J6 全文，然后严格按使用方法执行：确认前置（J2）已在 main 上 → 按通用约定 2.3 从最新 main 建独立 worktree 和分支 codex/j6-settings（不要在主目录切分支） → 把 J6 状态改为进行中 → 实现并按“等价类 / 边界值 / 异常路径”写测试 → 插件测试、面板测试、构建全部通过后提交 → 更新状态与实现记录 → 快进合回 main，并在主目录重新构建 → 汇报。
本条注意：字段名以 src/index.ts 的 Config 为准（J2 加了 judgeEnabled、judgeProvider、judgeModel、judgeTimeoutMs、maxContinueRounds）；没有设置服务时插件必须照旧运行。
```

### 17. J7 拦截托管会话的提问

```text
在 /Users/zane/Vibe coding/dsh-plugin-discovery/dsh-harness-jarvis 实现待办条目 J7（拦截托管会话的提问），用中文回复我。
先读 docs/superpowers/plans/2026-09-24-jarvis-backlog.md 的「0. 使用方法」「2. 通用约定」和条目 J7 全文，然后严格按使用方法执行：确认前置（M2、J6）已在 main 上 → 按通用约定 2.3 从最新 main 建独立 worktree 和分支 codex/j7-ask-intercept（不要在主目录切分支） → 把 J7 状态改为进行中 → 实现并按“等价类 / 边界值 / 异常路径”写测试 → 插件测试、面板测试、构建全部通过后提交 → 更新状态与实现记录 → 快进合回 main，并在主目录重新构建 → 汇报。
本条注意：默认关闭；模型超时、输出非法、置信不足、选项不匹配，一律回落到转发给用户。
```

## 阶段 7：语音输入

### 18. S0 语音输入技术验证

```text
在 /Users/zane/Vibe coding/dsh-plugin-discovery/dsh-harness-jarvis 实现待办条目 S0（语音输入技术验证），用中文回复我。
先读 docs/superpowers/plans/2026-09-24-jarvis-backlog.md 的「0. 使用方法」「2. 通用约定」和条目 S0 全文，然后严格按使用方法执行：确认前置（无）已在 main 上 → 按通用约定 2.3 从最新 main 建独立 worktree 和分支 codex/s0-stt-probe（不要在主目录切分支） → 把 S0 状态改为进行中 → 实现并按“等价类 / 边界值 / 异常路径”写测试 → 插件测试、面板测试、构建全部通过后提交 → 更新状态与实现记录 → 快进合回 main，并在主目录重新构建 → 汇报。
本条注意：这是技术验证，产出是写在实现记录里的结论和 S1 路线，不是功能。需要我在系统弹窗里点允许时停下来告诉我；探针代码验证完删除。
```

### 19. S1 按住说话

```text
在 /Users/zane/Vibe coding/dsh-plugin-discovery/dsh-harness-jarvis 实现待办条目 S1（按住说话），用中文回复我。
先读 docs/superpowers/plans/2026-09-24-jarvis-backlog.md 的「0. 使用方法」「2. 通用约定」和条目 S1 全文，然后严格按使用方法执行：确认前置（S0、H1）已在 main 上 → 按通用约定 2.3 从最新 main 建独立 worktree 和分支 codex/s1-dictation（不要在主目录切分支） → 把 S1 状态改为进行中 → 实现并按“等价类 / 边界值 / 异常路径”写测试 → 插件测试、面板测试、构建全部通过后提交 → 更新状态与实现记录 → 快进合回 main，并在主目录重新构建 → 汇报。
本条注意：先读 S0 的实现记录确定走哪条路线；按决策 D5 只用本机识别，不可用就提示，不回退云端。
```

## 阶段 8：分级自动审批

### 20. P0 审批“总是允许”预设

```text
在 /Users/zane/Vibe coding/dsh-plugin-discovery/dsh-harness-jarvis 实现待办条目 P0（审批“总是允许”预设），用中文回复我。
先读 docs/superpowers/plans/2026-09-24-jarvis-backlog.md 的「0. 使用方法」「2. 通用约定」和条目 P0 全文，然后严格按使用方法执行：确认前置（J3）已在 main 上 → 按通用约定 2.3 从最新 main 建独立 worktree 和分支 codex/p0-approval-presets（不要在主目录切分支） → 把 P0 状态改为进行中 → 实现并按“等价类 / 边界值 / 异常路径”写测试 → 插件测试、面板测试、构建全部通过后提交 → 更新状态与实现记录 → 快进合回 main，并在主目录重新构建 → 汇报。
本条注意：插件和面板两边都改；高危操作不显示“总是允许”按钮，也不允许创建高危预设。
```

### 21. P1 分级自动审批

```text
在 /Users/zane/Vibe coding/dsh-plugin-discovery/dsh-harness-jarvis 实现待办条目 P1（分级自动审批），用中文回复我。
先读 docs/superpowers/plans/2026-09-24-jarvis-backlog.md 的「0. 使用方法」「2. 通用约定」和条目 P1 全文，然后严格按使用方法执行：确认前置（J3、P0、J6）已在 main 上 → 按通用约定 2.3 从最新 main 建独立 worktree 和分支 codex/p1-tiered-approval（不要在主目录切分支） → 把 P1 状态改为进行中 → 实现并按“等价类 / 边界值 / 异常路径”写测试 → 插件测试、面板测试、构建全部通过后提交 → 更新状态与实现记录 → 快进合回 main，并在主目录重新构建 → 汇报。
本条注意：默认关闭；按决策 D6，高危且无预设一律转给用户，贾维斯不自动拒绝；classify 的表驱动测试要覆盖条目列出的易混淆例子。
```

## 阶段 9：发布

### 22. SEC1 安全审查与加固

```text
在 /Users/zane/Vibe coding/dsh-plugin-discovery/dsh-harness-jarvis 实现待办条目 SEC1（安全审查与加固），用中文回复我。
先读 docs/superpowers/plans/2026-09-24-jarvis-backlog.md 的「0. 使用方法」「2. 通用约定」和条目 SEC1 全文，然后严格按使用方法执行：确认前置（计划发布的功能条目都已完成）已在 main 上 → 按通用约定 2.3 从最新 main 建独立 worktree 和分支 codex/sec1-hardening（不要在主目录切分支） → 把 SEC1 状态改为进行中 → 实现并按“等价类 / 边界值 / 异常路径”写测试 → 插件测试、面板测试、构建全部通过后提交 → 更新状态与实现记录 → 快进合回 main，并在主目录重新构建 → 汇报。
本条注意：先修条目列出的已知问题，再逐路由审查；删除任何路由前先确认面板 JarvisClient.swift 没用到。
```

### 23. R1 README、LICENSE、包信息

```text
在 /Users/zane/Vibe coding/dsh-plugin-discovery/dsh-harness-jarvis 实现待办条目 R1（README、LICENSE、包信息），用中文回复我。
先读 docs/superpowers/plans/2026-09-24-jarvis-backlog.md 的「0. 使用方法」「2. 通用约定」和条目 R1 全文，然后严格按使用方法执行：确认前置（无）已在 main 上 → 按通用约定 2.3 从最新 main 建独立 worktree 和分支 codex/r1-readme（不要在主目录切分支） → 把 R1 状态改为进行中 → 实现并按“等价类 / 边界值 / 异常路径”写测试 → 插件测试、面板测试、构建全部通过后提交 → 更新状态与实现记录 → 快进合回 main，并在主目录重新构建 → 汇报。
本条注意：功能列表只写清单里状态为已完成的；截图用 Snapshotter 生成。
```

### 24. R2 面板随插件分发

```text
在 /Users/zane/Vibe coding/dsh-plugin-discovery/dsh-harness-jarvis 实现待办条目 R2（面板随插件分发），用中文回复我。
先读 docs/superpowers/plans/2026-09-24-jarvis-backlog.md 的「0. 使用方法」「2. 通用约定」和条目 R2 全文，然后严格按使用方法执行：确认前置（R1）已在 main 上 → 按通用约定 2.3 从最新 main 建独立 worktree 和分支 codex/r2-panel-dist（不要在主目录切分支） → 把 R2 状态改为进行中 → 实现并按“等价类 / 边界值 / 异常路径”写测试 → 插件测试、面板测试、构建全部通过后提交 → 更新状态与实现记录 → 快进合回 main，并在主目录重新构建 → 汇报。
本条注意：开工前先问我决策 D7 是否按推荐（随包发预编译通用二进制）；在干净目录里用 npm pack 解包验证。
```

### 25. R3 提交 awesome-dsh-plugin 收录

```text
在 /Users/zane/Vibe coding/dsh-plugin-discovery/dsh-harness-jarvis 实现待办条目 R3（提交 awesome-dsh-plugin 收录），用中文回复我。
先读 docs/superpowers/plans/2026-09-24-jarvis-backlog.md 的「0. 使用方法」「2. 通用约定」和条目 R3 全文，然后严格按使用方法执行：确认前置（R1、R2、SEC1）已在 main 上 → 按通用约定 2.3 从最新 main 建独立 worktree 和分支 codex/r3-awesome（不要在主目录切分支） → 把 R3 状态改为进行中 → 实现并按“等价类 / 边界值 / 异常路径”写测试 → 插件测试、面板测试、构建全部通过后提交 → 更新状态与实现记录 → 快进合回 main，并在主目录重新构建 → 汇报。
本条注意：只准备条目文件和提交步骤，不要替我开 PR。
```

## 追加

### 26. J5a 关闭完成判断时的重复播报

```text
在 /Users/zane/Vibe coding/dsh-plugin-discovery/dsh-harness-jarvis 实现待办条目 J5a（关闭完成判断时的重复播报），用中文回复我。
先读 docs/superpowers/plans/2026-09-24-jarvis-backlog.md 的「0. 使用方法」「2. 通用约定」和条目 J5a 全文，然后严格按使用方法执行：确认前置（J5）已在 main 上 → 按通用约定 2.3 从最新 main 建独立 worktree 和分支 codex/j5a-judge-off-silence（不要在主目录切分支） → 把 J5a 状态改为进行中 → 实现并按“等价类 / 边界值 / 异常路径”写测试 → 插件测试、面板测试、构建全部通过后提交 → 更新状态与实现记录 → 快进合回 main，并在主目录重新构建 → 汇报。
本条注意：只改贾维斯仓库，不动 voice-mini；claimsTurnEnd 保持现状；判断关闭的分支放进 src/judge.ts 的 planTurnEnd，不要在 index.ts 里加分支；README 配置说明补一句"未装 voice-mini 且关闭判断时轮末不播报"。可以和 S1 并行。
```
