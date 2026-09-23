/**
 * dsh-harness-jarvis — SCAFFOLD (v0.1.0-scaffold).
 *
 * Jarvis commander plugin for DeepSeek Harness. Per SPEC v0.9
 * (dsh-harness-jarvis/SPEC.md). This file is a SKELETON: it wires the two
 * 挂点 (§3.1) and registers the tool surfaces (§7) + global listeners, but
 * execute bodies / TTS / answerer / memory / 悬浮窗 routes are STUBS
 * (throw TODO) to be filled in during implementation.
 *
 * Architecture (§3.2): a 瘦编排 agent (one Jarvis session, lean) managing N
 * independent clean worker sessions; routing = 悬浮窗 explicit session select
 * + text input (no STT in MVP, §6); completion judge / 续轮 happen on worker
 * turns via global listeners filtered to the managed set (§8/§13).
 *
 * Two 挂点 (§3.1):
 *   挂点1 (global, in apply)   — session/event + agent/turn-stopping listeners
 *                                (filtered to managed workers), approval answerer
 *                                stub, built-in TTS, lock + .jarvis state,
 *                                optional webServer routes.
 *   挂点2 (in createAgent setup, via agentCtx) — commander persona section +
 *                                贾维斯 tools (§7), all scoped to the Jarvis
 *                                agent so workers never see them.
 *
 * Jarvis agent creation: the plugin calls ctx.agentLoop.createAgent() itself
 * (with a setup callback that does 挂点2), NOT relying on cordis.yml config
 * declaration or GUI naming — sidesteps the "agent-loop config id" and
 * "can't name a session 'jarvis'" issues.
 *
 * @module dsh-harness-jarvis
 */
import type { Context } from '@deepseek-ai/cordis';
import z from '@deepseek-ai/schemastery';
import { defineTool } from '@deepseek-ai/dsh-tools';
import { MessageId } from '@deepseek-ai/dsh-llm';
import type { UserMessage } from '@deepseek-ai/dsh-llm';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { appendFileSync, mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { randomBytes, randomInt } from 'node:crypto';
import { LiveState } from './live-state.ts';

/** Package root (lib/ → parent). Resolves bundled scripts/synth-edge.mjs. */
const here = dirname(fileURLToPath(import.meta.url));
const pkgRoot = join(here, '..');

/** Captured host webServer origin once webServer injects fire — reused to call
 *  voice-mini's same-host /voice-mini/test endpoint for chime+TTS greetings. */
let webOrigin: string | null = null;

/** The Jarvis agent handle (from createAgent/resume). Stored so /jarvis/input
 *  can inject user messages into the agent (user → jarvis → response). */
let jarvisHandle: any = null;

/** Wall-clock ms until which Jarvis is "speaking" (a TTS greeting is in flight).
 *  The悬浮窗 polls /jarvis/state and pulses the orb while speaking is true. */
let speakingUntil = 0;

/** Set from the悬浮窗 voice button; suppresses greetings until unmuted. */
let voiceMuted = false;
let playingChild: ChildProcess | null = null;

/** Session titles for /jarvis/state, refreshed at most every 10s. */
const titleCache: { at: number; map: Record<string, string> } = { at: 0, map: {} };

/** Stops the built-in afplay playback. voice-mini playback is out of our reach. */
function stopSpeech(): void {
  speakingUntil = 0;
  if (playingChild && !playingChild.killed) { try { playingChild.kill('SIGTERM'); } catch {} }
  playingChild = null;
}

/** Worker session ids from the agents registry, excluding Jarvis itself (the
 *  registry keys it by its DSH UUID, so also match the live handle's id). */
function listWorkerIds(ctx: Context, entry: JarvisConfig): string[] {
  const agents = (ctx as any).get?.('agents');
  let ids: string[] = [];
  if (agents) {
    const pick = (a: any) => typeof a === 'string' ? a : (a?.id ?? a?.sessionId ?? '');
    if (typeof agents.keys === 'function') ids = [...agents.keys()];
    else if (typeof agents.list === 'function') ids = agents.list().map(pick);
    else if (typeof agents[Symbol.iterator] === 'function') ids = [...agents].map(pick);
  }
  const selfAgentId = String(jarvisHandle?.agent?.id ?? '');
  return ids.map(String).filter((id) => id && id !== entry.jarvisSessionId && (selfAgentId === '' || id !== selfAgentId));
}

/** Batch-reads titles via sessionQuery.readTitleSnapshots.
 *  Actual shape: [{ sessionId, status, value: { session, title: { title } } }] */
async function readTitleMap(ctx: Context, ids: string[]): Promise<{ map: Record<string, string>; diag: string }> {
  const map: Record<string, string> = {};
  try {
    const sessionQuery = (ctx as any).get?.('sessionQuery');
    if (!sessionQuery?.readTitleSnapshots || ids.length === 0) {
      return { map, diag: 'sq=' + (sessionQuery ? 'found' : 'missing') + ' rts=' + (sessionQuery?.readTitleSnapshots ? 'fn' : 'no') + ' ids=' + ids.length };
    }
    const snaps = await sessionQuery.readTitleSnapshots(ids);
    if (Array.isArray(snaps)) {
      snaps.forEach((s: any, i: number) => {
        const sid = String(s?.sessionId ?? s?.id ?? ids[i] ?? '');
        const t = String(s?.value?.title?.title ?? s?.value?.title ?? s?.title?.title ?? s?.title ?? '');
        if (sid && t) map[sid] = t;
      });
      return { map, diag: 'array[' + snaps.length + '] titles=' + Object.values(map).join(' | ').slice(0, 200) };
    }
    if (snaps && typeof snaps === 'object') {
      for (const [k, v] of Object.entries(snaps as any)) {
        map[String(k)] = String((v as any)?.value?.title?.title ?? (v as any)?.title?.title ?? (v as any)?.title ?? '');
      }
      return { map, diag: 'object[' + Object.keys(snaps).length + ']' };
    }
    return { map, diag: '(empty)' };
  } catch (e) {
    return { map, diag: 'err: ' + (e instanceof Error ? e.message : String(e)) };
  }
}

/** /jarvis/input wraps session-targeted text in this instruction; history shows the original. */
const ROUTED_INPUT = /^用户要求把以下内容发给会话 (\S+)。请优化说法后用 inject_to_session 发送：\n\n([\s\S]*)$/;

export const name = 'dsh-harness-jarvis';

/** Hard-required services. llm / systemPrompt / webServer / settings deferred. */
export const inject = ['tools', 'userQuestions', 'jobs'] as const;

export const Config = z.object({
  locale: z.union(['zh', 'en']).default('zh'),
  audioDir: z.string().default('~/.dsh/jarvis'),
  managedFile: z.string().default('~/.dsh/jarvis/managed.json'),
  lockFile: z.string().default('~/.dsh/jarvis/lock.json'),
  runtimeFile: z.string().default('~/.dsh/jarvis/runtime.json'),
  titlePrefix: z.string().default('贾维斯-'),
  ttsBackend: z.union(['edge']).default('edge'),
  edgeVoice: z.string().default('zh-CN-YunjianNeural'),
  archiveIdleDays: z.number().default(7),
  // Jarvis agent creation (§9.1)
  provider: z.string().default('bailian'),
  model: z.string().default('qwen3.8-max-0902'),
  jarvisSessionId: z.string().default('jarvis'),
  jarvisCwd: z.string().default('~/jarvis'),
  // Restart welcome greetings (random pick). Built-in zh [欢迎回来,欢迎回归] /
  // en [Welcome back!,Welcome!] are always included; entries here are ADDED.
  greetings: z.array(z.string()).default([]),
});

interface JarvisConfig {
  locale: string;
  audioDir: string;
  managedFile: string;
  lockFile: string;
  runtimeFile: string;
  titlePrefix: string;
  ttsBackend: string;
  edgeVoice: string;
  archiveIdleDays: number;
  provider: string;
  model: string;
  jarvisSessionId: string;
  jarvisCwd: string;
  greetings: string[];
}

function resolveDir(p: string): string {
  return p.startsWith('~') ? join(homedir(), p.slice(1)) : p;
}

/** File-based debug logging (bypasses ctx.logger which is invisible from CLI). */
function debug(entry: JarvisConfig, msg: string): void {
  try {
    const f = join(resolveDir(entry.audioDir), 'debug.log');
    mkdirSync(dirname(f), { recursive: true, mode: 0o700 });
    appendFileSync(f, `${new Date().toISOString()} ${msg}\n`, { flag: 'a' });
  } catch { /* silent */ }
}

const COMMANDER_PERSONA = [
  '## 你是贾维斯(Jarvis)',
  '你是用户的管家/指挥官。你管着多个会话(worker):用户在悬浮窗选中一个会话、打字给你,你优化说法后用 inject_to_session 发给那个会话。',
  '- 你不堆 worker 的内容进自己记忆;worker 各自干净。你只干路由/口播/inject 决策/续轮判断。',
  '- 不能 inject_to_session 给自己(target ≠ 自己 且 ∈ 托管集)。',
  '- 审批你只 relay 用户决定,不自作主张批准。',
  '- 一两句话,别读代码/路径/markdown 出来。',
].join('\n');

function loadManagedSet(_file: string): Set<string> {
  return new Set<string>();
}

interface LockState { holder?: string; leaseUntil?: number; }
function loadLock(_file: string): LockState { return {}; }

/** Built-in TTS: edge-tts (free Microsoft neural voices) synthesized in a
 *  child process (the WebSocket flakes ~50% in the Electron main process but is
 *  100% reliable in plain Node), then played via macOS `afplay`. No LLM. */
function makeBuiltInTTS(voice: string) {
  const synthScript = join(pkgRoot, 'scripts', 'synth-edge.mjs');
  return {
    id: 'edge',
    async synthesize(text: string, outFile: string): Promise<{ path: string; ms: number }> {
      const t0 = Date.now();
      mkdirSync(dirname(outFile), { recursive: true });
      const { code, stderr } = await runChild(process.execPath, [synthScript, text, outFile, voice, '+0%']);
      if (code !== 0 || !existsSync(outFile)) {
        throw new Error('edge-tts synth failed (child exit=' + code + (stderr ? ', stderr=' + stderr.slice(0, 200) : '') + ')');
      }
      return { path: outFile, ms: Date.now() - t0 };
    },
    play(file: string): Promise<void> {
      return new Promise((res) => {
        const p = spawn('afplay', [file], { stdio: 'ignore' });
        playingChild = p;
        const done = () => { if (playingChild === p) playingChild = null; res(); };
        p.on('close', done);
        p.on('error', done);
      });
    },
  };
}

/** Spawn a child with ELECTRON_RUN_AS_NODE=1 (plain Node, not Electron) and
 *  report its exit code + stderr. Used for edge-tts synth. */
function runChild(cmd: string, args: string[]): Promise<{ code: number; stderr: string }> {
  return new Promise((res, rej) => {
    const env = { ...process.env, ELECTRON_RUN_AS_NODE: '1' };
    const p = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], env });
    let stderr = '';
    p.stderr?.on('data', (d: Buffer) => { stderr += d.toString(); });
    p.on('error', rej);
    p.on('close', (code) => res({ code: code ?? -1, stderr }));
  });
}

