import { useEditorStore } from "../store/useEditorStore";
export async function importAudioFile(file: File, id?: string) {
  const documentId = useEditorStore.getState().documentId;
  const ext = file.name.split(".").pop()?.toLowerCase(),
    mime = (
      {
        wav: "audio/wav",
        mp3: "audio/mpeg",
        ogg: "audio/ogg",
        m4a: "audio/mp4",
        webm: "audio/webm",
      } as Record<string, string>
    )[ext || ""];
  if (!mime || !file.size || file.size > 32 * 1024 * 1024)
    throw new Error("请导入不超过32 MiB的WAV、MP3、OGG、M4A或WebM音频");
  const bytes = await file.arrayBuffer();
  const state = useEditorStore.getState();
  if (state.documentId !== documentId)
    throw new Error("项目已切换，请重新导入音频");
  if (id && !state.content.audio?.some((a) => a.id === id))
    throw new Error("要替换的音频已删除");
  state.importAudio(
      {
        id: id || crypto.randomUUID(),
        name: file.name,
        mime,
        byteLength: bytes.byteLength,
      },
      bytes,
    );
}
