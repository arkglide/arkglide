import "../vendor/acorn.js";
import "../engine/module-runtime.js";

// Monaco sees a function body, just like the runtime's new Function factory.
// The wrapper exists only in the language worker; saved source stays untouched.
export function scriptPrefix(fileName) {
  if (!fileName.startsWith("file:///arkglide/scripts/")) return "";
  if (fileName.endsWith(".js")) {
    return "export {};\n/** @this {ScriptThis}\n * @param {Entity} entity\n * @param {InputAPI} input\n * @param {SceneAPI} scene\n * @param {TimeAPI} time\n * @param {MathAPI} math\n * @param {EventsAPI} events\n * @param {TimersAPI} timers\n * @param {PrefabsAPI} prefabs\n * @param {PhysicsAPI} physics\n * @param {AudioAPI} audio\n * @param {UIAPI} ui\n * @param {AnimationAPI} animation\n * @param {CamerasAPI} cameras\n * @param {PortalsAPI} portals\n * @param {InteractionAPI} interaction\n * @param {VisualsAPI} visuals\n * @param {SurfacesAPI} surfaces\n * @param {FieldsAPI} fields\n * @param {LevelsAPI} levels\n * @param {StorageAPI} storage\n * @param {SavesAPI} saves\n * @param {TriggersAPI} triggers\n * @param {SignalsAPI} signals\n * @param {MotionAPI} motion\n * @param {OpticsAPI} optics\n * @param {AssetsAPI} assets\n * @param {RenderingAPI} rendering\n * @returns {ScriptLifecycle | void}\n */\nfunction __arkglideFactory(entity, input, scene, time, math, events, timers, prefabs, physics, audio, ui, animation, cameras, portals, interaction, visuals, surfaces, fields, levels, storage, saves, triggers, signals, motion, optics, assets, rendering) {\n";
  }
  if (fileName.endsWith(".ts")) {
    return "export {};\nfunction __arkglideFactory(this: ScriptThis, entity: Entity, input: InputAPI, scene: SceneAPI, time: TimeAPI, math: MathAPI, events: EventsAPI, timers: TimersAPI, prefabs: PrefabsAPI, physics: PhysicsAPI, audio: AudioAPI, ui: UIAPI, animation: AnimationAPI, cameras: CamerasAPI, portals: PortalsAPI, interaction: InteractionAPI, visuals: VisualsAPI, surfaces: SurfacesAPI, fields: FieldsAPI, levels: LevelsAPI, storage: StorageAPI, saves: SavesAPI, triggers: TriggersAPI, signals: SignalsAPI, motion: MotionAPI, optics: OpticsAPI, assets: AssetsAPI, rendering: RenderingAPI): ScriptLifecycle | void {\n";
  }
  return "";
}

function layout(file, text = "") {
  const base = scriptPrefix(file);
  if (!base || !file.endsWith(".js"))
    return { prefix: base, body: text, suffix: base ? "\n}" : "", imports: [] };
  const info = globalThis.ArkGlideModules.languageInfo(text);
  if (info.hasExports)
    return { prefix: "", body: text, suffix: "", imports: [] };
  let prefix = "";
  const imports = info.imports.map((node) => {
    const segment = { start: node.start, end: node.end, target: prefix.length };
    prefix += text.slice(node.start, node.end) + ";\n";
    return segment;
  });
  prefix += base;
  let body = text;
  for (const node of [...info.imports].reverse())
    body =
      body.slice(0, node.start) +
      globalThis.ArkGlideModules.blank(body.slice(node.start, node.end)) +
      body.slice(node.end);
  return { prefix, body, suffix: "\n}", imports };
}
function toWorker(position, view) {
  const segment = view.imports.find(
    (n) => position >= n.start && position < n.end,
  );
  return segment
    ? segment.target + position - segment.start
    : view.prefix.length + position;
}
function toSource(position, view) {
  const segment = view.imports.find(
    (n) => position >= n.target && position < n.target + n.end - n.start,
  );
  return segment
    ? segment.start + position - segment.target
    : position >= view.prefix.length
      ? position - view.prefix.length
      : null;
}

const positionArguments = {
  getCompletionsAtPosition: [1],
  getCompletionEntryDetails: [1],
  getSignatureHelpItems: [1],
  getQuickInfoAtPosition: [1],
  getDocumentHighlights: [1],
  getDefinitionAtPosition: [1],
  getReferencesAtPosition: [1],
  findRenameLocations: [1],
  getRenameInfo: [1],
  getFormattingEditsForRange: [1, 2],
  getFormattingEditsAfterKeystroke: [1],
  getCodeFixesAtPosition: [1, 2],
};

