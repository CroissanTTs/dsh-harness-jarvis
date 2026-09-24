import { lstatSync, readlinkSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, isAbsolute, join, relative, sep } from 'node:path';

export type ApprovalTier = 'safe' | 'grey' | 'medium' | 'high';
export interface ApprovalOperation {
  tool: string;
  command: string;
  path?: string;
  /** Trusted workspace boundary, not a cwd supplied by the operation being approved. */
  cwd: string;
  /** Complete original tool arguments, before any UI preview truncation. */
  args?: string;
}

// These tables are exported so settings can later present the actual built-in rules.
// Extending a safe rule requires reviewing every supported option's side effects.
export const SAFE_TOOLS = Object.freeze(['read', 'read_file', 'glob', 'grep', 'search', 'list', 'list_directory', 'ls', 'file_search', 'web_search']);
export const WRITE_TOOLS = Object.freeze(['write', 'write_file', 'edit', 'edit_file', 'multiedit']);
export const SHELL_TOOLS = Object.freeze(['bash', 'shell', 'exec', 'exec_command', 'run_command']);
export const SAFE_COMMANDS = Object.freeze(['ls', 'cat', 'head', 'tail', 'wc', 'rg', 'grep', 'find', 'pwd', 'echo', 'which']);
export const HIGH_COMMANDS = Object.freeze(['sudo', 'doas', 'dd', 'launchctl', 'eval', 'exec', 'command', 'env', 'xargs',
  'sh', 'bash', 'zsh', 'dash', 'fish', 'ksh', 'source', '.', 'node', 'nodejs', 'python', 'python3', 'ruby', 'perl',
  'php', 'lua', 'osascript', 'awk', 'gawk', 'sed', 'make', 'npx', 'bun', 'deno', 'ssh', 'su', 'nohup', 'timeout', 'busybox', 'sudoedit', 'tclsh', 'wish', 'swift', 'java', 'js', 'jsc', 'sqlite3', 'mysql', 'psql', 'time', 'nice', 'ionice', 'parallel', 'watch']);
export const PROTECTED_DIRECTORIES = Object.freeze(['.ssh', '.dsh']);
export const SAFE_OPTIONS: Readonly<Record<string, readonly string[]>> = Object.freeze({
  ls: Object.freeze(['-l', '-a', '-h', '-la', '-lah', '-al', '-R', '-1', '-d', '-t', '-r', '-S', '--all', '--long', '--human-readable']),
  cat: Object.freeze(['-n', '-b', '-s', '-v', '-E', '-T', '-A']),
  head: Object.freeze(['-n', '-c', '-q', '-v']), tail: Object.freeze(['-n', '-c', '-f', '-F', '-q', '-v']),
  wc: Object.freeze(['-l', '-w', '-c', '-m', '-L']),
  rg: Object.freeze(['-n', '-l', '-i', '-F', '-e', '--regexp', '--files', '--hidden', '--glob', '-g', '--type', '-t',
    '--count', '-c', '-A', '-B', '-C', '--context', '--max-count', '-m', '--no-heading', '--line-number', '--files-with-matches', '--fixed-strings']),
  grep: Object.freeze(['-n', '-l', '-i', '-r', '-R', '-F', '-E', '-c', '-e', '-A', '-B', '-C', '-m', '--color']),
  find: Object.freeze(['-name', '-iname', '-type', '-maxdepth', '-mindepth', '-print', '-print0', '-size', '-mtime', '-atime', '-ctime', '-path', '-ipath', '-empty']),
  pwd: Object.freeze(['-L', '-P']), echo: Object.freeze(['-n', '-e', '-E']), which: Object.freeze(['-a', '-s']),
});
export const GIT_READ_OPTIONS = Object.freeze(['--short', '--porcelain', '--stat', '--oneline', '--all', '--cached', '--staged',
  '--name-only', '--name-status', '--no-ext-diff', '--no-textconv', '--no-pager', '--patch', '-p', '--summary', '--numstat',
  '--check', '--raw', '--decorate', '--format', '--pretty', '-n', '--max-count', '--graph', '--color', '--no-color', '-U', '--unified',
  '--abbrev-commit', '--no-renames', '--exit-code', '--quiet', '--relative', '--date']);

function hasProtectedPart(path: string): boolean {
  return path.split(/[\\/]/).some(part => PROTECTED_DIRECTORIES.includes(part.toLowerCase()));
}

/** Walk components before normalization. Missing leaves are fine; dangling links,
 * link loops, and traversal components fail closed. Retain protection seen in
 * intermediate symlink targets, even when a later link resolves elsewhere. */
