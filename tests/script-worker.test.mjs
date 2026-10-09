import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { TypeScriptWorker } from 'monaco-editor/languages/features/typescript/tsWorker.js';
import { createScriptWorkerClass } from '../src/editor/scriptWorkerAdapter.js';

const Worker = createScriptWorkerClass(TypeScriptWorker);
const declarations = fs.readFileSync(new URL('../src/types/arkglide.d.ts', import.meta.url), 'utf8');
function setup(sources) {
  const files = Object.fromEntries(Object.entries(sources).map(([name, code]) => ['file:///arkglide/scripts/test/' + name, code]));
  const worker = new Worker({ getMirrorModels: () => Object.entries(files).map(([file, code]) => ({
    uri: { path: new URL(file).pathname, toString: () => file }, version: 1, getValue: () => code,
  })) }, {
    compilerOptions: { target: 7, allowJs: true, checkJs: true, strictNullChecks: true, noImplicitThis: true },
    extraLibs: { 'file:///arkglide/api.d.ts': { content: declarations, version: 1 } },
  });
  const file = name => 'file:///arkglide/scripts/test/' + name;
  return { worker, file };
}
async function diagnostics(worker, file) {
  return [...await worker.getSyntacticDiagnostics(file), ...await worker.getSemanticDiagnostics(file)];
}

test('default return lifecycle has typed entity, globals and no top-level-return error', async () => {
  const store = fs.readFileSync(new URL('../src/store/useEditorStore.ts', import.meta.url), 'utf8');
  const array = store.slice(store.indexOf('export const DEFAULT_SCRIPT = [') + 'export const DEFAULT_SCRIPT = '.length, store.indexOf("].join('\\n');") + 1);
  const code = Function('return ' + array)().join('\n');
  const { worker, file } = setup({ 'main.js': code });
  assert.deepEqual(await diagnostics(worker, file('main.js')), []);
  const offset = code.indexOf('this.entity.translate') + 'this.entity.'.length;
  const completions = await worker.getCompletionsAtPosition(file('main.js'), offset);
  for (const name of ['position', 'transform', 'rotation', 'scale', 'name', 'translate', 'rotate']) {
    assert.ok(completions.entries.some(entry => entry.name === name), name);
  }
  assert.ok(!completions.entries.some(entry => entry.name === '_mesh'));
  const hover = await worker.getQuickInfoAtPosition(file('main.js'), code.indexOf('this.entity.translate') + 12);
  assert.equal(code.slice(hover.textSpan.start, hover.textSpan.start + hover.textSpan.length), 'translate');
  const signature = await worker.getSignatureHelpItems(file('main.js'), code.indexOf('input.getAxis(') + 'input.getAxis('.length);
  assert.equal(signature.items[0].parameters[0].name, 'negativeKey');
});

test('hidden factory declarations do not become invalid definition targets or completions', async () => {
  const code = 'entity.translate(1, 0, 0); return {};';
  const { worker, file } = setup({ 'definitions.js': code });
  const definitions = await worker.getDefinitionAtPosition(file('definitions.js'), 2);
  assert.deepEqual(definitions, []);
  const completions = await worker.getCompletionsAtPosition(file('definitions.js'), 0);
  assert.ok(!completions.entries.some(entry => entry.name === '__arkglideFactory'));
});

test('separate factories can reuse names; this works at top level and in arrows', async () => {
  const code = 'const speed = 3; const owner = this.entity; return { onUpdate: () => owner.translate(speed, 0, 0) };';
  const { worker, file } = setup({ 'a.js': code, 'b.js': code, 'empty.js': '' });
  for (const name of ['a.js', 'b.js', 'empty.js']) assert.deepEqual(await diagnostics(worker, file(name)), []);
});

test('diagnostics and rename spans refer to the saved source, including Unicode', async () => {
  const code = '// 测试坐标\nconst speed = 3;\nreturn { onUpdate() { this.entity.missing(); this.entity.setPosition("x", 0, 0); console.log(speed); } };';
  const { worker, file } = setup({ 'bad.js': code });
  const result = await diagnostics(worker, file('bad.js'));
  const missing = result.find(item => item.code === 2339);
  assert.ok(missing);
  assert.equal(code.slice(missing.start, missing.start + missing.length), 'missing');
  assert.ok(result.some(item => [2345, 2769].includes(item.code)));
  const refs = await worker.findRenameLocations(file('bad.js'), code.indexOf('speed'), false, false, false);
  assert.equal(refs.length, 2);
  for (const ref of refs) assert.equal(code.slice(ref.textSpan.start, ref.textSpan.start + ref.textSpan.length), 'speed');
});

test('defineScript infers per-instance state, and TS service gets the API too', async () => {
  const code = 'return defineScript({ speed: 3, onUpdate() { this.entity.translate(this.speed * time.deltaTime, 0, 0); } });';
  const { worker, file } = setup({ 'custom.js': code, 'typed.ts': 'const speed: number = 3; ' + code });
  for (const name of ['custom.js', 'typed.ts']) assert.deepEqual(await diagnostics(worker, file(name)), []);
  const hover = await worker.getQuickInfoAtPosition(file('custom.js'), code.indexOf('this.speed') + 5);
  assert.match(hover.displayParts.map(part => part.text).join(''), /speed: number/);
});

test('formatting is stable and does not add hidden-wrapper indentation', async () => {
  const code = 'return {\n  onStart() {\n    console.log(this.entity.name);\n  }\n};';
  const { worker, file } = setup({ 'format.js': code });
  const options = { tabSize: 2, indentSize: 2, convertTabsToSpaces: true, newLineCharacter: '\n' };
  const edits = await worker.getFormattingEditsForDocument(file('format.js'), options);
  assert.deepEqual(edits, []);
  assert.deepEqual(await diagnostics(worker, file('format.js')), []);
  const completions = await worker.getCompletionsAtPosition(file('format.js'), code.indexOf('entity.name') + 7);
  assert.ok(completions.entries.some(entry => entry.name === 'position'));
});