// Map all TS text spans back to editor offsets, including replacement spans,
// diagnostics, definitions in other scripts and nested code-action edits.
function mapResult(value, fileName, sourceLength, getLayout) {
  if (Array.isArray(value)) {
    return value
      .map((item) => mapResult(item, fileName, sourceLength, getLayout))
      .filter((item) => item !== null);
  }
  if (!value || typeof value !== "object") return value;
  const file = value.fileName || value.file?.fileName || fileName;
  const view = getLayout(file);
  const shift = view.prefix.length;
  const result = {};
  if (shift && typeof value.start === "number") {
    const mappedStart =
      toSource(value.start, view) ??
      (value.start + (value.length || 0) > shift ? 0 : null);
    if (mappedStart === null || mappedStart > sourceLength(file)) return null;
    result.start = mappedStart;
    if (typeof value.length === "number")
      result.length = Math.min(value.length, sourceLength(file) - mappedStart);
  }
  for (const [key, item] of Object.entries(value)) {
    if (key in result) continue;
    if (key === "file" && item) {
      result[key] = { fileName: item.fileName };
    } else if (key === "position" && typeof item === "number" && shift) {
      result[key] = toSource(item, view) ?? 0;
    } else {
      result[key] = mapResult(item, file, sourceLength, getLayout);
      // A definition/edit targeting an injected parameter is outside saved
      // source. Drop its whole entry rather than handing Monaco a null span.
      if (
        result[key] === null &&
        ["textSpan", "span", "triggerSpan"].includes(key)
      )
        return null;
    }
  }
  return result;
}

export function createScriptWorkerClass(BaseWorker) {
  return class ScriptWorker extends BaseWorker {
    constructor(...args) {
      super(...args);
      this._scriptLayouts = new Map();
      const originalText = (file) => super._getScriptText(file);
      const sourceLength = (file) => (originalText(file) || "").length;
      const getLayout = (file) =>
        this._scriptLayout(file, originalText(file) || "");
      const service = this._languageService;
      const worker = this;
      this._languageService = new Proxy(service, {
        get(target, method) {
          const fn = target[method];
          if (typeof fn !== "function") return fn;
          return (...params) => {
            // Formatting must see the original source: a hidden function body
            // would otherwise add one indentation level on every format/paste.
            if (String(method).startsWith("getFormattingEdits")) {
              worker._formattingRaw = true;
              try {
                return fn.apply(target, params);
              } finally {
                worker._formattingRaw = false;
              }
            }
            const file = typeof params[0] === "string" ? params[0] : "";
            const view = getLayout(file);
            const shift = view.prefix.length;
            for (const index of positionArguments[method] || []) {
              if (shift) params[index] = toWorker(params[index], view);
            }
            if (method === "provideInlayHints" && shift) {
              params[1] = { ...params[1], start: params[1].start + shift };
            }
            const result = fn.apply(target, params);
            // Program/source-file objects contain cycles and aren't UI results.
            if (!file) return result;
            const mapped = mapResult(result, file, sourceLength, getLayout);
            if (method === "getCompletionsAtPosition" && mapped) {
              mapped.entries = mapped.entries.filter(
                (entry) => entry.name !== "__arkglideFactory",
              );
            }
            if (method === "getNavigationTree" && shift) {
              const factory = mapped?.childItems?.find(
                (item) => item.text === "__arkglideFactory",
              );
              if (factory) mapped.childItems = factory.childItems || [];
            }
            return mapped;
          };
        },
      });
    }

    _getScriptText(fileName) {
      const text = super._getScriptText(fileName);
      if (text === undefined || this._formattingRaw) return text;
      const view = this._scriptLayout(fileName, text);
      return view.prefix + view.body + view.suffix;
    }

    _scriptLayout(file, text) {
      const cached = this._scriptLayouts?.get(file);
      if (cached?.text === text) return cached.view;
      const view = layout(file, text);
      this._scriptLayouts?.set(file, { text, view });
      return view;
    }

    getScriptVersion(fileName) {
      return (
        super.getScriptVersion(fileName) +
        (this._formattingRaw ? ":format" : ":script")
      );
    }
  };
}
