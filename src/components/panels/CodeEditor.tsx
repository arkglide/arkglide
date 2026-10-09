import { useEffect, useRef } from 'react';
import Editor, { loader } from '@monaco-editor/react';
import * as monaco from 'monaco-editor';
// Vite 原生 ?worker import：本地打包 Monaco worker（离线可用）
import editorWorker from 'monaco-editor/editor/editor.worker?worker';
import jsonWorker from 'monaco-editor/language/json/json.worker?worker';
import cssWorker from 'monaco-editor/language/css/css.worker?worker';
import htmlWorker from 'monaco-editor/language/html/html.worker?worker';
import tsWorker from '../../editor/script.worker?worker';
// 以 raw 字符串读取 arkglide.d.ts，注入 Monaco language service
import dtsContent from '../../types/arkglide.d.ts?raw';
import { Box, Tabs, Tab, IconButton } from '@mui/material';
import { Close } from '@mui/icons-material';
import { useEditorStore } from '../../store/useEditorStore';

// 配置 Monaco worker
(self as any).MonacoEnvironment = {
  getWorker(_: string, label: string) {
    if (label === 'json') return new jsonWorker();
    if (label === 'css' || label === 'scss' || label === 'less') return new cssWorker();
    if (label === 'html' || label === 'handlebars' || label === 'razor') return new htmlWorker();
    if (label === 'typescript' || label === 'javascript') return new tsWorker();
    return new editorWorker();
  },
};

// 使用本地 monaco 实例（非 CDN）
loader.config({ monaco });

// JS factories and TS files share the same API declarations and compiler settings.
for (const defaults of [monaco.typescript.javascriptDefaults, monaco.typescript.typescriptDefaults]) {
  defaults.addExtraLib(dtsContent, 'file:///arkglide/api.d.ts');
  defaults.setCompilerOptions({
    target: monaco.typescript.ScriptTarget.ES2020,
    allowJs: true,
    checkJs: true,
    strictNullChecks: true,
    noImplicitThis: true,
    allowNonTsExtensions: true,
  });
  defaults.setDiagnosticsOptions({ noSemanticValidation: false, noSyntaxValidation: false });
  defaults.setEagerModelSync(true);
}

// 根据文件名后缀推断 Monaco language id
function inferLanguage(fileName: string): string {
  if (fileName.endsWith('.ts')) return 'typescript';
  if (fileName.endsWith('.json')) return 'json';
  if (fileName.endsWith('.css')) return 'css';
  if (fileName.endsWith('.html')) return 'html';
  return 'javascript';
}

