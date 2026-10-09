import type { FC } from 'react';
import { useEffect, useRef } from 'react';
import { useEditorStore } from '../store/useEditorStore';
import { Box } from '@mui/material';
import { DockviewReact, type IDockviewPanelProps } from 'dockview-react';
import TopBar from '../components/panels/TopBar';
import SceneTree from '../components/panels/SceneTree';
import Inspector from '../components/panels/Inspector';
import Viewport from '../components/panels/Viewport';
import BottomPanel from '../components/panels/BottomPanel';

function EditingPanel({ children }: { children: React.ReactNode }) {
  const editing = useEditorStore(s => s.playState === 'stopped');
  const element = useRef<HTMLDivElement>(null);
  useEffect(() => { if (element.current) element.current.inert = !editing; }, [editing]);
  return <Box ref={element} sx={{height:'100%',opacity:editing ? 1 : 0.6}}>{children}</Box>;
}

// Dockview 面板组件注册
const components: Record<string, FC<IDockviewPanelProps>> = {
  sceneTree: () => <EditingPanel><SceneTree /></EditingPanel>,
  viewport: () => <Viewport />,
  inspector: () => <EditingPanel><Inspector /></EditingPanel>,
  bottomPanel: () => <BottomPanel />,
};

// 主布局：TopBar 固定顶部 + Dockview 管理四向面板
export default function MainLayout() {
  return (
    <Box sx={{ height: '100vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <TopBar />
      <Box sx={{ flex: 1, minHeight: 0, position: 'relative' }}>
        <DockviewReact
          components={components}
          onReady={(event) => {
            const api = event.api;
            // 中央视口（首个面板，作为布局基准）
            api.addPanel({ id: 'viewport', component: 'viewport', title: '视口' });
            // 左侧场景树
            api.addPanel({
              id: 'sceneTree',
              component: 'sceneTree',
              title: '场景树',
              position: { referencePanel: 'viewport', direction: 'left' },
            });
            // 右侧属性面板
            api.addPanel({
              id: 'inspector',
              component: 'inspector',
              title: '属性',
              position: { referencePanel: 'viewport', direction: 'right' },
            });
            // 底部 Tab 面板（控制台 / 代码编辑器）
            api.addPanel({
              id: 'bottomPanel',
              component: 'bottomPanel',
              title: '底部',
              position: { referencePanel: 'viewport', direction: 'below' },
            });
          }}
        />
      </Box>
    </Box>
  );
}