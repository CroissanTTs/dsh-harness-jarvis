# MemoryStore 接口约定

M1 提供存储与锁，M2 提供显式记忆工具，M3 自动抓取 temp；P0 可复用这些接口。模块不依赖 DSH。

```ts
import { MemoryStore, parseMemory } from './memory/store.ts';
const memory = new MemoryStore({ rootDir: '/path/to/jarvis' });
await memory.ready();
await memory.appendTemp('worker', { at: Date.now(), type: 'user/message', text: '原话' });
const file = await memory.writeLong('general', {
  id: 'preference-1', tag: 'preference', created: new Date().toISOString(),
  source: 'remember', key: '用中文回复',
});
const entry = parseMemory((await memory.readLong('general', file))!);
```

- `rootDir` 默认 `~/.dsh/jarvis`（由 homedir 构造）；`lockFile` 默认 root 下的 `lock.json`；`approvalsDir` 默认 root 下的 `memory/approvals`。直接构造时传真实路径，不展开 `~`。插件新增 `memoryRoot`，沿用独立的 `lockFile`、`approvalsDir` 配置并在接线层展开 `~`；自定义 memoryRoot 时如需一起迁移后两者，须同时配置。
- scope 为 `general`、`approvals` 或原始会话 id；前两者是保留名称，不能作为 temp 的会话 id。每会话 temp 和长期数据共享一把锁，general 与 approvals 各有独立锁。锁仅限同一进程；同目录的实例与已存在的配置路径别名共享锁。根目录配置应在实例生命周期内保持稳定。
- 路径只使用 ASCII 安全字符，空白 id 拒绝。危险字符替换为 `_`；有损转换、超长名称、大写名称及含 `--` 的名称追加 SHA-256，避免转换、大小写文件系统或编码名称造成覆盖。安全前缀最多 160 字符；API 始终接收原始 id，不要自行编码或依赖目录拼接。
- `appendTemp` 接收含 `at`（非负 epoch 毫秒，UTC 年份不超过 9999，以符合四位日期文件名）、`type`（非空）的 JSON 数据对象，可附加业务字段；存储层写入参数中的 `session`。按记录时间的 UTC 日期分 JSONL 文件。`readTemp(session, {since})` 包含 `at === since`，按日期文件及文件内顺序返回，跳过损坏行。残缺尾行与下一次追加隔开，防止吞掉新记录。M3 已在 appendTemp 同一会话写锁内检查每日 2 MiB 上限：预计追加后超过上限时改写一条 truncated，此后当天停止；标记允许额外占用少量空间，最后一行标记用于跨实例及重启去重。不能在调用方先读大小再写。
- `writeLong` 以 `entry.id` 定位文件；同 id 原子替换，返回 basename。`listLong` 返回排序后的 HTML basenames；`readLong` 返回原始 HTML，缺失返回 undefined；`removeLong` 返回是否删除。读删只接受 basename，禁止路径。操作 I/O 失败会 reject；目录/文件符号链接不能经普通存储方法读写到外部。
- `LongEntry` 必需 id/tag/created/source/key；intent/session/expires/detail/ref 可选，未提供和空串可区分。created 与非空 expires 为 ISO 时间；source 是 remember/classifier/consolidate。detail 渲染时按 Unicode 码点截到 500。renderMemory/parseMemory 对所有动态属性与正文对称转义；损坏格式、未知 source 和审批 HTML 解析为 undefined。调用方可逐文件跳过损坏条目。
- J3 保持独立 `<approval>` HTML 格式及不覆盖文件的 hard-link 发布方式，在 DSH 已获得审批结果后的 setImmediate 中调用 `writeApproval(memory, ...)`，由它取得 approvals 写锁。旧 J3 条目里的 general 锁提醒由 M1 的独立 approvals 锁约定取代。
- `withReadLock(scope, callback)` / `withWriteLock(scope, callback)` 为复合操作和其他文件格式提供锁，callback 收到该 scope 的长期目录，负责自己的原始 I/O、目录创建与路径校验。锁不可重入：callback 内不能再调用同 scope 的任何 MemoryStore 方法。异步 callback 结束或拒绝后释放锁；排队写优先于后来的读。P0 如需偏好 JSON，可用 approvals 写锁保护自己的原子发布。
- `lock.json` 仅诊断，不是跨进程锁或租约。内容为 `{writes: [{store, startedAt}]}`，记录所有当前写；最后一写结束后删除。同进程每个配置路径首次构造时恢复一次：超过 60 秒的残留删除，恰好 60 秒保留；损坏诊断清除。诊断 I/O 与 onError 抛错不影响业务读写，真实数据 I/O 错误仍交调用方处理。

