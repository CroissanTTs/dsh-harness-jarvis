import { lstatSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';

export interface PresetOperation { tool: string; command: string; workspace: string; args?: string }

// P0 only needs the high-risk veto. Unknown shell syntax/tools stay manual;
// these are deliberately narrower than P1's future four-tier classification.
const FILE_TOOLS = new Set(['read', 'read_file', 'write', 'write_file', 'edit', 'edit_file', 'multiedit']);
const SHELL_TOOLS = new Set(['bash', 'shell', 'exec', 'exec_command', 'run_command']);
const COMMANDS = new Set(['ls', 'cat', 'head', 'tail', 'wc', 'rg', 'grep', 'find', 'pwd', 'echo', 'which',
  'git', 'swift', 'npm', 'pnpm', 'yarn', 'pip', 'pip3', 'rm', 'mv', 'cp', 'mkdir', 'touch', 'chmod', 'chown', 'curl', 'wget']);
// Do not guess whether an unknown switch hides a path, executes code, changes
// cwd, or selects global output. New option support requires an explicit review.
const OPTIONS: Readonly<Record<string, readonly string[]>> = {
  ls: ['-l', '-a', '-h', '-la', '-lah', '-al', '-R'], cat: ['-n', '-b', '-s'],
  head: ['-n', '-c'], tail: ['-n', '-c', '-f'], wc: ['-l', '-w', '-c', '-m'],
  rg: ['-n', '-l', '-i', '-F', '--files', '--hidden', '--glob', '-g', '--type', '-t', '--count'],
  grep: ['-n', '-l', '-i', '-r', '-R', '-F', '-E', '-c'],
  find: ['-name', '-iname', '-type', '-maxdepth', '-mindepth', '-print', '-size', '-mtime'],
  git: ['--short', '--porcelain', '--stat', '--oneline', '--all', '--cached', '--staged', '--name-only',
    '--name-status', '-u', '--set-upstream', '--dry-run', '-n', '-m', '-a', '--amend', '--no-edit'],
  swift: ['--package-path', '--scratch-path', '--configuration', '-c', '--filter', '--skip', '--parallel', '--num-workers'],
  npm: ['--silent', '--offline', '--ignore-scripts', '--no-audit', '--no-fund', '--dry-run', '--save-dev', '-D', '--save-exact', '-E'],
  pnpm: ['--silent', '--offline', '--ignore-scripts', '--frozen-lockfile', '--lockfile-only', '--dry-run', '-D', '-E'],
  yarn: ['--silent', '--offline', '--ignore-scripts', '--frozen-lockfile', '-D', '-E'],
  pip: ['--version'], pip3: ['--version'],
  rm: ['-f', '-i', '-v'], mv: ['-f', '-i', '-n', '-v'], cp: ['-f', '-i', '-n', '-v', '-r', '-R', '-p'],
  mkdir: ['-p', '-m', '-v'], touch: ['-a', '-m', '-c', '-r', '-t'], chmod: ['-v'], chown: ['-v'],
  curl: ['--fail', '--silent', '--show-error', '--location', '-f', '-s', '-S', '-L', '-o', '--output', '-I', '--head'],
  wget: ['-q', '--quiet', '-O', '--output-document'],
};
const HIGH_PATTERNS = [
  /\b(?:sudo|doas|mkfs(?:\.[\w-]+)?|dd|launchctl)\b/i,
  /\bDROP\s+(?:TABLE|DATABASE)\b/i,
  /\brm\s+.*(?:--recursive\b|-[a-z]*r[a-z]*\b)/i,
  /\bgit\s+push\b.*(?:--force(?:[-=\s]|$)|-[a-z]*f[a-z]*\b)/i,
  /\bgit\s+reset\b.*--hard\b/i,
  /\bgit\s+clean\b/i,
  /\b(?:chmod|chown)\s+.*(?:--recursive\b|-[a-z]*r[a-z]*\b)/i,
  /\bkill\b.*(?:-9|-KILL|-SIGKILL)\s+1\b/i,
  /(?:^|[/\\])\.(?:ssh|dsh)(?:[/\\\s]|$)/i,
];

/** Resolve existing ancestors too, so a not-yet-created leaf cannot hide a symlink escape. */
function canonical(path: string): string {
  let parent = path;
  const suffix: string[] = [];
  while (true) {
    try { return join(realpathSync.native(parent), ...suffix); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT' || dirname(parent) === parent) throw error;
      // realpath also returns ENOENT for dangling symlinks; never reinterpret
      // those as ordinary missing children of the workspace.
      try { if (lstatSync(parent).isSymbolicLink()) throw Error('Unresolved symbolic link'); }
      catch (statError) { if ((statError as NodeJS.ErrnoException).code !== 'ENOENT') throw statError; }
      suffix.unshift(basename(parent)); parent = dirname(parent);
    }
  }
}
function inside(path: string, workspace: string): boolean {
  if (!path || path.includes('\0') || path.split('/').includes('..') || path.startsWith('~') && !path.startsWith('~/')) return false;
  const lexical = path.startsWith('~/') ? join(homedir(), path.slice(2)) : resolve(workspace, path);
  if (/(?:^|[/\\])\.(?:ssh|dsh)(?:[/\\]|$)/i.test(lexical)) return false;
  const absolute = canonical(lexical);
  const rel = relative(canonical(workspace), absolute);
  const protectedPath = /(?:^|[/\\])\.(?:ssh|dsh)(?:[/\\]|$)/i.test(absolute);
  return !protectedPath && !isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${sep}`);
}

export function canPresetApproval(operation: PresetOperation): boolean {
  try {
    const { tool, command, workspace, args } = operation;
    if (typeof tool !== 'string' || typeof command !== 'string' || !command.trim() ||
      typeof workspace !== 'string' || !isAbsolute(workspace) || workspace.includes('\0')) return false;
    const name = tool.toLowerCase();
    if (FILE_TOOLS.has(name)) {
      let data: any;
      if (args) { try { data = JSON.parse(args); } catch { return false; } }
      const path = data?.path ?? data?.file_path ?? command;
      // Multi-file/patch formats need their own path parser before presets can be offered.
      if (data?.edits || data?.files || data?.patch) return false;
      return typeof path === 'string' && inside(path, workspace);
    }
    if (!SHELL_TOOLS.has(name)) return false;
    if (args) {
      let data: any;
      try { data = JSON.parse(args); } catch { return false; }
      for (const field of ['cwd', 'workdir', 'working_directory', 'workspace']) {
        if (data?.[field] !== undefined && data[field] !== workspace) return false;
      }
    }
    if (HIGH_PATTERNS.some(pattern => pattern.test(command))) return false;
    // No evaluation, chaining, redirection, globbing or quoting: otherwise the displayed
    // command is not enough to determine the actual executable and all target paths.
    if (/[\n\r\0;&|<>$`\\'"(){}*?\[\]!#]/.test(command)) return false;
    const words = command.trim().split(/\s+/);
    const executable = words.shift()!;
    const base = basename(executable);
    if (!COMMANDS.has(base) || executable !== base && !['/bin', '/usr/bin'].includes(dirname(executable))) return false;
    // Avoid alternate cwd, git aliases/config, external diffs and shell-executing find flags.
    if (base === 'git' && (!['status', 'diff', 'log', 'show', 'branch', 'commit', 'push'].includes(words[0]) ||
      words.some(w => /^--(?:exec|ext-diff|textconv|output|git-dir|work-tree)(?:=|$)/.test(w)))) return false;
    if (base === 'git' && words[0] === 'push' && words.some(w => w.startsWith('+'))) return false;
    if (base === 'swift' && !['test', 'build'].includes(words[0])) return false;
    if (['pip', 'pip3'].includes(base) && !['list', 'show', 'check', 'freeze', '--version'].includes(words[0])) return false;
    if (['npm', 'pnpm', 'yarn'].includes(base) && !['test', 'run', 'build', 'install', 'ci', 'add'].includes(words[0])) return false;
    if (base === 'find' && words.some(w => /^-(?:exec|execdir|ok|okdir|delete|fprint|fprintf)/.test(w))) return false;
    if (['npm', 'pnpm', 'yarn'].includes(base) && words.some(w => /^(?:--(?:prefix|cwd|dir)|-C)(?:=|$)/.test(w))) return false;
    // Conservatively constrain path-like arguments even for reads. Plain target names
    // (including names without a slash) are checked for symlink escapes as well.
    return words.every(word => {
      if (word.startsWith('-')) {
        const option = word.split('=')[0];
        if (option !== '--' && !OPTIONS[base]?.includes(option)) return false;
      }
      const value = word.includes('=') ? word.slice(word.indexOf('=') + 1) : word;
      if (/^https?:\/\//.test(value)) return true;
      if (value.startsWith('-')) return !/[/~]|\.\./.test(value);
      return inside(value, workspace);
    });
  } catch { return false; }
}