// ── HTTP helpers (copied from voice-mini pet.ts pattern) ─────────────
function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const json = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(json) });
  res.end(json);
}

/** Read the full POST body as a string (for JSON parsing). */
function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', (chunk: Buffer) => { data += chunk.toString(); });
    req.on('end', () => resolve(data));
    req.on('error', () => resolve(''));
  });
}
function isLoopbackReq(req: IncomingMessage): boolean {
  const ip = req.socket?.remoteAddress ?? '';
  return ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';
}
function isAuthorized(req: IncomingMessage, token: string): boolean {
  if (req.headers.authorization === `Bearer ${token}`) return true;
  try { return new URL(req.url ?? '/', 'http://127.0.0.1').searchParams.get('token') === token; } catch { return false; }
}
function loadOrCreateToken(entry: JarvisConfig): string {
  try {
    const f = resolveDir(entry.runtimeFile);
    const parsed = JSON.parse(readFileSync(f, 'utf8')) as { token?: string };
    if (typeof parsed.token === 'string' && parsed.token.length >= 16) return parsed.token;
  } catch {}
  return randomBytes(24).toString('hex');
}
function writeRuntimeFile(entry: JarvisConfig, data: Record<string, unknown>): void {
  try {
    const f = resolveDir(entry.runtimeFile);
    mkdirSync(dirname(f), { recursive: true, mode: 0o700 });
    writeFileSync(f, JSON.stringify(data, null, 2) + '\n', { encoding: 'utf8', mode: 0o600 });
  } catch {}
}

/** Spawn the native悬浮窗 (macos/jarvis-panel) as a NON-DETACHED child of the
 *  host — i.e. the orb's lifecycle is tied to DSH Desktop ("和 DSH 作为依赖"):
 *  DSH up → orb up (host spawns it on webServer ready); DSH quits → orb dies
 *  with it; DSH restarts → host re-spawns. NON-detached is intentional: a
 *  detached child loses DSH's GUI/WindowServer session and the orb didn't
 *  render after restart; as a regular child it inherits the session and renders
 *  reliably (same as a manual `./jarvis-panel` launch). stdio ignored + unref'd
 *  so the host never blocks on it. The panel self-guards duplicates via pidfile. */
/** The live panel child process (so we can kill it when the host disposes —
 *  DSH quit → orb quit, the "和 DSH 作为依赖" lifecycle). */
let panelChild: ReturnType<typeof spawn> | null = null;