// Monaco 多 Tab 代码编辑器
// - Tab 栏：MUI Tabs，每个 Tab 对应 scripts 中的一个文件
// - Monaco model 按文件创建：切换 Tab 时用 editor.setModel() 高效切换，不重建编辑器实例
// - Tab 关闭按钮：main.js 不可关闭
// - 内容变更同步 updateScript(activeFileId, value)
// - 新建脚本自动切换到新文件；删除活跃文件后跟随 store 切回 main.js
export default function CodeEditor() {
  const scripts = useEditorStore((s) => s.scripts);
  const activeFileId = useEditorStore((s) => s.activeFileId);
  const updateScript = useEditorStore((s) => s.updateScript);
  const setActiveFile = useEditorStore((s) => s.setActiveFile);
  const playState = useEditorStore(s => s.playState);
  const renameScript = useEditorStore(s => s.renameScript);
  const deleteScript = useEditorStore((s) => s.deleteScript);

  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const modelMapRef = useRef(new Map<string, monaco.editor.ITextModel>());
  const listenersRef = useRef(new Map<string, monaco.IDisposable>());
  const viewStatesRef = useRef(new Map<string, monaco.editor.ICodeEditorViewState>());
  const syncingRef = useRef(false);
  const modelRootRef = useRef(`file:///arkglide/scripts/${crypto.randomUUID()}/`);
  const fileNames = Object.keys(scripts);

  function syncModels() {
    const editor = editorRef.current;
    if (!editor) return;
    const state = useEditorStore.getState();
    const models = modelMapRef.current;
    syncingRef.current = true;
    try {
      for (const [name, model] of models) {
        if (!(name in state.scripts)) {
          if (editor.getModel() === model) editor.setModel(null);
          listenersRef.current.get(name)?.dispose();
          listenersRef.current.delete(name);
          model.dispose();
          models.delete(name);
          viewStatesRef.current.delete(name);
        }
      }
      for (const [name, content] of Object.entries(state.scripts)) {
        let model = models.get(name);
        if (!model) {
          model = monaco.editor.createModel(content, inferLanguage(name),
            monaco.Uri.parse(modelRootRef.current + encodeURIComponent(name)));
          models.set(name, model);
          const ownedModel = model;
          listenersRef.current.set(name, model.onDidChangeContent(() => {
            if (!syncingRef.current) {
              // Use the changed model's filename, never the currently selected tab.
              useEditorStore.getState().updateScript(name, ownedModel.getValue());
            }
          }));
        } else if (model.getValue() !== content) {
          // Project load/import/new and history restoration must reach Monaco too.
          model.setValue(content);
        }
      }
      const nextModel = models.get(state.activeFileId) || null;
      if (editor.getModel() !== nextModel) {
        const previous = editor.getModel();
        const name = [...models].find(([, model]) => model === previous)?.[0];
        const view = editor.saveViewState();
        if (name && view) viewStatesRef.current.set(name, view);
        editor.setModel(nextModel);
        const nextView = viewStatesRef.current.get(state.activeFileId);
        if (nextView) editor.restoreViewState(nextView);
      }
    } finally {
      syncingRef.current = false;
    }
  }

  useEffect(() => { syncModels(); }, [scripts, activeFileId]);
  useEffect(() => () => {
    editorRef.current?.setModel(null);
    for (const listener of listenersRef.current.values()) listener.dispose();
    for (const model of modelMapRef.current.values()) model.dispose();
    listenersRef.current.clear();
    modelMapRef.current.clear();
    viewStatesRef.current.clear();
    editorRef.current = null;
  }, []);

  return (
    <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <Tabs
        value={activeFileId}
        onChange={(_, v) => setActiveFile(String(v))}
        sx={{
          minHeight: 36,
          maxHeight: 36,
          backgroundColor: '#1E1E1E',
          borderBottom: '1px solid #333',
        }}
      >
        {fileNames.map((name) => (
          <Tab
            key={name}
            value={name}
            label={name}
            onDoubleClick={() => {
              if (name === 'main.js' || playState !== 'stopped') return;
              const next = window.prompt('脚本文件名',name)?.trim();
              if (next) renameScript(name,next.endsWith('.js') ? next : next+'.js');
            }}
            icon={
              // main.js 不可关闭，不渲染关闭按钮
              name !== 'main.js' ? (
                <IconButton
                  size="small"
                  disabled={playState !== 'stopped'}
                  // 阻止冒泡到 Tab onChange，仅触发 deleteScript
                  onClick={(e) => {
                    e.stopPropagation();
                    deleteScript(name);
                  }}
                  sx={{ p: 0.25 }}
                >
                  <Close sx={{ fontSize: 14 }} />
                </IconButton>
              ) : undefined
            }
            iconPosition="end"
            sx={{ minHeight: 36, textTransform: 'none' }}
          />
        ))}
      </Tabs>
      <Box sx={{ flex: 1, overflow: 'hidden', position: 'relative' }}>
        <Editor
          height="100%"
          theme="vs-dark"
          keepCurrentModel
          onMount={(editor) => {
            editorRef.current = editor;
            const defaultModel = editor.getModel();
            syncModels();
            if (defaultModel && defaultModel !== editor.getModel()) defaultModel.dispose();
            editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
              const currentModel = editor.getModel();
              const entry = [...modelMapRef.current].find(([, model]) => model === currentModel);
              if (entry && currentModel && useEditorStore.getState().scripts[entry[0]] !== currentModel.getValue()) {
                updateScript(entry[0], currentModel.getValue());
              }
            });
          }}
          options={{
            readOnly: playState !== 'stopped',
            fontSize: 13,
            lineHeight: 18,
            minimap: { enabled: false },
            scrollBeyondLastLine: false,
            tabSize: 2,
            formatOnPaste: true,
            automaticLayout: true,
            lineNumbers: 'on',
            folding: true,
          }}
        />
      </Box>
    </Box>
  );
}