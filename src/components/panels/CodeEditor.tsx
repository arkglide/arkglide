import { useEffect, useRef } from 'react';
import Editor, { loader } from '@monaco-editor/react';
import * as monaco from 'monaco-editor';
// Vite 原生 ?worker import：本地打包 Monaco worker（离线可用）
import editorWorker from 'monaco-editor/editor/editor.worker?worker';
import jsonWorker from 'monaco-editor/language/json/json.worker?worker';
import cssWorker from 'monaco-editor/language/css/css.worker?worker';
import htmlWorker from 'monaco-editor/language/html/html.worker?worker';
import tsWorker from 'monaco-editor/language/typescript/ts.worker?worker';
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

// 注入 arkglide.d.ts 到 JS language service
// 注意：monaco-editor 0.57 将 TS API 置于顶层 monaco.typescript（非旧版 monaco.languages.typescript）
monaco.typescript.javascriptDefaults.addExtraLib(dtsContent, 'file:///arkglide.d.ts');
monaco.typescript.javascriptDefaults.setDiagnosticsOptions({
  noSemanticValidation: false,
  noSyntaxValidation: false,
});

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
  const deleteScript = useEditorStore((s) => s.deleteScript);

  // editor 实例与 model Map（按文件名索引），跨渲染保持
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const modelMapRef = useRef<Map<string, monaco.editor.ITextModel>>(new Map());
  // editor 是否已 onMount；未就绪前 useEffect 早退，首次同步在 onMount 内完成
  const editorReadyRef = useRef(false);

  const fileNames = Object.keys(scripts);
  // 用文件名列表的快照作为 effect 依赖，区分"文件增删"与"内容变化"
  const fileNamesKey = fileNames.join(',');

  // 同步 model Map：为新增文件创建 model，为已删除文件销毁 model
  // 仅在 editor 就绪后运行；首次同步在 onMount 中完成
  useEffect(() => {
    if (!editorReadyRef.current) return;
    const modelMap = modelMapRef.current;
    const currentSet = new Set(fileNames);

    // 销毁已删除文件的 model（避免内存泄漏）
    for (const [name, model] of modelMap.entries()) {
      if (!currentSet.has(name)) {
        model.dispose();
        modelMap.delete(name);
      }
    }

    // 为新增文件创建 model（内容从 store 读取，避免与 onChange 循环）
    for (const name of fileNames) {
      if (!modelMap.has(name)) {
        const content = useEditorStore.getState().scripts[name] || '';
        const model = monaco.editor.createModel(content, inferLanguage(name));
        modelMap.set(name, model);
      }
    }
    // 仅依赖 fileNamesKey：文件列表变化时同步；内容变化由 onChange 处理
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fileNamesKey]);

  // 切换活跃 model：activeFileId 或文件列表变化后，把 editor 切到对应 model
  useEffect(() => {
    if (!editorReadyRef.current) return;
    const editor = editorRef.current;
    const model = modelMapRef.current.get(activeFileId);
    if (editor && model) {
      editor.setModel(model);
    }
  }, [activeFileId, fileNamesKey]);

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
            icon={
              // main.js 不可关闭，不渲染关闭按钮
              name !== 'main.js' ? (
                <IconButton
                  size="small"
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
          onMount={(editor) => {
            editorRef.current = editor;
            editorReadyRef.current = true;

            // Editor 组件会预创建一个空 model，setModel 替换后需 dispose 避免泄漏
            const defaultModel = editor.getModel();

            // 首次挂载：为所有 scripts 创建 model，并切到 activeFileId
            const modelMap = modelMapRef.current;
            const state = useEditorStore.getState();
            for (const name of Object.keys(state.scripts)) {
              if (!modelMap.has(name)) {
                const content = state.scripts[name] || '';
                const model = monaco.editor.createModel(content, inferLanguage(name));
                modelMap.set(name, model);
              }
            }
            const activeModel = modelMap.get(state.activeFileId);
            if (activeModel) editor.setModel(activeModel);

            // dispose 默认空 model（已被替换）
            if (defaultModel) defaultModel.dispose();

            // 绑定 Ctrl/Cmd+S：触发 updateScript + 阻止浏览器默认保存网页行为
            editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
              const currentActive = useEditorStore.getState().activeFileId;
              updateScript(currentActive, editor.getValue());
            });
          }}
          onChange={(value) => {
            // 内容变化同步到 store；用 getState() 取最新 activeFileId 避免闭包陷阱
            const currentActive = useEditorStore.getState().activeFileId;
            updateScript(currentActive, value || '');
          }}
          options={{
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