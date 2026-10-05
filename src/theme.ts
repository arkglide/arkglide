import { createTheme } from '@mui/material/styles';
import type { Shadows } from '@mui/material/styles';

// M3 深色 surface 层级：背景 / 面板 / 悬浮
export const surfaces = {
  background: '#121212',
  panel: '#1E1E1E',
  floating: '#2A2A2A',
} as const;

// 禁用全部 elevation：25 档阴影全部置为 none
const noElevation = Array(25).fill('none') as Shadows;

export const theme = createTheme({
  palette: {
    mode: 'dark',
    primary: { main: '#7C9CFF' },
    secondary: { main: '#FFB74D' },
    background: {
      default: surfaces.background,
      paper: surfaces.panel,
    },
    text: {
      primary: '#E6E6E6',
      secondary: '#A0A0A0',
    },
    divider: '#333333',
  },
  shape: {
    borderRadius: 4, // 全局小圆角，禁大圆角
  },
  shadows: noElevation, // 禁用阴影，靠 surface 色阶区分层级
  typography: {
    fontFamily: '"Roboto", "Helvetica", "Arial", sans-serif',
    fontSize: 13, // 高信息密度
    button: { textTransform: 'none', fontSize: 13 },
  },
  components: {
    MuiAppBar: {
      defaultProps: { elevation: 0 },
      styleOverrides: {
        root: {
          backgroundColor: surfaces.background,
          borderBottom: '1px solid #333333',
        },
      },
    },
    MuiPaper: {
      defaultProps: { elevation: 0 },
      styleOverrides: { root: { backgroundImage: 'none' } },
    },
    MuiCard: {
      defaultProps: { elevation: 0 },
      styleOverrides: { root: { backgroundImage: 'none' } },
    },
    MuiButton: {
      defaultProps: { size: 'small', disableElevation: true },
      styleOverrides: { root: { textTransform: 'none' } },
    },
    MuiIconButton: {
      defaultProps: { size: 'small' },
    },
    MuiTextField: {
      defaultProps: { size: 'small' },
    },
    MuiOutlinedInput: {
      styleOverrides: { root: { borderRadius: 4 } },
    },
    MuiSlider: {
      defaultProps: { size: 'small' },
    },
    MuiSwitch: {
      defaultProps: { size: 'small' },
    },
    MuiList: {
      defaultProps: { dense: true },
    },
    MuiListItem: {
      defaultProps: { dense: true },
      styleOverrides: { root: { paddingTop: 4, paddingBottom: 4 } },
    },
    MuiTabs: {
      defaultProps: { textColor: 'primary', indicatorColor: 'primary' },
    },
    MuiTab: {
      styleOverrides: { root: { minHeight: 36, paddingTop: 4, paddingBottom: 4 } },
    },
    // 禁止 FAB：兜底强制隐藏，核心操作一律放 TopBar
    MuiFab: {
      styleOverrides: { root: { display: 'none' } },
    },
  },
});