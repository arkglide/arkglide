// Monaco sees a function body, just like the runtime's new Function factory.
// The wrapper exists only in the language worker; saved source stays untouched.
export function scriptPrefix(fileName) {
  if (!fileName.startsWith('file:///arkglide/scripts/')) return '';
  if (fileName.endsWith('.js')) {
    return 'export {};\n/** @this {ScriptThis}\n * @param {Entity} entity\n * @param {InputAPI} input\n * @param {SceneAPI} scene\n * @param {TimeAPI} time\n * @returns {ScriptLifecycle | void}\n */\nfunction __arkglideFactory(entity, input, scene, time) {\n';
  }
  if (fileName.endsWith('.ts')) {
    return 'export {};\nfunction __arkglideFactory(this: ScriptThis, entity: Entity, input: InputAPI, scene: SceneAPI, time: TimeAPI): ScriptLifecycle | void {\n';
  }
  return '';
}

const positionArguments = {
  getCompletionsAtPosition: [1], getCompletionEntryDetails: [1],
  getSignatureHelpItems: [1], getQuickInfoAtPosition: [1],
  getDocumentHighlights: [1], getDefinitionAtPosition: [1],
  getReferencesAtPosition: [1], findRenameLocations: [1], getRenameInfo: [1],
  getFormattingEditsForRange: [1, 2], getFormattingEditsAfterKeystroke: [1],
  getCodeFixesAtPosition: [1, 2],
};

// Map all TS text spans back to editor offsets, including replacement spans,
// diagnostics, definitions in other scripts and nested code-action edits.
function mapResult(value, fileName, sourceLength) {
  if (Array.isArray(value)) {
    return value.map(item => mapResult(item, fileName, sourceLength)).filter(item => item !== null);
  }
  if (!value || typeof value !== 'object') return value;
  const file = value.fileName || value.file?.fileName || fileName;
  const shift = scriptPrefix(file).length;
  const result = {};
  if (shift && typeof value.start === 'number') {
    const end = value.start + (value.length || 0);
    const limit = shift + sourceLength(file);
    if (end < shift || value.start > limit) return null;
    result.start = Math.max(0, value.start - shift);
    if (typeof value.length === 'number') result.length = Math.max(0, Math.min(end, limit) - Math.max(value.start, shift));
  }
  for (const [key, item] of Object.entries(value)) {
    if (key in result) continue;
    if (key === 'file' && item) {
      result[key] = { fileName: item.fileName };
    } else if (key === 'position' && typeof item === 'number' && shift) {
      result[key] = Math.max(0, item - shift);
    } else {
      result[key] = mapResult(item, file, sourceLength);
      // A definition/edit targeting an injected parameter is outside saved
      // source. Drop its whole entry rather than handing Monaco a null span.
      if (result[key] === null && ['textSpan', 'span', 'triggerSpan'].includes(key)) return null;
    }
  }
  return result;
}

export function createScriptWorkerClass(BaseWorker) {
  return class ScriptWorker extends BaseWorker {
    constructor(...args) {
      super(...args);
      const originalText = file => super._getScriptText(file);
      const sourceLength = file => (originalText(file) || '').length;
      const service = this._languageService;
      const worker = this;
      this._languageService = new Proxy(service, {
        get(target, method) {
          const fn = target[method];
          if (typeof fn !== 'function') return fn;
          return (...params) => {
            // Formatting must see the original source: a hidden function body
            // would otherwise add one indentation level on every format/paste.
            if (String(method).startsWith('getFormattingEdits')) {
              worker._formattingRaw = true;
              try { return fn.apply(target, params); }
              finally { worker._formattingRaw = false; }
            }
            const file = typeof params[0] === 'string' ? params[0] : '';
            const shift = scriptPrefix(file).length;
            for (const index of positionArguments[method] || []) {
              if (shift) params[index] += shift;
            }
            if (method === 'provideInlayHints' && shift) {
              params[1] = { ...params[1], start: params[1].start + shift };
            }
            const result = fn.apply(target, params);
            // Program/source-file objects contain cycles and aren't UI results.
            if (!file || !shift) return result;
            const mapped = mapResult(result, file, sourceLength);
            if (method === 'getCompletionsAtPosition' && mapped) {
              mapped.entries = mapped.entries.filter(entry => entry.name !== '__arkglideFactory');
            }
            if (method === 'getNavigationTree') {
              const factory = mapped?.childItems?.find(item => item.text === '__arkglideFactory');
              if (factory) mapped.childItems = factory.childItems || [];
            }
            return mapped;
          };
        },
      });
    }

    _getScriptText(fileName) {
      const text = super._getScriptText(fileName);
      const prefix = scriptPrefix(fileName);
      return text === undefined || !prefix || this._formattingRaw ? text : prefix + text + '\n}';
    }

    getScriptVersion(fileName) {
      return super.getScriptVersion(fileName) + (this._formattingRaw ? ':format' : ':script');
    }
  };
}
