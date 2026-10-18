export interface RenderingSettings {
  ao?: { enabled?: boolean; ratio?: number; radius?: number; strength?: number; samples?: number };
  probes?: ReflectionProbeSettings[];
  shadows?: {
    enabled?: boolean;
    mapSize?: number;
    filter?: "pcf" | "pcss" | "poisson";
    bias?: number;
    normalBias?: number;
    darkness?: number;
    maxDistance?: number;
    maxLights?: number;
  };
  environment?: { textureId?: string | null; intensity?: number; rotation?: number; skybox?: boolean };
  color?: { toneMapping?: "none" | "standard" | "aces"; exposure?: number; contrast?: number; saturation?: number; hue?: number; tint?: number };
  bloom?: { enabled?: boolean; threshold?: number; weight?: number; kernel?: number; scale?: number };
}
export interface ReflectionProbeSettings {
  id: string;
  name: string;
  textureId: string;
  position: { x: number; y: number; z: number };
  size: { x: number; y: number; z: number };
  priority?: number;
  intensity?: number;
}
