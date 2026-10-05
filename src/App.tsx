import { useEffect, useState } from 'react';
import { Box } from '@mui/material';
import MainLayout from './layouts/MainLayout';
import { importProject } from './utils/projectExport';

export default function App() {
  const [dragOver, setDragOver] = useState(false);

  useEffect(() => {
    const handleDragOver = (e: DragEvent) => {
      // 检查拖拽的文件是否是 .arkglide
      const items = e.dataTransfer?.items;
      if (items && items.length > 0) {
        const file = items[0];
        if (file.kind === 'file') {
          e.preventDefault(); // 允许 drop
          setDragOver(true);
        }
      }
    };

    const handleDragLeave = (e: DragEvent) => {
      if (e.relatedTarget === null) {
        setDragOver(false);
      }
    };

    const handleDrop = async (e: DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      const file = e.dataTransfer?.files?.[0];
      if (file && file.name.endsWith('.arkglide')) {
        try {
          await importProject(file);
        } catch (err) {
          console.error('导入失败:', err);
        }
      }
    };

    window.addEventListener('dragover', handleDragOver);
    window.addEventListener('dragleave', handleDragLeave);
    window.addEventListener('drop', handleDrop);
    return () => {
      window.removeEventListener('dragover', handleDragOver);
      window.removeEventListener('dragleave', handleDragLeave);
      window.removeEventListener('drop', handleDrop);
    };
  }, []);

  return (
    <>
      <MainLayout />
      {dragOver && (
        <Box
          sx={{
            position: 'fixed',
            inset: 0,
            zIndex: 9999,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: 'rgba(0,0,0,0.7)',
            pointerEvents: 'none',
          }}
        >
          <Box
            sx={{
              border: '2px dashed #7C9CFF',
              borderRadius: 2,
              p: 4,
              color: '#7C9CFF',
              fontSize: 18,
            }}
          >
            释放以导入 .arkglide 项目
          </Box>
        </Box>
      )}
    </>
  );
}