function spawnPanel(entry: JarvisConfig): void {
  const bin = join(pkgRoot, 'macos', 'jarvis-panel');
  if (!existsSync(bin)) { debug(entry, 'panel binary not found (' + bin + ') — skipping spawn (build macos/ first)'); return; }
  try {
    // Kill a previous panel from an earlier apply (config reload etc.).
    if (panelChild && !panelChild.killed) { try { panelChild.kill('SIGTERM'); } catch {} }
    const child = spawn(bin, [], { stdio: 'ignore' });
    child.unref();
    panelChild = child;
    child.on('exit', () => { if (panelChild === child) panelChild = null; });
    debug(entry, 'spawned悬浮窗 panel (pid=' + child.pid + ', non-detached, bin=' + bin + ')');
  } catch (e) {
    debug(entry, 'panel spawn failed: ' + (e instanceof Error ? e.message : String(e)));
  }
}

/** Kill the悬浮窗 panel when this plugin context disposes (DSH quits). */
function killPanel(entry: JarvisConfig): void {
  if (panelChild && !panelChild.killed) {
    try { panelChild.kill('SIGTERM'); debug(entry, 'killed悬浮窗 panel (pid=' + panelChild.pid + ')'); } catch {}
  }
  panelChild = null;
}

export function apply(ctx: Context, rawConfig: unknown): (() => void) | void {
  const entry = { ...Config(rawConfig ?? {}), ...(rawConfig as object) } as JarvisConfig;
  debug(entry, 'apply() started');
  const managed = loadManagedSet(entry.managedFile);
  const lock = loadLock(entry.lockFile);
  const live = new LiveState(entry.jarvisSessionId);

  // ── provide 'jarvis' service so voice-mini (and other plugins) auto-detect
  //    us. voice-mini does ctx.inject(['jarvis']) → flips jarvisLinked (shows
  //    the Jarvis panel section). Minimal contract: who we are + our session
  //    id (voice-mini can use it to single out Jarvis's session for narration).
  ctx.provide('jarvis' as any, { sessionId: entry.jarvisSessionId, cwd: resolveDir(entry.jarvisCwd) });
  debug(entry, 'provided "jarvis" service (sessionId=' + entry.jarvisSessionId + ')');
  ctx.logger?.warn?.('dsh-harness-jarvis: provided "jarvis" service');
  let llm: unknown;

  // ── deferred services ─────────────────────────────────────────────────
  ctx.inject(['llm' as any], (llmCtx: Context) => {
    debug(entry, 'llm inject fired');
    llm = (llmCtx as any).get('llm');
    ctx.logger?.warn?.('dsh-harness-jarvis: llm attached');
  });
  ctx.inject(['webServer' as any], (serverCtx: Context) => {
    const webServer = (serverCtx as any).get('webServer') as
      | { host?: string; port?: number; register: (r: { kind: 'prefix'; path: string; handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void> }) => () => void }
      | undefined;
    if (!webServer) { debug(entry, 'webServer not found'); return; }
    const token = loadOrCreateToken(entry);
    const origin = `http://${webServer.host ?? '127.0.0.1'}:${String(webServer.port ?? '')}`;
    webOrigin = origin;
    const writeRt = (): void => {
      let header: { name: string; value: string } | undefined;
      try { header = (ctx as any).get?.('desktopBrowserAccess')?.rendererHeader; } catch {}
      writeRuntimeFile(entry, { origin, token, pid: process.pid, writtenAt: Date.now(), ...(header ? { rendererHeader: header } : {}) });
      debug(entry, 'runtime.json: ' + origin + ' token=' + token.slice(0, 8) + '…' + (header ? ' +renderer' : ' no-renderer'));
    };
    writeRt();
    ctx.inject(['desktopBrowserAccess' as any], () => writeRt());
    spawnPanel(entry);
    webServer.register({
      kind: 'prefix', path: '/jarvis',
      handler: async (req: IncomingMessage, res: ServerResponse) => {
        if (!isLoopbackReq(req) || !isAuthorized(req, token)) { sendJson(res, 403, { error: 'forbidden' }); return; }
        const url = (req.url ?? '').replace(/^\/jarvis/, '').split('?')[0] ?? '/';
        try {
          if (url === '/state' && req.method === 'GET') {
            const narration = await voiceMiniSpeech(webOrigin);
            const speaking = Date.now() < speakingUntil || playingChild !== null || narration.speaking;
            const ids = listWorkerIds(ctx, entry);
            if (Date.now() - titleCache.at > 10_000 || ids.some((id) => !(id in titleCache.map))) {
              titleCache.map = (await readTitleMap(ctx, ids)).map;
              titleCache.at = Date.now();
            }
            const sessions = ids.map((id) => ({
              id, title: titleCache.map[id] || '', status: live.status(id, agentRunning(ctx, id)), unread: live.isUnread(id),
            }));
            const pending = live.pending();
            sendJson(res, 200, {
              agentId: entry.jarvisSessionId,
              managed: [...managed],
              speaking,
              activity: live.activity(speaking, agentRunning(ctx, entry.jarvisSessionId)),
              error: live.error(),
              voice: { speaking, muted: voiceMuted, paused: narration.paused, queued: narration.queued },
              counts: {
                running: sessions.filter((s) => s.status === 'running').length,
                pending: pending.length,
                unread: sessions.filter((s) => s.unread).length,
                failed: sessions.filter((s) => s.status === 'failed').length,
              },
              sessions,
              pending,
            });
            return;
          }
          if (url === '/pending/answer' && req.method === 'POST') {
            const body = JSON.parse((await readBody(req)) || '{}');
            const result = live.answer(body);
            debug(entry, '/jarvis/pending/answer: ' + String(body.id) + ' → ' + result);
            if (result === 'ok') { res.statusCode = 204; res.end(); return; }
            sendJson(res, result === 'invalid' ? 400 : 404, { error: result });
            return;
          }
          if (url === '/voice' && req.method === 'POST') {
            const body = JSON.parse((await readBody(req)) || '{}');
            const action = String(body.action);
            if (action === 'mute') { voiceMuted = true; stopSpeech(); }
            else if (action === 'unmute') voiceMuted = false;
            else if (action in VOICE_MINI_CONTROL) {
              if (action !== 'resume') stopSpeech();
              const ok = await voiceMiniControl(webOrigin, action);
              debug(entry, '/jarvis/voice: ' + action + ' → voice-mini ' + (ok ? 'ok' : 'failed'));
            } else { sendJson(res, 400, { error: 'unknown action' }); return; }
            debug(entry, '/jarvis/voice: ' + action);
            res.statusCode = 204; res.end(); return;
          }
          if (url === '/read' && req.method === 'POST') {
            const body = JSON.parse((await readBody(req)) || '{}');
            live.markRead(typeof body.session === 'string' && body.session ? body.session : undefined);
            res.statusCode = 204; res.end(); return;
          }
          if (url === '/open' && req.method === 'POST') {
            // The host runs inside DSH, so its own .app bundle is the one to raise (covers Beta builds).
            const app = /^(.*?\.app)\//.exec(process.execPath)?.[1];
            const args = app ? [app] : ['-b', 'ai.deepseek.dsh.desktop'];
            try { spawn('open', args, { stdio: 'ignore' }).on('error', () => {}); } catch {}
            res.statusCode = 204; res.end(); return;
          }
          if (url === '/providers' && req.method === 'GET') {
            const a = (llm as any)?.adapters; sendJson(res, 200, { providers: a instanceof Map ? [...a.keys()] : [] }); return;
          }
          if (url === '/models' && req.method === 'GET') {
            const q = new URL(req.url ?? '/', 'http://127.0.0.1').searchParams;
            let p = q.get('provider') ?? '';
            if (!p) { const a = (llm as any)?.adapters; if (a instanceof Map && a.size > 0) p = [...a.keys()][0] ?? ''; }
            if (!p || !(llm as any)?.listModels) { sendJson(res, 200, { provider: null, models: [] }); return; }
            const ms = await (llm as any).listModels(p);
            sendJson(res, 200, { provider: p, models: ms.map((m: any) => ({ id: m.id, name: m.name ?? m.id })) }); return;
          }
          if (url === '/sessions' && req.method === 'GET') { sendJson(res, 200, { managed: [...managed], monitoring: [] }); return; }
          if (url === '/agents' && req.method === 'GET') {
            // List all available agents/sessions (so the user/Jarvis knows which
            // sessions can be targeted by inject_to_session).
            try {
              const agents = (ctx as any).get?.('agents');
              const ids = listWorkerIds(ctx, entry);
              const { map: titleMap, diag: snapsDiag } = await readTitleMap(ctx, ids);
              if (snapsDiag.startsWith('err')) debug(entry, '/agents: ' + snapsDiag);
              const result = ids.map((id: string) => {
                try {
                  const a = agents?.get?.(id);
                  const agent = a?.agent ?? a;
                  const title = titleMap[id] || '';
                  return { id, title: title || id.slice(-8), hasInject: typeof agent?.inject === 'function', hasFollowup: typeof agent?.followup === 'function' };
                } catch { return { id, title: titleMap[id] || id.slice(-8), hasInject: false, hasFollowup: false }; }
              });
              sendJson(res, 200, { agents: result, count: result.length, snapsDiag });
            } catch (e) { sendJson(res, 500, { error: e instanceof Error ? e.message : String(e) }); }
            return;
          }
          if (url === '/messages' && req.method === 'GET') {
            // Return the Jarvis session's conversation (messages with role + text)
            // so the悬浮窗 can display Jarvis's replies inline (the session may
            // not be visible in DSH Desktop's workspace).
            try {
              const s = jarvisHandle?.agent?.session;
              if (!s) { sendJson(res, 200, { messages: [], error: 'no session' }); return; }
              let msgs: any[] = [];
              try { msgs = s.deriveMessages() ?? []; } catch (e1) {
                debug(entry, '/messages: deriveMessages err: ' + (e1 instanceof Error ? e1.message : String(e1)));
                try {
                  const events = (s.snapshotEvents?.() ?? s.ownEvents?.() ?? []) as any[];
                  msgs = events.map((ev: any) => { try { return s.deriveEventMessage?.(ev); } catch { return null; } }).filter(Boolean);
                } catch (e2) { debug(entry, '/messages: snapshot err: ' + (e2 instanceof Error ? e2.message : String(e2))); }
              }
              const conv = msgs.map((m: any, index: number) => {
                const textParts: string[] = [];
                const toolCalls: any[] = [];
                let routedTo: string | undefined;
                if (Array.isArray(m?.content)) {
                  for (const b of m.content) {
                    if (b?.type === 'text') textParts.push(String(b.text));
                    if (b?.type === 'toolCall' || b?.type === 'tool_call') {
                      const raw = b?.arguments ?? b?.input;
                      let args: any = raw;
                      if (typeof raw === 'string') { try { args = JSON.parse(raw); } catch { args = undefined; } }
                      if (b?.name === 'inject_to_session' && typeof args?.session === 'string') routedTo = args.session;
                      toolCalls.push({ name: String(b?.name ?? '?'), args: (typeof raw === 'string' ? raw : JSON.stringify(raw ?? '')).slice(0, 200) });
                    }
                  }
                }
                const role = String(m?.role ?? '?');
                let text = textParts.join('');
                const routed = role === 'user' ? ROUTED_INPUT.exec(text) : null;
                if (routed) { routedTo = routed[1]; text = routed[2] ?? ''; }
                return {
                  id: String(m?.id ?? 'm' + index),
                  role,
                  text,
                  routedTo,
                  toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
                };
              }).filter((m: any) => (m.role === 'user' || m.role === 'assistant')
                && (m.text.length > 0 || (m.toolCalls && m.toolCalls.length > 0)));
              sendJson(res, 200, { messages: conv.slice(-20), count: conv.length });
            } catch (e) { sendJson(res, 500, { error: e instanceof Error ? e.message : String(e) }); }
            return;
          }
          if (url === '/debug' && req.method === 'GET') {
            const h = jarvisHandle;
            const a = h?.agent;
            const s = a?.session;
            const tryLen = (fn: any) => { try { return (fn?.() ?? []).length } catch { return 'err' } };
            const tryLast = (fn: any) => { try { const m = fn?.() ?? []; const last = m.length > 0 ? m[m.length - 1] : null; return last ? (last.role + ': ' + (last.content?.map((b: any) => b.type === 'text' ? b.text : '').join('').slice(0, 80)) ) : '(empty)'; } catch { return 'err' } };
            // sessionQuery diagnostic: what does readTitleSnapshots return?
            let titleDiag = '(not called)';
            try {
              const sq = (ctx as any).get?.('sessionQuery');
              if (sq?.readTitleSnapshots) {
                const agentsSvc = (ctx as any).get?.('agents');
                let rawIds: any[] = [];
                if (typeof agentsSvc?.keys === 'function') rawIds = [...agentsSvc.keys()];
                else if (agentsSvc && typeof agentsSvc[Symbol.iterator] === 'function') rawIds = [...agentsSvc];
                titleDiag = 'rawIds=' + rawIds.length + ' sample=' + JSON.stringify(rawIds.slice(0, 3))?.slice(0, 200) + ' | ';
                const ids = rawIds.map((x: any) => String(typeof x === 'string' ? x : (x?.id ?? x?.sessionId ?? x))).filter((x: string) => x !== entry.jarvisSessionId);
                if (ids.length > 0) {
                  const snaps = await sq.readTitleSnapshots(ids.slice(0, 3));
                  titleDiag += JSON.stringify(snaps)?.slice(0, 400) ?? '(null)';
                } else { titleDiag += 'no ids after filter'; }
              } else { titleDiag = 'sessionQuery/readTitleSnapshots unavailable; proto keys=' + (sq ? Object.getOwnPropertyNames(Object.getPrototypeOf(sq)).join(',') : '(no sq)'); }
            } catch (e) { titleDiag = 'err: ' + (e instanceof Error ? e.message : String(e)); }
            sendJson(res, 200, {
              handleKeys: h ? Object.keys(h).join(',') : '(null)',
              agentKeys: a ? Object.keys(a).slice(0, 25).join(',') : '(null)',
              agentId: a?.id ?? '(none)',
              sessionNull: !s,
              sessionKeys: s ? Object.keys(s).slice(0, 20).join(',') : '(null)',
              sessionSeq: s?.seq ?? '(none)',
              msgsLen: tryLen(s?.deriveMessages),
              msgsLast: tryLast(s?.deriveMessages),
              eventsLen: tryLen(s?.ownEvents),
              hasFollowup: typeof a?.followup === 'function',
              titleDiag,
            });
            return;
          }
          if (url === '/config' && req.method === 'GET') { sendJson(res, 200, { provider: entry.provider, model: entry.model, edgeVoice: entry.edgeVoice }); return; }
          if (url === '/input' && req.method === 'POST') {
            // Inject the user's text into the Jarvis agent → triggers a turn.
            // If a target session is provided, format the message so Jarvis knows
            // to inject into that session (the user picks the session in the悬浮窗
            // picker — no need to type UUIDs).
            const body = JSON.parse((await readBody(req)) || '{}');
            const text = typeof body.text === 'string' ? body.text.trim() : '';
            const session = typeof body.session === 'string' ? body.session.trim() : '';
            if (!text) { sendJson(res, 400, { error: 'empty text' }); return; }
            if (!jarvisHandle) { sendJson(res, 503, { error: 'jarvis agent not ready' }); return; }
            const jarvisText = session
              ? `用户要求把以下内容发给会话 ${session}。请优化说法后用 inject_to_session 发送：\n\n${text}`
              : text;
            const msg: UserMessage = {
              id: MessageId(`jarvis-input-${Date.now().toString(36)}`),
              role: 'user',
              content: [{ type: 'text', text: jarvisText }],
              source: { kind: 'plugin', plugin: 'dsh-harness-jarvis', form: 'notice', summary: session ? 'user input → inject' : 'user input' },
            };
            const agent = jarvisHandle?.agent ?? jarvisHandle;
            live.userSent();
            if (typeof agent?.followup === 'function') {
              agent.followup(msg);
              debug(entry, '/jarvis/input: followup() — "' + text.slice(0, 60) + '"' + (session ? ' → ' + session : ''));
              sendJson(res, 200, { ok: true });
            } else if (typeof agent?.inject === 'function') {
              agent.inject(msg);
              debug(entry, '/jarvis/input: inject() — "' + text.slice(0, 60) + '"');
              sendJson(res, 200, { ok: true });
            } else {
              sendJson(res, 500, { error: 'no followup/inject on jarvis handle' });
            }
            return;
          }
          sendJson(res, 404, { error: 'not found', url });
        } catch (e) { sendJson(res, 500, { error: e instanceof Error ? e.message : String(e) }); }
      },
    });
    debug(entry, 'webServer routes mounted at /jarvis');
  });
  ctx.inject(['settings' as any], () => {
    // TODO §2: installSettingsSection
  });
  ctx.inject(['sessionTitle' as any], () => {
    // TODO §2: title service for worker prefix
  });

  // ── 挂点2: create Jarvis agent with setup callback ────────────────────
  // The plugin creates the agent itself (not relying on cordis.yml config
  // or GUI naming). The setup callback registers persona + tools (挂点2)
  // through agentCtx before the agent is published.
  ctx.inject(['agentLoop' as any], (loopCtx: Context) => {
    debug(entry, 'agentLoop inject callback FIRED');
    const loop = (loopCtx as any).get('agentLoop') as
      | { createAgent: (ownerCtx: Context, opts: any) => Promise<any>; resume: (ownerCtx: Context, opts: any) => Promise<any> }
      | undefined;
    if (!loop) {
      debug(entry, 'agentLoop service NOT found (get returned undefined)');
      ctx.logger?.warn?.('dsh-harness-jarvis: agentLoop not found');
      return;
    }
    debug(entry, 'agentLoop service found, calling createAgent');
    loop.createAgent(ctx, {
      sessionId: entry.jarvisSessionId,
      meta: { cwd: resolveDir(entry.jarvisCwd), agentPreset: 'jarvis' },
      agentOptions: { provider: entry.provider, model: entry.model },
      setup: (agentCtx: Context) => {
        debug(entry, 'setup callback FIRED — decorating Jarvis agent');
        decorateJarvisAgent(agentCtx, entry, ctx);
      },
    }).then((handle: any) => {
      jarvisHandle = handle;
      debug(entry, 'createAgent SUCCESS — Jarvis agent created + decorated (first-install)');
      ctx.logger?.warn?.('dsh-harness-jarvis: Jarvis agent created + decorated');
      kickstartJarvis(handle, entry);
    }).catch((err: unknown) => {
      const errMsg = err instanceof Error ? err.message : String(err);
      debug(entry, 'createAgent failed: ' + errMsg + ' — trying resume');
      if (errMsg.includes('already exists') && loop.resume) {
        loop.resume(ctx, {
          resumeSessionId: entry.jarvisSessionId,
          agentOptions: { provider: entry.provider, model: entry.model },
          setup: (agentCtx: Context) => {
            debug(entry, 'resume setup callback FIRED — decorating');
            decorateJarvisAgent(agentCtx, entry, ctx);
          },
        }).then((handle: any) => {
          jarvisHandle = handle;
          debug(entry, 'resume SUCCESS — Jarvis agent resumed + decorated (restart)');
          void speakGreeting(builtInTts, entry);
        }).catch((err2: unknown) => {
          debug(entry, 'resume ALSO failed: ' + (err2 instanceof Error ? err2.message : String(err2)));
        });
      }
    });
  });

  let titleService: any;
  ctx.inject(['sessionTitle' as any], (tsCtx: Context) => {
    titleService = (tsCtx as any).get('sessionTitle');
    debug(entry, 'sessionTitle attached, keys=' + Object.keys(titleService ?? {}).join(','));
  });

  // ── 挂点1: global listeners (worker events, filtered to managed) ──────
  ctx.on('session/event' as any, (session: { id?: string } | undefined, event: { type?: string; data?: any }) => {
    const sid = typeof session?.id === 'string' ? session.id : undefined;
    if (sid) {
      if (event?.type === 'turn/start') live.turnStarted(sid);
      else if (event?.type === 'turn/end') live.turnEnded(sid, event.data?.reason);
      else if (event?.type === 'user/message' && event.data?.source === 'user') live.markRead(sid);
    }
    // Jarvis agent's own turn/end → re-set title (DSH auto-title overwrites it)
    if (sid === entry.jarvisSessionId && event?.type === 'turn/end') {
      trySetTitle(titleService, entry, '贾维斯');
      // Diagnostic: log the jarvis session's message count after each turn
      try {
        const msgs = jarvisHandle?.session?.deriveMessages?.() ?? [];
        const last = msgs.length > 0 ? msgs[msgs.length - 1] : null;
        const lastText = last?.content?.map((b: any) => b.type === 'text' ? b.text : '').join('').slice(0, 80) ?? '(none)';
        debug(entry, 'jarvis turn/end: ' + msgs.length + ' msgs, last=[' + (last?.role ?? '?') + '] ' + lastText);
      } catch (e) { debug(entry, 'jarvis turn/end: deriveMessages failed: ' + (e instanceof Error ? e.message : String(e))); }
    }
    if (!sid || !managed.has(sid)) return;
    switch (event?.type) {
      case 'turn/end':
        // TODO §8/§10.2: disposition classifier + completion judge
        break;
      case 'approval/asked':
        // TODO §11: relay approval to user
        break;
      case 'ask_user_question':
        // TODO §8: intercept / escalate
        break;
    }
  });

  ctx.on('agent/turn-stopping' as any, (payload: { agent?: any; turn?: number }) => {
    const sid = payload?.agent && String((payload.agent as any).id);
    if (!sid || !managed.has(sid)) return;
    // TODO §13/§8: judge continuation → steer
  });

  // ── approvals / questions relayed to the悬浮窗 (§11) ──────────────────
  // Prepended so the panel races the DSH window; whichever answers first wins.
  ctx.on('approval/request' as any, (req: any, next: () => Promise<any>) =>
    live.holdApproval(req, next, approvalCommand(req)), { prepend: true } as any);
  ctx.on('user-questions/request' as any, (req: any, next: () => Promise<any>) =>
    live.holdAsk(req, next), { prepend: true } as any);

  // ── built-in TTS + voice:tts detect (§5) ─────────────────────────────
  const builtInTts = makeBuiltInTTS(entry.edgeVoice);
  ctx.inject(['voice:tts' as any], () => {
    ctx.logger?.warn?.('dsh-harness-jarvis: external voice:tts detected');
  });

  void lock; void llm; void builtInTts;

  // Cordis convention: apply() returns a disposer that runs when this plugin
  // context is torn down (DSH quits / plugin unloads) — kill the悬浮窗 panel
  // so the orb's lifecycle stays tied to DSH ("和 DSH 作为依赖").
  return () => killPanel(entry);
}

