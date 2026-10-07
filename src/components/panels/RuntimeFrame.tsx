import { useEffect, useRef } from 'react';
import { useEditorStore } from '../../store/useEditorStore';
import type { ProjectJSON } from '../../types/project';

// WASM 数学模块源码和 URL（Vite ?raw 编译时嵌入字符串，?url 运行时解析为正确路径）
import wasmJsRaw from '../../wasm/arkglide_math.js?raw';
import wasmUrl from '../../wasm/arkglide_math.wasm?url';

// iframe 运行时沙箱容器：常驻不卸载，postMessage 收发桥梁
export default function RuntimeFrame() {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const readyRef = useRef(false);
  const pendingProjectRef = useRef<ProjectJSON | null>(null);
  // 暂存待发送的模型数据（iframe 未 ready 时）
  const pendingModelDataRef = useRef<Record<string, ArrayBuffer> | null>(null);
  const pendingTransferRef = useRef<Transferable[] | null>(null);
  const prevPlayStateRef = useRef(useEditorStore.getState().playState);
  // WASM 模块是否已发送给 iframe（只发一次，避免重复传输大数据）
  const wasmInitSentRef = useRef(false);

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

  // 发送 WASM 初始化数据给 iframe（只发送一次）
  const sendWasmInit = async () => {
    if (wasmInitSentRef.current) return; // 已发送，跳过
    try {
      const resp = await fetch(wasmUrl);
      const wasmBinary = await resp.arrayBuffer();
      postToIframe(
        { type: 'wasm_init', wasmJs: wasmJsRaw, wasmBinary },
        [wasmBinary], // Transferable 零拷贝
      );
      wasmInitSentRef.current = true;
    } catch (err) {
      console.error('[RuntimeFrame] Failed to send WASM init:', err);
    }
  };

  // 监听 iframe → 编辑器消息（source 验证）
  useEffect(() => {
    const handler = (ev: MessageEvent) => {
      const iframe = iframeRef.current;
      if (!iframe || ev.source !== iframe.contentWindow) return; // 只接受本 iframe 消息
      const msg = ev.data;
      if (!msg || typeof msg !== 'object') return;

      switch (msg.type) {
        case 'ready':
          readyRef.current = true;
          // iframe 就绪后立即获取焦点，确保键盘事件能被捕获
          iframeRef.current?.focus();
          // iframe 就绪后发送 WASM 初始化（如果尚未发送）
          sendWasmInit();
          if (pendingProjectRef.current) {
            // 发送暂存的项目（含模型 ArrayBuffer，通过 Transferable 零拷贝传递）
            if (pendingTransferRef.current && pendingTransferRef.current.length > 0) {
              postToIframe(
                {
                  type: 'run',
                  project: pendingProjectRef.current,
                  modelData: pendingModelDataRef.current,
                },
                pendingTransferRef.current,
              );
            } else {
              postToIframe({ type: 'run', project: pendingProjectRef.current });
            }
            pendingProjectRef.current = null;
            pendingModelDataRef.current = null;
            pendingTransferRef.current = null;
          }
          break;
        case 'log':
          addConsoleLog(msg.level, (msg.args || []).join(' '));
          break;
        case 'fatal':
          addConsoleLog('error', '[FATAL] ' + msg.message);
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
        // 首次播放：先发送 WASM 初始化数据（异步，不阻塞播放）
        sendWasmInit();
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
            postToIframe({ type: 'run', project, modelData }, transferList);
          } else {
            postToIframe({ type: 'run', project });
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
      postToIframe({ type: 'stop' }); // 完全重置 iframe 场景
    }
  }, [playState, project]);

  // 用户点击运行区域时自动 focus iframe（确保键盘事件被捕获）
  const handleFocus = () => {
    iframeRef.current?.focus();
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