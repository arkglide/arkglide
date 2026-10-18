export interface RenderingSettings {
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
  color?: { toneMapping?: "none" | "standard" | "aces"; exposure?: number; contrast?: number };
}
