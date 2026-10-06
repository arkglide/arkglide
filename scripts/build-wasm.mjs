#!/usr/bin/env node
/**
 * Build cpp/math into src/wasm/arkglide_math.js via pinned emsdk.
 * Needs Node 20+, git, Python 3.
 * Toolchain cache: $EMSDK_DIR or ~/.cache/arkglide-emsdk
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const EMSDK_VERSION = '6.0.11';
const EMSDK_REPO = 'https://github.com/emscripten-core/emsdk.git';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const emsdkDir = process.env.EMSDK_DIR
  ? path.resolve(process.env.EMSDK_DIR)
  : path.join(os.homedir(), '.cache', 'arkglide-emsdk');
const outDir = path.join(root, 'src', 'wasm');
const outJs = path.join(outDir, 'arkglide_math.js');
const isWin = process.platform === 'win32';

const sources = [
  'cpp/math/vector3.cpp',
  'cpp/math/matrix4.cpp',
  'cpp/math/quaternion.cpp',
];

const emFlags = [
  '-lembind',
  '-O3',
  '-s', 'MODULARIZE=1',
  '-s', 'EXPORT_ES6=1',
  '-s', 'ENVIRONMENT=web',
  '-s', 'ALLOW_MEMORY_GROWTH=1',
  '-s', 'EXPORT_NAME=createArkGlideMath',
  '-s', 'SINGLE_FILE=1',
];

function fail(message, code = 1) {
  console.error(message);
  process.exit(code);
}

function run(command, args, opts = {}) {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    stdio: 'inherit',
    ...opts,
  });
  if (result.error) {
    fail(`无法执行 ${command}: ${result.error.message}`);
  }
  return result.status ?? 1;
}

function haveCommand(command, args = ['--version']) {
  const result = spawnSync(command, args, { encoding: 'utf8', stdio: 'pipe' });
  return !result.error && result.status === 0;
}

function findPython() {
  const candidates = isWin ? ['py', 'python', 'python3'] : ['python3', 'python'];
  for (const cmd of candidates) {
    const args = cmd === 'py' ? ['-3', '--version'] : ['--version'];
    if (haveCommand(cmd, args)) return cmd === 'py' ? ['py', '-3'] : [cmd];
  }
  return null;
}

function emsdkExe() {
  return path.join(emsdkDir, isWin ? 'emsdk.bat' : 'emsdk');
}

function runEmsdk(args) {
  const exe = emsdkExe();
  if (isWin) {
    return run('cmd.exe', ['/d', '/s', '/c', `"${exe}" ${args.map(quote).join(' ')}`], {
      cwd: emsdkDir,
      windowsVerbatimArguments: true,
    });
  }
  return run(exe, args, { cwd: emsdkDir });
}

function quote(value) {
  if (!/[ \t"]/.test(value)) return value;
  return `"${value.replaceAll('"', '\\"')}"`;
}

function runWithEmsdkEnv(commandLine) {
  if (isWin) {
    const envBat = path.join(emsdkDir, 'emsdk_env.bat');
    return run(
      'cmd.exe',
      ['/d', '/s', '/c', `call "${envBat}" && ${commandLine}`],
      { cwd: root, windowsVerbatimArguments: true },
    );
  }
  const envSh = path.join(emsdkDir, 'emsdk_env.sh');
  return run('bash', ['-c', `source "${envSh}" >/dev/null && ${commandLine}`], {
    cwd: root,
  });
}

console.log(`ArkGlide WASM build`);
console.log(`  root     ${root}`);
console.log(`  emsdk    ${emsdkDir}  (pin ${EMSDK_VERSION})`);
console.log(`  output   ${outJs}`);

if (!haveCommand('git')) {
  fail('未找到 git。WASM 工具链需要 git 来获取 emsdk。');
}

const python = findPython();
if (!python) {
  fail('未找到 Python 3。emsdk 依赖 Python 3，请安装后重试。');
}

if (!existsSync(emsdkExe())) {
  console.log(`\n[1/3] clone emsdk ${EMSDK_VERSION} → ${emsdkDir}`);
  mkdirSync(path.dirname(emsdkDir), { recursive: true });
  if (existsSync(emsdkDir)) {
    fail(`${emsdkDir} 已存在但不是可用的 emsdk 目录，请删掉后重试，或设置 EMSDK_DIR。`);
  }
  const cloneStatus = run('git', [
    'clone',
    '--depth',
    '1',
    EMSDK_REPO,
    emsdkDir,
  ]);
  if (cloneStatus !== 0) fail('git clone emsdk 失败');
} else {
  console.log(`\n[1/3] 复用 ${emsdkDir}`);
}

console.log(`\n[2/3] emsdk install/activate ${EMSDK_VERSION}`);
if (runEmsdk(['install', EMSDK_VERSION]) !== 0) fail('emsdk install 失败');
if (runEmsdk(['activate', EMSDK_VERSION]) !== 0) fail('emsdk activate 失败');

mkdirSync(outDir, { recursive: true });

const emCommand = [
  'em++',
  ...sources.map(quote),
  '-o',
  quote(path.relative(root, outJs)),
  ...emFlags.map(quote),
].join(' ');

console.log(`\n[3/3] ${emCommand}`);
if (runWithEmsdkEnv(emCommand) !== 0) {
  fail('em++ 编译失败');
}

console.log(`\n完成: ${outJs}`);
