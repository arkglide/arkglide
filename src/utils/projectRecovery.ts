import { useEditorStore, type EditorState } from "../store/useEditorStore";
import {
  saveRecovery,
  loadRecovery,
  deleteRecovery,
  type RecoveryRecord,
  type StoredProject,
} from "./projectStorage";
import { collectModelRefs } from "./contentResources";
import { normalizeProject, PROJECT_VERSION } from "./projectValidation";

export function captureEditorProject(state: EditorState): StoredProject {
  return {
    projectId: state.currentProjectId || "",
    name: state.currentProjectName,
    version: PROJECT_VERSION,
    updatedAt: Date.now(),
    scene: {
      nodes:
        state.playState === "stopped"
          ? state.nodes
          : state.prePlaySnapshot || state.nodes,
    },
    scripts: state.scripts,
    activeFileId: state.activeFileId,
    settings: state.settings,
    content: state.content,
    modelRefs: collectModelRefs(state.nodes, state.content),
  };
}
/** Debounced independent drafts; manual project saves remain an explicit operation. */
export function startProjectRecovery(
  options: {
    delay?: number;
    maxWait?: number;
    write?: typeof saveRecovery;
    remove?: typeof deleteRecovery;
  } = {},
) {
  const delay = options.delay ?? 1200,
    maxWait = options.maxWait ?? 10000;
  const write = options.write || saveRecovery,
    remove = options.remove || deleteRecovery;
  const bufferIds = new WeakMap<ArrayBuffer, number>();
  let nextBuffer = 0;
  const clean = new Map<string, string>(),
    stored = new Map<string, string>();
  let lastState = useEditorStore.getState(),
    alive = true,
    chain = Promise.resolve(),
    debounce: ReturnType<typeof setTimeout> | undefined,
    deadline: ReturnType<typeof setTimeout> | undefined;
  function fingerprint(
    project: StoredProject,
    buffers: Map<string, ArrayBuffer>,
    textures: Map<string, ArrayBuffer> = new Map(),
  ) {
    return JSON.stringify([
      project.name,
      project.scene.nodes,
      project.scripts,
      project.activeFileId,
      project.settings,
      project.content,
      (project.content?.textures || []).map((t) => {
        const b = textures.get(t.id);
        if (b && !bufferIds.has(b)) bufferIds.set(b, ++nextBuffer);
        return [t.id, b ? bufferIds.get(b) : null];
      }),
      project.modelRefs.map((ref) => {
        const buffer = buffers.get(ref.assetId);
        if (buffer && !bufferIds.has(buffer))
          bufferIds.set(buffer, ++nextBuffer);
        return [
          ref.assetId,
          ref.fileName,
          buffer ? bufferIds.get(buffer) : null,
        ];
      }),
    ]);
  }
  function capture(state: EditorState) {
    const project = captureEditorProject(state);
    // Snapshot nodes/scripts/settings before any asynchronous DB work; buffers are immutable editor values.
    const record: RecoveryRecord = {
      recoveryId: state.documentId,
      project: structuredClone(project),
      textureBuffers: new Map(state.textureBuffers),
      buffers: new Map(
        project.modelRefs.flatMap((ref) => {
          const b = state.modelBuffers.get(ref.assetId);
          return b ? [[ref.assetId, b] as [string, ArrayBuffer]] : [];
        }),
      ),
      updatedAt: Date.now(),
    };
    return {
      record,
      digest: fingerprint(project, state.modelBuffers, state.textureBuffers),
    };
  }
  function current(id: string) {
    return alive && useEditorStore.getState().documentId === id;
  }
  function cancelTimers() {
    clearTimeout(debounce);
    clearTimeout(deadline);
    debounce = deadline = undefined;
  }
  function enqueue(state: EditorState) {
    const { record, digest } = capture(state),
      id = record.recoveryId;
    if (clean.get(id) === digest || stored.get(id) === digest) return chain;
    chain = chain.then(async () => {
      if (current(id) && capture(useEditorStore.getState()).digest !== digest)
        return;
      if (clean.get(id) === digest) return;
      if (current(id))
        useEditorStore.setState({
          recoveryStatus: "saving",
          recoveryError: null,
        });
      try {
        await write(record);
        stored.set(id, digest);
        if (current(id)) {
          const unchanged =
            capture(useEditorStore.getState()).digest === digest;
          useEditorStore.setState({
            recoveryStatus: unchanged ? "saved" : "pending",
            recoveryUpdatedAt: record.updatedAt,
            recoveryError: null,
          });
        }
      } catch (error) {
        if (current(id)) {
          const message = "自动保存失败: " + String(error);
          useEditorStore.setState({
            recoveryStatus: "error",
            recoveryError: message,
          });
          useEditorStore.getState().addConsoleLog("error", message);
        }
      }
    });
    return chain;
  }
  function flush() {
    cancelTimers();
    return enqueue(useEditorStore.getState());
  }
  function schedule() {
    const s = useEditorStore.getState(),
      digest = capture(s).digest;
    if (clean.get(s.documentId) === digest) {
      cancelTimers();
      const id = s.documentId;
      chain = chain.then(async () => {
        try {
          await remove(id);
          stored.delete(id);
          if (
            current(id) &&
            capture(useEditorStore.getState()).digest === digest
          )
            useEditorStore.setState({
              recoveryStatus: "idle",
              recoveryError: null,
            });
        } catch (error) {
          if (current(id))
            useEditorStore.setState({
              recoveryStatus: "error",
              recoveryError: String(error),
            });
        }
      });
      return;
    }
    if (stored.get(s.documentId) === digest) {
      cancelTimers();
      useEditorStore.setState({ recoveryStatus: "saved" });
      return;
    }
    useEditorStore.setState({ recoveryStatus: "pending" });
    clearTimeout(debounce);
    debounce = setTimeout(flush, delay);
    deadline ??= setTimeout(flush, maxWait);
  }
  function baseline(state: EditorState) {
    if (state.documentOrigin === "new" || state.documentOrigin === "loaded")
      clean.set(state.documentId, capture(state).digest);
    else schedule();
  }
  baseline(lastState);
  const unsubscribe = useEditorStore.subscribe((state) => {
    const previous = lastState;
    lastState = state;
    if (state.documentId !== previous.documentId) {
      cancelTimers();
      void enqueue(previous);
      baseline(state);
      return;
    }
    if (state.savedSnapshot !== previous.savedSnapshot && state.savedSnapshot) {
      const digest = fingerprint(
          state.savedSnapshot.project,
          state.savedSnapshot.buffers,
          state.savedSnapshot.textures,
        ),
        id = state.documentId;
      clean.set(id, digest);
      chain = chain.then(async () => {
        try {
          await remove(id);
          stored.delete(id);
          if (
            current(id) &&
            capture(useEditorStore.getState()).digest === digest
          )
            useEditorStore.setState({
              recoveryStatus: "idle",
              recoveryError: null,
            });
        } catch (error) {
          if (current(id))
            useEditorStore.setState({
              recoveryStatus: "error",
              recoveryError: "恢复记录清理失败: " + String(error),
            });
        }
      });
      schedule();
      return;
    }
    if (
      state.content !== previous.content ||
      state.textureBuffers !== previous.textureBuffers ||
      state.nodes !== previous.nodes ||
      state.scripts !== previous.scripts ||
      state.settings !== previous.settings ||
      state.modelBuffers !== previous.modelBuffers ||
      state.currentProjectName !== previous.currentProjectName ||
      state.activeFileId !== previous.activeFileId ||
      state.playState !== previous.playState
    )
      schedule();
  });
  const leave = (event: BeforeUnloadEvent) => {
    const s = useEditorStore.getState(),
      digest = capture(s).digest;
    if (
      clean.get(s.documentId) !== digest &&
      stored.get(s.documentId) !== digest
    ) {
      void flush();
      event.preventDefault();
      event.returnValue = "";
    }
  };
  const hide = () => {
    if (document.visibilityState === "hidden") void flush();
  };
  if (typeof window !== "undefined") {
    window.addEventListener("beforeunload", leave);
    window.addEventListener("pagehide", flush);
    window.addEventListener("blur", flush);
    document.addEventListener("visibilitychange", hide);
  }
  return {
    flush,
    dispose() {
      alive = false;
      cancelTimers();
      unsubscribe();
      if (typeof window !== "undefined") {
        window.removeEventListener("beforeunload", leave);
        window.removeEventListener("pagehide", flush);
        window.removeEventListener("blur", flush);
        document.removeEventListener("visibilitychange", hide);
      }
    },
  };
}

