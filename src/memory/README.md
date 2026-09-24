# MemoryStore 接口约定

M1 提供存储与锁；M2/M3/P0 在此基础上增加业务。模块不依赖 DSH。

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
- `appendTemp` 接收含 `at`（非负 epoch 毫秒，UTC 年份不超过 9999，以符合四位日期文件名）、`type`（非空）的 JSON 数据对象，可附加业务字段；存储层写入参数中的 `session`。按记录时间的 UTC 日期分 JSONL 文件。`readTemp(session, {since})` 包含 `at === since`，按日期文件及文件内顺序返回，跳过损坏行。残缺尾行与下一次追加隔开，防止吞掉新记录。容量限制、去重和抓取是 M3 的工作；需要原子检查容量时应扩展 appendTemp 的锁内实现，不能在调用方先读后写。
- `writeLong` 以 `entry.id` 定位文件；同 id 原子替换，返回 basename。`listLong` 返回排序后的 HTML basenames；`readLong` 返回原始 HTML，缺失返回 undefined；`removeLong` 返回是否删除。读删只接受 basename，禁止路径。操作 I/O 失败会 reject；目录/文件符号链接不能经普通存储方法读写到外部。
- `LongEntry` 必需 id/tag/created/source/key；intent/session/expires/detail/ref 可选，未提供和空串可区分。created 与非空 expires 为 ISO 时间；source 是 remember/classifier/consolidate。detail 渲染时按 Unicode 码点截到 500。renderMemory/parseMemory 对所有动态属性与正文对称转义；损坏格式、未知 source 和审批 HTML 解析为 undefined。调用方可逐文件跳过损坏条目。
- J3 保持独立 `<approval>` HTML 格式及不覆盖文件的 hard-link 发布方式，在 DSH 已获得审批结果后的 setImmediate 中调用 `writeApproval(memory, ...)`，由它取得 approvals 写锁。旧 J3 条目里的 general 锁提醒由 M1 的独立 approvals 锁约定取代。
- `withReadLock(scope, callback)` / `withWriteLock(scope, callback)` 为复合操作和其他文件格式提供锁，callback 收到该 scope 的长期目录，负责自己的原始 I/O、目录创建与路径校验。锁不可重入：callback 内不能再调用同 scope 的任何 MemoryStore 方法。异步 callback 结束或拒绝后释放锁；排队写优先于后来的读。P0 如需偏好 JSON，可用 approvals 写锁保护自己的原子发布。
- `lock.json` 仅诊断，不是跨进程锁或租约。内容为 `{writes: [{store, startedAt}]}`，记录所有当前写；最后一写结束后删除。同进程每个配置路径首次构造时恢复一次：超过 60 秒的残留删除，恰好 60 秒保留；损坏诊断清除。诊断 I/O 与 onError 抛错不影响业务读写，真实数据 I/O 错误仍交调用方处理。