/** Built-in restart welcome greetings per locale. */
function builtinGreetings(locale: string): string[] {
  return locale === 'en' ? ['Welcome back!', 'Welcome!'] : ['欢迎回来。', '欢迎回归。'];
}

/** Pick a random restart welcome greeting from (built-ins ∪ user-configured
 *  greetings). Restart path only — no LLM. */
function pickGreeting(entry: JarvisConfig): string {
  const list = [...builtinGreetings(entry.locale), ...entry.greetings];
  // crypto.randomInt (OS CSPRNG) instead of Math.random — the host pins V8's
  // --random_seed so Math.random() is deterministic per-process (always the
  // same first call), which made every restart pick the same greeting.
  const fallback = builtinGreetings(entry.locale)[0]!;
  if (list.length <= 1) return fallback;
  return list[randomInt(list.length)] ?? fallback;
}

/**
 * First-install kickstart: the jarvis session did NOT exist, so we make the
 * 首次 LLM 访问 to bring the session to life (createAgent created the object;
 * the turn persists/finalises it). The LLM turn's reply is spoken by voice-mini
 * (when linked + narrating jarvis turns). NO fixed welcome greeting here — the
 * welcome greeting is for the restart path (session already exists).
 * (§: session 不存在 → 大模型调用让 session 成功创建) */
