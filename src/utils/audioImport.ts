import { useEditorStore } from "../store/useEditorStore";
export async function importAudioFile(file: File, id?: string) {
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
  useEditorStore
    .getState()
    .importAudio(
      {
        id: id || crypto.randomUUID(),
        name: file.name,
        mime,
        byteLength: bytes.byteLength,
      },
      bytes,
    );
}
