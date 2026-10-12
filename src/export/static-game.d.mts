export interface StaticExportSettings { title?: string; fit?: 'responsive' | 'contain'; width?: number; height?: number }
export const RUNTIME_FILES: string[];
export function exportSettings(input?: StaticExportSettings): Required<StaticExportSettings>;
export function validateScriptGraph(scripts: Record<string,string>, nodes: any[], prefabs?: Record<string,any>): {entries: string[]; graph: Record<string,string[]>};
export function createStaticGame(project: any, resources: {models: Map<string,ArrayBuffer>; textures: Map<string,ArrayBuffer>; audio: Map<string,ArrayBuffer>}, runtime: Record<string,Uint8Array>, settings?: StaticExportSettings): {files: Record<string,Uint8Array>; manifest: any; zip(): Uint8Array};