function kickstartJarvis(handle: any, entry: JarvisConfig): void {
  try {
    const init = entry.locale === 'en' ? 'Hello' : '你好';
    const msg: UserMessage = {
      id: MessageId(`jarvis-init-${Date.now().toString(36)}`),
      role: 'user',
      content: [{ type: 'text', text: init }],
      source: { kind: 'plugin', plugin: 'dsh-harness-jarvis', form: 'notice', summary: 'first-install-init' },
    };
    const agent = handle?.agent ?? handle;
    if (typeof agent?.followup === 'function') {
      agent.followup(msg);
      debug(entry, 'kickstart: followup() (first-install LLM turn, create session) — "' + init + '"');
    } else if (typeof agent?.inject === 'function') {
      agent.inject(msg);
      debug(entry, 'kickstart: inject() (first-install, may not trigger turn) — "' + init + '"');
    } else {
      debug(entry, 'kickstart: no followup/inject on handle — session created but no init turn');
    }
  } catch (e) {
    debug(entry, 'kickstart failed: ' + (e instanceof Error ? e.message : String(e)));
  }
}

/**
 * Restart welcome greeting (session already existed → NO LLM). Picks a random
 * greeting from the list and speaks it via voice-mini /test (chime+TTS, the
 * "完整体": jarvis+voice-mini); falls back to built-in edge-tts if voice-mini is
 * absent. NO text written into the session (§: session 存在 → 欢迎语，随机选，不跑LLM).
 */
