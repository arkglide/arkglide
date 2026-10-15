import { useEffect, useId, useRef, useState } from "react";
import { Alert, Button, Dialog, DialogActions, DialogContent, DialogTitle, TextField } from "@mui/material";
import { useEditorStore } from "../../store/useEditorStore";

export default function ScriptRenameDialog({ fileName, onClose }: {
  fileName: string;
  onClose: () => void;
}) {
  const documentId = useEditorStore(s => s.documentId);
  const playState = useEditorStore(s => s.playState);
  const exists = useEditorStore(s => Object.hasOwn(s.scripts, fileName));
  const originalDocument = useRef(documentId);
  const titleId = useId();
  const [draft, setDraft] = useState(fileName);
  const [error, setError] = useState<string | null>(null);
  const open = documentId === originalDocument.current && playState === "stopped" && exists && fileName !== "main.js";

  useEffect(() => { if (!open) onClose(); }, [open, onClose]);

  function confirm() {
    const state = useEditorStore.getState();
    if (!open || state.documentId !== originalDocument.current || state.playState !== "stopped") return;
    const value = draft.trim();
    if (!value) { setError("请输入脚本文件名"); return; }
    const next = value.endsWith(".js") ? value : value + ".js";
    if (next === fileName) { onClose(); return; }
    if (Object.hasOwn(state.scripts, next)) { setError("该脚本文件名已存在"); return; }
    try {
      state.renameScript(fileName, next);
      onClose();
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
    }
  }

  return (
    <Dialog open={open} onClose={onClose} aria-labelledby={titleId} fullWidth maxWidth="xs">
      <DialogTitle id={titleId}>重命名脚本</DialogTitle>
      <DialogContent>
        <TextField
          autoFocus fullWidth margin="dense" label="脚本文件名" value={draft}
          onFocus={event => event.target.select()}
          onChange={event => { setDraft(event.target.value); setError(null); }}
          helperText="可包含目录，省略 .js 将自动补全"
          onKeyDown={event => {
            if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return;
            if (event.key === "Enter") { event.preventDefault(); confirm(); }
          }}
        />
        {error && <Alert severity="error">{error}</Alert>}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>取消</Button>
        <Button variant="contained" onClick={confirm}>重命名</Button>
      </DialogActions>
    </Dialog>
  );
}