function canonical(path: string, depth = 0): { path: string; protected: boolean; exists: boolean } {
  if (!isAbsolute(path) || path.includes('\0') || path.split('/').includes('..') || depth > 40) throw Error('Ambiguous path');
  let current: string = sep;
  let protectedPath = hasProtectedPart(path);
  let exists = true;
  for (const part of path.split('/').filter(part => part && part !== '.')) {
    current = join(current, part);
    if (!exists) continue;
    try {
      const stat = lstatSync(current);
      if (stat.isSymbolicLink()) {
        const target = readlinkSync(current);
        const resolved = canonical(isAbsolute(target) ? target : dirname(current) + '/' + target, depth + 1);
        if (!resolved.exists) throw Error('Dangling symbolic link');
        protectedPath ||= resolved.protected;
        current = resolved.path;
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      exists = false;
    }
  }
  return { path: current, protected: protectedPath, exists };
}
function writeInside(path: string, cwd: string): boolean {
  if (!path || path.includes('\0') || path.split('/').includes('..') || path.startsWith('~') && path !== '~' && !path.startsWith('~/')) return false;
  const expanded = path === '~' ? homedir() : path.startsWith('~/') ? homedir() + path.slice(1) : path;
  const candidate = canonical(isAbsolute(expanded) ? expanded : cwd + '/' + expanded);
  const workspace = canonical(cwd);
  const rel = relative(workspace.path, candidate.path);
  return !candidate.protected && !workspace.protected && !isAbsolute(rel) && rel !== '..' && !rel.startsWith('..' + sep);
}

interface Token { value: string; redirect: boolean }
/** Intentionally a shell subset, never an evaluator. Quoted punctuation is data;
 * active expansions, escapes, pipelines, chains and subshells are opaque/high. */
function tokenize(command: string): Token[] | undefined {
  const tokens: Token[] = [];
  let value = '', started = false, quote = '';
  const flush = () => { if (started) tokens.push({ value, redirect: false }); value = ''; started = false; };
  for (let i = 0; i < command.length; i++) {
    const char = command[i];
    if (/[\0\r\n]/.test(char)) return;
    if (quote) {
      if (char === quote) { quote = ''; continue; }
      if (quote === '"' && /[$`\\]/.test(char)) return;
      value += char; continue;
    }
    if (char === "'" || char === '"') { quote = char; started = true; continue; }
    if (/\s/.test(char)) { flush(); continue; }
    if (char === '>') {
      flush(); const append = command[i + 1] === '>'; if (append) i++;
      tokens.push({ value: append ? '>>' : '>', redirect: true }); continue;
    }
    if (/[;&|<$`\\(){}*?\[\]!#]/.test(char)) return;
    started = true; value += char;
  }
  if (quote) return;
  flush(); return tokens;
}
function optionsAllowed(words: string[], options: readonly string[]): boolean {
  let positional = false;
  for (const word of words) {
    if (word === '--') { positional = true; continue; }
    if (!positional && word.startsWith('-') && !options.includes(word.split('=')[0])) return false;
  }
  return true;
}
function dangerousFlag(words: string[], pattern: RegExp): boolean { return words.some(word => pattern.test(word)); }
function opaqueCwd(words: string[]): boolean {
  return dangerousFlag(words, /^(?:--(?:cwd|dir|directory|prefix|work-tree|git-dir|config-env)|-C)(?:=|$)/) ||
    words.some(word => /^-C.+/.test(word));
}
function shellTier(command: string, cwd: string): ApprovalTier {
  if (/\bDROP\s+(?:TABLE|DATABASE)\b/i.test(command)) return 'high';
  const tokens = tokenize(command);
  if (!tokens?.length || tokens[0].redirect) return 'high';
  const redirects: string[] = [], words: string[] = [];
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i].redirect) {
      const target = tokens[++i];
      if (!target || target.redirect || !writeInside(target.value, cwd)) return 'high';
      redirects.push(target.value);
    } else words.push(tokens[i].value);
  }
  const executable = words.shift()!;
  const name = basename(executable);
  if (!executable || executable.includes('=') || executable.startsWith('~') ||
    executable !== name && !['/bin', '/usr/bin'].includes(dirname(executable))) return 'high';
  if (HIGH_COMMANDS.includes(name) || /^mkfs(?:\.|$)/.test(name) || /^(?:python|perl|ruby|php)\d/.test(name)) return 'high';
  if (opaqueCwd(words) || words.some(word => /^~[^/]/.test(word))) return 'high';
  let tier: ApprovalTier;
  if (SAFE_COMMANDS.includes(name)) {
    // echo does not execute its literal arguments; other read commands use a
    // narrow option allowlist to exclude preprocessors/output/config switches.
    tier = name === 'find' && words.includes('--') ? 'high' : name === 'echo' || optionsAllowed(words, SAFE_OPTIONS[name]) ? 'safe' : 'high';
  } else if (name === 'git') {
    tier = gitTier(words);
  } else if (name === 'rm') {
    tier = dangerousFlag(words, /^(?:--rec|-[^-]*[rR])/) ? 'high' : pathsTier(words, cwd);
  } else if (name === 'chmod' || name === 'chown') {
    tier = dangerousFlag(words, /^(?:--rec|-[^-]*[rR])/) ? 'high' : pathsTier(words.slice(1), cwd);
  } else if (name === 'kill') {
    tier = words.includes('1') && dangerousFlag(words, /^(?:-9|-KILL|-SIGKILL|KILL|SIGKILL|9|--signal=(?:9|KILL|SIGKILL))$/i) ? 'high' : 'grey';
  } else if (['mv', 'cp', 'touch', 'mkdir'].includes(name)) {
    tier = pathsTier(words, cwd);
  } else if (['npm', 'pnpm', 'yarn', 'pip', 'pip3'].includes(name)) {
    tier = installTier(name, words, cwd);
  } else if (name === 'curl' || name === 'wget') {
    tier = networkTier(name, words, cwd);
  } else {
    // Unknown simple tools are the only shell forms eligible for model review.
    tier = 'grey';
  }
  // Redirects always mutate, and must not disguise an otherwise unknown program.
  return redirects.length && tier !== 'high' ? tier === 'safe' || tier === 'medium' ? 'medium' : 'high' : tier;
}
function gitTier(words: string[]): ApprovalTier {
  const [subcommand, ...args] = words;
  if (!subcommand || subcommand.startsWith('-')) return 'high';
  if (dangerousFlag(args, /^--(?:ext-diff|textconv|output|exec|upload-pack|receive-pack|config|work-tree|git-dir)(?:=|$)/)) return 'high';
  if (subcommand === 'reset' && args.some(arg => arg.startsWith('--hard'))) return 'high';
  if (subcommand === 'clean') return 'high';
  if (['status', 'diff', 'log', 'show'].includes(subcommand)) {
    return optionsAllowed(args, GIT_READ_OPTIONS) ? 'safe' : 'high';
  }
  if (subcommand === 'branch') {
    if (!args.length) return 'safe';
    if (args.every(arg => ['--show-current', '-a', '--all', '-r', '--remotes', '-v', '-vv', '--verbose'].includes(arg))) return 'safe';
    if (args[0] === '--list' || args[0] === '-l') return optionsAllowed(args.slice(1), ['-a', '--all', '-r', '--remotes']) ? 'safe' : 'high';
    return optionsAllowed(args, ['-d', '-D', '--delete', '-m', '-M', '--move', '-c', '-C', '--copy', '--force', '-f']) ? 'grey' : 'high';
  }
  if (subcommand === 'push') {
    if (dangerousFlag(args, /^(?:\+|--(?:for|mirror|delete)|-[^-]*f)/)) return 'high';
    if (!optionsAllowed(args, ['-u', '--set-upstream', '--dry-run', '--verbose', '-v', '--tags', '--all', '--atomic', '--porcelain'])) return 'high';
    if (args.some(arg => /^(?:ext::|[^\s]+::|file:|\/|\.\.?\/|~)/.test(arg))) return 'high';
    return 'medium';
  }
  if (subcommand === 'commit') return optionsAllowed(args, ['-m', '--message', '-a', '--all', '--amend', '--no-edit', '--allow-empty', '--dry-run', '-v', '--verbose']) ? 'medium' : 'high';
  return ['fetch', 'checkout', 'switch', 'restore', 'merge', 'rebase', 'tag', 'stash', 'remote'].includes(subcommand) &&
    args.every(arg => !arg.startsWith('-')) ? 'grey' : 'high';
}
function pathsTier(words: string[], cwd: string): ApprovalTier {
  const paths = words.filter(word => word !== '--');
  // Avoid option values that designate alternate targets or execute programs.
  if (paths.some(word => word.startsWith('-') && !['-f', '-i', '-n', '-v', '-p', '-r', '-R'].includes(word))) return 'high';
  const operands = paths.filter(word => !word.startsWith('-'));
  return operands.length && operands.every(path => writeInside(path, cwd)) ? 'medium' : 'high';
}
function installTier(name: string, words: string[], cwd: string): ApprovalTier {
  const [subcommand, ...args] = words;
  if (args.includes('--')) return 'high';
  // Project script execution is deliberately grey: the context/model decision
  // must justify it. Syntax/option/cwd hazards are still rejected before here.
  if (['npm', 'pnpm', 'yarn'].includes(name) && ['test', 'run', 'build', 'start', 'lint', 'check', 'dev'].includes(subcommand)) {
    return args.every(arg => /^[a-zA-Z0-9_:@./-]+$/.test(arg) && !arg.startsWith('-') && !HIGH_COMMANDS.includes(arg) && arg !== 'rm') ? 'grey' : 'high';
  }
  if (!['install', 'add', 'ci'].includes(subcommand)) return 'high';
  const options = ['--save-dev', '-D', '--save-exact', '-E', '--ignore-scripts', '--no-audit', '--no-fund', '--offline', '--silent', '--dry-run', '--frozen-lockfile'];
  if (name === 'pip' || name === 'pip3') {
    if (subcommand !== 'install') return 'high';
    let target = '';
    const remaining: string[] = [];
    for (let i = 0; i < args.length; i++) {
      if (args[i] === '--target' || args[i] === '-t') { target = args[++i] ?? ''; continue; }
      if (args[i].startsWith('--target=')) { target = args[i].slice(9); continue; }
      remaining.push(args[i]);
    }
    return target && writeInside(target, cwd) && optionsAllowed(remaining, ['--upgrade', '-U', '--no-deps', '--quiet', '-q']) ? 'medium' : 'high';
  }
  if (!optionsAllowed(args, options)) return 'high';
  if (args.some(arg => (arg.startsWith('/') || arg.startsWith('.') || arg.startsWith('~') || arg.startsWith('file:')) && !writeInside(arg.replace(/^file:/, ''), cwd))) return 'high';
  return 'medium';
}
function networkTier(name: string, words: string[], cwd: string): ApprovalTier {
  const options = name === 'curl' ? ['--fail', '--silent', '--show-error', '--location', '-f', '-s', '-S', '-L', '-I', '--head', '-X', '--request', '-H', '--header', '-d', '--data', '--data-raw', '--max-time'] : ['-q', '--quiet', '--timeout'];
  for (let i = 0; i < words.length; i++) {
    const arg = words[i];
    const output = name === 'curl' ? /^(?:-o|--output)(?:=|$)/ : /^(?:-O|--output-document)(?:=|$)/;
    if (output.test(arg)) {
      const path = arg.includes('=') ? arg.slice(arg.indexOf('=') + 1) : words[++i];
      if (!path || !writeInside(path, cwd)) return 'high';
    } else if (name === 'curl' && arg.startsWith('-o') && arg.length > 2 || name === 'wget' && arg.startsWith('-O') && arg.length > 2) {
      if (!writeInside(arg.slice(2), cwd)) return 'high';
    } else if (arg.startsWith('-') && !options.includes(arg.split('=')[0])) return 'high';
    // Network payloads can reference files, but do not write those files.
  }
  return 'medium';
}

/** Pure classification: no subprocesses, model calls, writes, or DSH imports.
 * Filesystem metadata is read synchronously only to validate the write boundary. */
export function classify(operation: ApprovalOperation): ApprovalTier {
  try {
    const { tool, command, cwd, args } = operation;
    if (typeof tool !== 'string' || !tool.trim() || typeof command !== 'string' || !command.trim() ||
      typeof cwd !== 'string' || !isAbsolute(cwd) || cwd.includes('\0')) return 'high';
    const workspace = canonical(cwd);
    if (!workspace.exists) return 'high';
    let data: Record<string, unknown> = {};
    if (args !== undefined) {
      if (typeof args !== 'string') return 'high';
      const parsed = JSON.parse(args);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return 'high';
      data = parsed;
    }
    for (const key of ['cwd', 'workdir', 'working_directory', 'workspace']) {
      if (data[key] !== undefined && (typeof data[key] !== 'string' || !isAbsolute(data[key]) || canonical(data[key]).path !== workspace.path)) return 'high';
    }
    const name = tool.toLowerCase();
    if (SHELL_TOOLS.includes(name)) {
      for (const key of ['command', 'cmd', 'script']) if (data[key] !== undefined && data[key] !== command) return 'high';
      return shellTier(command, cwd);
    }
    if (WRITE_TOOLS.includes(name)) {
      const acceptedFields = ['path', 'file_path', 'filePath', 'content', 'text', 'old_string', 'new_string', 'oldString', 'newString',
        'old_text', 'new_text', 'replace_all', 'replaceAll', 'create', 'append', 'encoding', 'cwd', 'workdir', 'working_directory', 'workspace'];
      if (Object.keys(data).some(key => !acceptedFields.includes(key))) return 'high';
      const paths = [operation.path, data.path, data.file_path, data.filePath].filter(path => path !== undefined);
      if (!paths.length) paths.push(command);
      return paths.every(path => typeof path === 'string' && writeInside(path, cwd)) ? 'medium' : 'high';
    }
    if (SAFE_TOOLS.includes(name)) return 'safe';
    return 'grey';
  } catch { return 'high'; }
}