async function speakGreeting(
  tts: { synthesize: (text: string, outFile: string) => Promise<unknown>; play: (file: string) => unknown },
  entry: JarvisConfig,
): Promise<void> {
  if (voiceMuted) { debug(entry, 'speakGreeting: muted, skipped'); return; }
  const text = pickGreeting(entry);
  debug(entry, 'speakGreeting: picked "' + text + '"');
  speakingUntil = Date.now() + 6000; // orb pulses for ~6s while the greeting speaks
  // 1) voice-mini /test (chime + TTS, no LLM)
  if (webOrigin) {
    const ok = await speakViaVoiceMini(webOrigin, text, entry);
    if (ok) { debug(entry, 'speakGreeting: via voice-mini /test (chime+TTS) — "' + text + '"'); return; }
    debug(entry, 'speakGreeting: voice-mini /test unavailable/failed → built-in fallback');
  } else {
    debug(entry, 'speakGreeting: webOrigin not captured yet → built-in fallback');
  }
  // 2) built-in edge-tts fallback (cached per greeting text)
  try {
    const audioDir = resolveDir(entry.audioDir);
    const textHash = Buffer.from(text, 'utf8').toString('base64url').slice(0, 16);
    const outFile = join(audioDir, `greet-restart-${textHash}.mp3`);
    if (!existsSync(outFile)) {
      await tts.synthesize(text, outFile);
      debug(entry, 'speakGreeting: synthesized "' + text + '" → ' + outFile);
    } else {
      debug(entry, 'speakGreeting: reused cached ' + outFile);
    }
    void tts.play(outFile);
    debug(entry, 'speakGreeting: built-in edge-tts playing (no LLM, no session text)');
  } catch (e) {
    debug(entry, 'speakGreeting built-in failed: ' + (e instanceof Error ? e.message : String(e)));
  }
}

