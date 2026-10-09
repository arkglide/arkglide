import React from 'react';
import ReactDOM from 'react-dom/client';
import { ThemeProvider, CssBaseline } from '@mui/material';
import App from './App';
import { startProjectRecovery } from './utils/projectRecovery';
const recovery = startProjectRecovery();
if(import.meta.hot)import.meta.hot.dispose(()=>recovery.dispose());
import { theme } from './theme';
import 'dockview/dist/styles/dockview.css'; // Dockview 面板样式
import { loadMathModule } from './engine/wasm/math-loader';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <App />
    </ThemeProvider>
  </React.StrictMode>,
);

// WASM 最小验证：应用启动后加载 WASM 数学模块并测试 Vector3 运算
// 期望输出：ArkGlide WASM Vector3: 5 7 9 / ArkGlide WASM length: 11.22...
loadMathModule()
  .then((math) => {
    const a = new math.Vector3(1, 2, 3);
    const b = new math.Vector3(4, 5, 6);
    const c = math.addVectors(a, b);
    console.log('ArkGlide WASM Vector3:', c.x, c.y, c.z);
    console.log('ArkGlide WASM length:', c.length());
    c.delete(); b.delete(); a.delete();
  })
  .catch((err) => {
    console.error('ArkGlide WASM load failed:', err);
  });