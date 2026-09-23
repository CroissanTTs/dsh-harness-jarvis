// PROTOTYPE — edge-tts child-process synth. Args: <text> <out.mp3> [voice] [rate].
//
// WHY a child process: edge-tts is 100% reliable in plain Node but flakes
// (10s timeout, 0-byte file) ~50% when run in the Electron MAIN process —
// its WebSocket misbehaves under Electron's network stack. Spawning a child
// with ELECTRON_RUN_AS_NODE=1 makes it plain Node again, restoring the
// reliability. Same isolation pattern kokoro-js already uses.
//
// This process may abort-trap on exit under some Node/Electron combos; the
// parent judges success by the output FILE, so always write BEFORE exit.
import { EdgeTTS } from 'node-edge-tts';

const [text, outFile, voice = 'zh-CN-XiaoxiaoNeural', rateArg = '+0%'] = process.argv.slice(2);
if (!text || !outFile) {
  console.error('usage: synth-edge.mjs <text> <out.mp3> [voice] [rate]');
  process.exit(2);
}

try {
  // 6s cap: a normal synth is ~1.5s; if Microsoft isn't responding, fail
  // fast so the caller's retry (with the fallback voice) runs sooner.
  const tts = new EdgeTTS({ voice, rate: rateArg, timeout: 6000 });
  await tts.ttsPromise(text, outFile);
  process.exit(0);
} catch (e) {
  console.error('synth-edge failed:', e?.message ?? e);
  process.exit(1);
}