/** Speak via voice-mini: (1) fast GET /voice-mini/state to confirm voice-mini
 *  is loaded on the same-host webServer; (2) if present, fire-and-forget POST
 *  /voice-mini/test {text, jarvis:true} — we DON'T await voice-mini's synth+play
 *  (it returns 200 only after playback ~6s, and hangs on a busy voice-mini,
 *  which used to time out → double-sound with the built-in fallback). voice-mini
 *  keeps processing after we move on, so it plays regardless. Returns true iff
 *  voice-mini is present (caller then skips built-in). /state is loopback-open
 *  in voice-mini; we also pass its bearer + rendererHeader from its runtime file. */
async function speakViaVoiceMini(origin: string, text: string, entry: JarvisConfig): Promise<boolean> {
  const vm = readVoiceMiniRuntime();
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (vm?.token) headers['Authorization'] = `Bearer ${vm.token}`;
  if (vm?.rendererHeader && typeof vm.rendererHeader.name === 'string') {
    headers[vm.rendererHeader.name] = String(vm.rendererHeader.value);
  }
  // 1) presence check (fast, ~ms): GET /state
  try {
    const sc = new AbortController();
    const st = setTimeout(() => sc.abort(), 2500);
    const sr = await fetch(`${origin}/voice-mini/state`, { headers, signal: sc.signal });
    clearTimeout(st);
    if (!sr.ok) { debug(entry, 'speakViaVoiceMini: /state HTTP ' + sr.status + ' → voice-mini absent, built-in fallback'); return false; }
  } catch (e) {
    debug(entry, 'speakViaVoiceMini: /state failed (' + (e instanceof Error ? e.message : String(e)) + ') → absent, built-in fallback');
    return false;
  }
  // 2) present → fire-and-forget POST /test (don't await synth+chime+play)
  fetch(`${origin}/voice-mini/test`, {
    method: 'POST', headers, body: JSON.stringify({ text, jarvis: true }),
  }).catch(() => { /* swallow: presence already confirmed */ });
  debug(entry, 'speakViaVoiceMini: /test sent fire-and-forget — "' + text + '" (voice-mini owns synth+chime+play)');
  return true;
}

/** Best-effort read of voice-mini's runtime file (~/.dsh/voice-mini/runtime.json)
 *  for its bearer token + rendererHeader. Returns null if absent/unreadable
 *  (voice-mini not installed or not yet started). */
function readVoiceMiniRuntime(): { token?: string; rendererHeader?: { name: string; value: string } } | null {
  try {
    const f = join(homedir(), '.dsh', 'voice-mini', 'runtime.json');
    if (!existsSync(f)) return null;
    return JSON.parse(readFileSync(f, 'utf8'));
  } catch { return null; }
}

/** voice-mini narrates Jarvis (and every other session), so its playback is
 *  what the user hears as "Jarvis speaking". Cached briefly: /jarvis/state is
 *  polled every second and this is a same-host round trip. */
type Narration = { speaking: boolean; paused: boolean; queued: number };
const SILENT: Narration = { speaking: false, paused: false, queued: 0 };
const voiceMiniCache = { at: 0, value: SILENT };
async function voiceMiniSpeech(origin: string | null): Promise<Narration> {
  if (!origin || Date.now() - voiceMiniCache.at < 400) return voiceMiniCache.value;
  voiceMiniCache.at = Date.now();
  const vm = readVoiceMiniRuntime();
  if (!vm?.token) { voiceMiniCache.value = SILENT; return SILENT; }
  try {
    const r = await fetch(origin + '/voice-mini/pet/state', {
      headers: { Authorization: `Bearer ${vm.token}` },
      signal: AbortSignal.timeout(300),
    });
    const body = r.ok ? await r.json() as { speaking?: unknown; paused?: unknown; queued?: unknown } : {};
    voiceMiniCache.value = {
      speaking: body.speaking === true,
      paused: body.paused === true,
      queued: typeof body.queued === 'number' ? body.queued : 0,
    };
  } catch { /* keep the last value; voice-mini may be busy or absent */ }
  return voiceMiniCache.value;
}

/** Playback control is voice-mini's; Jarvis only forwards the signal. */
const VOICE_MINI_CONTROL: Record<string, string> = {
  pause: '/voice-mini/pause',
  resume: '/voice-mini/resume',
  skip: '/voice-mini/skip',
  clear: '/voice-mini/queue/clear',
};
async function voiceMiniControl(origin: string | null, action: string): Promise<boolean> {
  const path = VOICE_MINI_CONTROL[action];
  if (!origin || !path) return false;
  const vm = readVoiceMiniRuntime();
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (vm?.token) headers['Authorization'] = `Bearer ${vm.token}`;
  if (vm?.rendererHeader && typeof vm.rendererHeader.name === 'string') {
    headers[vm.rendererHeader.name] = String(vm.rendererHeader.value);
  }
  voiceMiniCache.at = 0;
  try {
    const r = await fetch(origin + path, { method: 'POST', headers, body: '{}', signal: AbortSignal.timeout(1500) });
    return r.ok;
  } catch { return false; }
}

/** `running` per the agents service, or undefined when it can't tell. */
function agentRunning(ctx: Context, id: string): boolean | undefined {
  try {
    const a = (ctx as any).get?.('agents')?.get?.(id);
    const status = a?.status ?? a?.agent?.status;
    return typeof status === 'string' ? status === 'running' : undefined;
  } catch { return undefined; }
}

/** The command an approval is about, pulled from the asking agent's pending tool call. */
function approvalCommand(req: { agent?: any; callId?: unknown }): string | undefined {
  if (req.callId === undefined) return undefined;
  try {
    const msgs: any[] = req.agent?.session?.deriveMessages?.() ?? [];
    for (let i = msgs.length - 1; i >= Math.max(0, msgs.length - 4); i--) {
      for (const b of msgs[i]?.content ?? []) {
        if ((b?.type !== 'toolCall' && b?.type !== 'tool_call') || b?.id !== req.callId) continue;
        let args: any = b.arguments ?? b.input;
        if (typeof args === 'string') { try { args = JSON.parse(args); } catch { return args.slice(0, 300); } }
        const text = typeof args?.command === 'string' ? args.command
          : typeof args?.path === 'string' ? args.path
            : JSON.stringify(args ?? '');
        return text.slice(0, 300);
      }
    }
  } catch {}
  return undefined;
}