## M2 显式记忆工具

`remember(store, {content, tag?, session?, expiresDays?})` 和 `recall(store, {query, session?, limit?})` 位于 `tools.ts`，返回工具需要的纯文本，由 `registerJarvisTools` 包装为 `textOutput`。可传第三个参数 now（epoch 毫秒）测试到期边界。

remember 使用随机 UUID，空白 content 拒绝；中文句末标点、英文 !/?、后接空白或结尾的英文句点及换行处分割第一句，剩余为 detail（存储层最多500码点）。tag 默认 note，空 session/general 写通用库，非空会话 id 保持原样，approvals 不能作为会话传入。expiresDays 为非负有限天数，可含小数；0 表示立即到期，省略则长期保留。写失败抛错，不返回“记住了”。

recall 的 query 不得空白；英文不分大小写，按空白/标点切词，汉字逐字切分并去重。每个词在 key/tag/detail 命中分别计3/2/1分，不按出现次数累加；无命中不返回，同分按创建时间倒序，最后按来源与文件名稳定排序。limit 默认5，向下取整并限制0–10，非有限值拒绝；无结果返回“没有找到相关记忆”。过期边界为 expires <= now；单个损坏/读失败文件跳过，整个目录读取失败抛错，避免伪装空库。

只有 query 含“审批/批准/拒绝”才添加 approvals 范围。`approval.ts` 只读解析 J3 格式，投影为审批标签、批准/拒绝 + 工具/命令关键点（最多160码点）、源会话和日期，参数/上下文/理由仅用于打分。普通长期条目以实际 store 标明来源，忽略可能过时的 entry.session；结果始终不返回 detail 全文，日期用UTC。审批记录读取不改变审批行为。

## M3 自动 temp 抓取

`capture.ts` 的 `toTempRecord(event, toolName?)` 是白名单映射：event.time 转 at，user/message 仅合并顶层 text（以换行分隔），前500个Unicode码点；assistant/message 仅取最后一个 text 块前800码点，不记录 interrupted 前缀、推理、工具调用、stream 或附件；tool/result 仅存 tool 与 isError；turn/end 仅存 reason.kind。空文本、未知事件、无效时间/结构返回 null。session 由 appendTemp 统一添加，不保存 seq、turn、调用 id、原始事件或其他元数据。

当前 DSH tool/result 的 message.source.callId 和 tool-result.toolCallId 关联同轮先前 tool/call；结果本身没有工具名。`captureTemp` 通过 session.eventAt 反向查回 name 并传入纯映射；尚未启动的工具可没有 tool/call，此时从同轮 assistant/message 的匹配 tool-call 块取 id/name。读取过程不访问工具参数或结果正文；找不到匹配不编造名称，不生成该条记录。该适配依据已安装 dsh-session / dsh-llm 的公开类型。

插件 session/event 只为当前托管会话和配置的 jarvisSessionId 调用 captureTemp，不等待写盘。映射与写入失败由 debug 记录，异常及日志异常均不返回宿主；移出托管只影响此后事件，已经接受的异步写入照常完成。不会往 DSH 会话日志追加自定义事件。

2 MiB 等于 2,097,152 字节（UTF-8 JSONL，包括换行），检查与实际写入共用 store 的会话锁。恰好可填满时写普通事件，下一条将超限时只写 `{session,at,type:"truncated"}`，不携带被丢弃事件的正文；当日标记后不再追加。预先已有超大文件不删旧内容，补一次标记即可；若尾行残缺会先补换行。UTC 次日或其他会话独立恢复。真实磁盘错误仍由 appendTemp reject，captureTemp 吞掉并记录。