export async function restoreRecovery(id: string): Promise<void> {
  const documentId = useEditorStore.getState().documentId;
  const record = await loadRecovery(id);
  if (useEditorStore.getState().documentId !== documentId)
    throw new Error("当前项目已切换，请重新选择恢复记录");
  if (!record) throw new Error("恢复记录不存在");
  const project = normalizeProject(record.project);
  if (!(record.buffers instanceof Map)) throw new Error("恢复记录资源损坏");
  const buffers = new Map<string, ArrayBuffer>(),
    missing = new Set<string>();
  for (const ref of project.modelRefs) {
    const b = record.buffers.get(ref.assetId);
    if (b instanceof ArrayBuffer) buffers.set(ref.assetId, b);
    else missing.add(ref.assetId);
  }
  const textures = new Map<string, ArrayBuffer>();
  if (
    record.textureBuffers !== undefined &&
    !(record.textureBuffers instanceof Map)
  )
    throw new Error("恢复记录贴图损坏");
  for (const t of project.content?.textures || []) {
    const b = record.textureBuffers?.get(t.id);
    if (b instanceof ArrayBuffer) textures.set(t.id, b);
  }
  // Validate everything first; keep the draft until explicitly discarded or manually saved.
  useEditorStore
    .getState()
    .replaceProject(
      project,
      buffers,
      missing,
      !project.projectId,
      record.recoveryId,
      textures,
    );
  useEditorStore.setState({
    recoveryStatus: "saved",
    recoveryUpdatedAt: record.updatedAt,
  });
  useEditorStore
    .getState()
    .addConsoleLog("log", "已恢复自动保存: " + project.name);
}