/** Try to set the Jarvis session title (DSH auto-title overwrites it after each turn). */
function trySetTitle(titleService: any, entry: JarvisConfig, title: string): void {
  if (!titleService) { debug(entry, 'titleService not available'); return; }
  try {
    if (typeof titleService.set === 'function') {
      titleService.set(entry.jarvisSessionId, title);
      debug(entry, 'title set via .set()');
    } else if (typeof titleService.setTitle === 'function') {
      titleService.setTitle(entry.jarvisSessionId, title);
      debug(entry, 'title set via .setTitle()');
    } else if (typeof titleService.update === 'function') {
      titleService.update(entry.jarvisSessionId, { title });
      debug(entry, 'title set via .update()');
    } else {
      debug(entry, 'titleService no set/setTitle/update — keys=' + Object.keys(titleService).join(','));
    }
  } catch (e) {
    debug(entry, 'trySetTitle failed: ' + (e instanceof Error ? e.message : String(e)));
  }
}

// ── 挂点2: decorate Jarvis agent (via agentCtx from setup callback) ────
function decorateJarvisAgent(agentCtx: Context, entry: JarvisConfig, ctx: Context): void {
  debug(entry, 'decorateJarvisAgent started');
  // Use agentCtx.inject (not ctx.inject) so section registers on AGENT scope
  agentCtx.inject(['systemPrompt' as any], () => {
    debug(entry, 'systemPrompt inject fired (agentCtx)');
    const sp = (agentCtx as any).get?.('systemPrompt') as
      | { section?: (s: { name: string; order: number; text: () => string }) => void }
      | undefined;
    debug(entry, 'sp=' + (sp ? 'found' : 'UNDEFINED') + ' section=' + (sp?.section ? 'found' : 'UNDEFINED'));
    sp?.section?.({
      name: 'jarvis:persona',
      order: 50,
      text: () => COMMANDER_PERSONA,
    });
    debug(entry, 'persona section registered OK');
  });

  registerJarvisTools(agentCtx, entry);
}

function registerJarvisTools(agentCtx: Context, entry: JarvisConfig): void {
  const tools = (agentCtx as any).tools as { register: (t: unknown) => () => void } | undefined;
  debug(entry, 'tools=' + (tools ? 'found' : 'UNDEFINED'));
  if (!tools) { debug(entry, 'tools NOT found — cannot register'); return; }
  const selfId = entry.jarvisSessionId;

  tools.register(defineTool({
    name: 'say_to_user',
    description: '口播给用户一句话。一两句,别读代码/路径/markdown。',
    parameters: { text: { type: 'string' as const, required: true } },
    output: { schema: { type: 'object', additionalProperties: false, properties: { ok: { type: 'boolean' } } }, render: () => [{ type: 'text', text: 'ok' }] },
    isConcurrencySafe: () => true,
    async execute() { throw new Error('TODO §5: synth + play'); },
  } as never));

  tools.register(defineTool({
    name: 'ask_user',
    description: '问用户拿回答(是否执行思路、续轮批准、审批 relay)。',
    parameters: { question: { type: 'string' as const, required: true }, choices: { type: 'array' } },
    output: { schema: { type: 'object', additionalProperties: false, properties: { ok: { type: 'boolean' } } }, render: () => [{ type: 'text', text: 'ok' }] },
    isConcurrencySafe: () => true,
    async execute() { throw new Error('TODO §7: userQuestions.ask'); },
  } as never));

  tools.register(defineTool({
    name: 'inject_to_session',
    description: '向某托管会话发内容。target 不能是自己,且 ∈ 托管集。',
    parameters: { session: { type: 'string' as const, required: true }, message: { type: 'string' as const, required: true } },
    output: { schema: { type: 'object', additionalProperties: false, properties: { ok: { type: 'boolean' } } }, render: () => [{ type: 'text', text: 'ok' }] },
    isConcurrencySafe: () => true,
    async execute(args: { session: string; message: string }) {
      if (args.session === selfId) throw new Error('inject_to_session: cannot target self');
      const agents = (agentCtx as any).get?.('agents') as { get(id: string): any } | undefined;
      const target = agents?.get(args.session);
      if (!target) throw new Error('inject_to_session: target not found');
      // TODO §9.2: enforce target ∈ managed set
      // TODO §3.2: acquire output lock
      const note: UserMessage = {
        id: MessageId(`jarvis-${Date.now().toString(36)}`),
        role: 'user',
        content: [{ type: 'text', text: args.message }],
        source: { kind: 'plugin', plugin: 'dsh-harness-jarvis', form: 'notice', summary: 'jarvis inject' },
      };
      try { target.inject(note); } catch { /* disposed */ }
      return { ok: true };
    },
  } as never));

  tools.register(defineTool({
    name: 'monitor_session',
    description: '把某托管会话纳入监听。',
    parameters: { session: { type: 'string' as const, required: true } },
    output: { schema: { type: 'object', additionalProperties: false, properties: { ok: { type: 'boolean' } } }, render: () => [{ type: 'text', text: 'ok' }] },
    isConcurrencySafe: () => true,
    async execute() { throw new Error('TODO §8: add to monitor set'); },
  } as never));

  tools.register(defineTool({
    name: 'stop_monitoring',
    description: '停止监听某会话。',
    parameters: { session: { type: 'string' as const, required: true } },
    output: { schema: { type: 'object', additionalProperties: false, properties: { ok: { type: 'boolean' } } }, render: () => [{ type: 'text', text: 'ok' }] },
    isConcurrencySafe: () => true,
    async execute() { throw new Error('TODO §8: remove from monitor set'); },
  } as never));

  tools.register(defineTool({
    name: 'recall',
    description: '检索记忆(temp JSONL + 长期 HTML),返回关键点 + 源指针。',
    parameters: { query: { type: 'string' as const, required: true } },
    output: { schema: { type: 'object', additionalProperties: false, properties: { ok: { type: 'boolean' } } }, render: () => [{ type: 'text', text: 'ok' }] },
    isConcurrencySafe: () => true,
    async execute() { throw new Error('TODO §10: grep memory'); },
  } as never));

  tools.register(defineTool({
    name: 'remember',
    description: '显式写一条长期记忆(HTML)。',
    parameters: { tag: { type: 'string' as const, required: true }, content: { type: 'string' as const, required: true }, intent: { type: 'string' }, session: { type: 'string' } },
    output: { schema: { type: 'object', additionalProperties: false, properties: { ok: { type: 'boolean' } } }, render: () => [{ type: 'text', text: 'ok' }] },
    isConcurrencySafe: () => true,
    async execute() { throw new Error('TODO §10: write HTML memory'); },
  } as never));

  tools.register(defineTool({
    name: 'list_managed',
    description: '返回托管集 + 当前监听集。',
    parameters: {},
    output: { schema: { type: 'object', additionalProperties: false, properties: { ok: { type: 'boolean' } } }, render: () => [{ type: 'text', text: 'ok' }] },
    isConcurrencySafe: () => true,
    async execute() { throw new Error('TODO §9.2: return managed + monitor sets'); },
  } as never));
}

export default { name, inject, Config, apply };
