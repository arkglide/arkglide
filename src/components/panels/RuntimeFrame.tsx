import { useEffect, useRef } from 'react';
import { useEditorStore } from '../../store/useEditorStore';
import type { ProjectJSON } from '../../types/project';

// iframe 运行时沙箱容器：常驻不卸载，postMessage 收发桥梁
export default function RuntimeFrame() {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const runIdRef=useRef(0);
  const readyRef = useRef(false);
  const pendingProjectRef = useRef<ProjectJSON | null>(null);
  // 暂存待发送的模型数据（iframe 未 ready 时）
  const pendingModelDataRef = useRef<Record<string, ArrayBuffer> | null>(null);
  const pendingTransferRef = useRef<Transferable[] | null>(null);
  const prevPlayStateRef = useRef(useEditorStore.getState().playState);

  const documentId=useEditorStore(s=>s.documentId);
  useEffect(()=>{runIdRef.current++;useEditorStore.getState().setRuntimeStats(null);},[documentId]);
  const project = useEditorStore((s) => s.project);
  const playState = useEditorStore((s) => s.playState);
  const addConsoleLog = useEditorStore((s) => s.addConsoleLog);

  // 发消息到 iframe（opaque origin，targetOrigin 用 '*'，靠 source 验证兜底）
  // 支持 Transferable：postMessage(msg, '*', transfer) 转移 ArrayBuffer 所有权，零拷贝
  const postToIframe = (msg: unknown, transfer?: Transferable[]) => {
    const iframe = iframeRef.current;
    if (iframe?.contentWindow) {
      if (transfer && transfer.length > 0) {
        iframe.contentWindow.postMessage(msg, '*', transfer);
      } else {
        iframe.contentWindow.postMessage(msg, '*');
      }
    }
  };

  // 监听 iframe → 编辑器消息（source 验证）
  useEffect(() => {
    const handler = (ev: MessageEvent) => {
      const iframe = iframeRef.current;
      if (!iframe || ev.source !== iframe.contentWindow) return; // 只接受本 iframe 消息
      const msg = ev.data;
      if (!msg || typeof msg !== 'object') return;

      if(msg.runId != null && msg.runId!==runIdRef.current)return;
      switch (msg.type) {
        case 'ready':
          readyRef.current = true;
          // iframe 就绪后立即获取焦点，确保键盘事件能被捕获
          if (useEditorStore.getState().playState !== 'stopped') iframeRef.current?.focus();
          if (pendingProjectRef.current && useEditorStore.getState().playState !== 'stopped') {
            // 发送暂存的项目（含模型 ArrayBuffer，通过 Transferable 零拷贝传递）
            if (pendingTransferRef.current && pendingTransferRef.current.length > 0) {
              postToIframe(
                {
                  type: 'run',runId:runIdRef.current,
                  project: pendingProjectRef.current,
                  modelData: pendingModelDataRef.current,
                },
                pendingTransferRef.current,
              );
            } else {
              postToIframe({ type: 'run',runId:runIdRef.current, project: pendingProjectRef.current });
            }
            pendingProjectRef.current = null;
            pendingModelDataRef.current = null;
            pendingTransferRef.current = null;
            if (useEditorStore.getState().playState === 'paused') postToIframe({ type: 'pause' });
          }
          break;
        case 'log':
          addConsoleLog(msg.level, (msg.args || []).join(' '));
          break;
        case 'diagnostic':
          addConsoleLog(msg.level || 'error',msg.message,{file:msg.file,line:msg.line,column:msg.column,hook:msg.hook,entityId:msg.entityId,stack:msg.stack});
          break;
        case 'telemetry':
          useEditorStore.getState().setRuntimeStats(msg.stats);
          break;
        case 'fatal':
          addConsoleLog('error', '[FATAL] ' + msg.message);
          useEditorStore.getState().stop();
          break;
      }
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, [addConsoleLog]);

  // 响应 playState 变化：run / pause / resume
  useEffect(() => {
    const prev = prevPlayStateRef.current;
    if (playState === prev) return;
    prevPlayStateRef.current = playState;

    if (playState === 'playing') {
      if (prev === 'stopped') {
        runIdRef.current++;
        useEditorStore.getState().setRuntimeStats(null);
        // 收集所有 model 节点的 ArrayBuffer，通过 Transferable 零拷贝传递给 iframe
        const modelData: Record<string, ArrayBuffer> = {};
        const transferList: ArrayBuffer[] = [];
        const modelBuffers = useEditorStore.getState().modelBuffers;
        const nodes = useEditorStore.getState().nodes;
        nodes.forEach((n) => {
          if (n.type === 'model') {
            const buf = modelBuffers.get(n.id);
            if (buf) {
              // 复制一份：Transferable 会转移所有权，原 ArrayBuffer 的 byteLength 将变为 0
              // 复制避免播放后编辑器中的模型数据失效（停止播放后仍可编辑）
              const copy = buf.slice(0);
              modelData[n.id] = copy;
              transferList.push(copy);
            }
          }
        });

        // 启动：发 run（若 iframe 未 ready，暂存等 handshake）
        if (readyRef.current && project) {
          if (transferList.length > 0) {
            postToIframe({ type: 'run',runId:runIdRef.current, project, modelData }, transferList);
          } else {
            postToIframe({ type: 'run',runId:runIdRef.current, project });
          }
        } else if (project) {
          pendingProjectRef.current = project;
          pendingModelDataRef.current = Object.keys(modelData).length > 0 ? modelData : null;
          pendingTransferRef.current = transferList.length > 0 ? transferList : null;
        }
      } else if (prev === 'paused') {
        postToIframe({ type: 'resume' });
      }
    } else if (playState === 'paused') {
      postToIframe({ type: 'pause' });
    } else if (playState === 'stopped') {
      pendingProjectRef.current = null;
      pendingModelDataRef.current = null;
      pendingTransferRef.current = null;
      postToIframe({ type: 'stop' }); // 完全重置 iframe 场景
    }
  }, [playState, project]);

  // 用户点击运行区域时自动 focus iframe（确保键盘事件被捕获）
  const handleFocus = () => {
    if (useEditorStore.getState().playState !== 'stopped') iframeRef.current?.focus();
  };

  return (
    <div
      onClick={handleFocus}
      style={{ width: '100%', height: '100%', cursor: 'pointer' }}
    >
      <iframe
        ref={iframeRef}
        src="/runtime.html"
        sandbox="allow-scripts"
        title="ArkGlide Runtime"
        onLoad={handleFocus}
        style={{ width: '100%', height: '100%', border: 'none', display: 'block' }}
      />
    </div>
  );
}