// Use Monaco's worker entry directly; customWorkerPath/importScripts cannot run
// in Vite's development module workers.
import { initialize, TypeScriptWorker } from 'monaco-editor/language/typescript/ts.worker';
import { createScriptWorkerClass } from './scriptWorkerAdapter.js';

const ScriptWorker = createScriptWorkerClass(TypeScriptWorker);
self.onmessage = () => initialize((context, data) => new ScriptWorker(context, data));
