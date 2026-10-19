export interface RenderingSettings {
  quality?: "custom" | "low" | "medium" | "high";
  resolutionScale?: number;
  antialiasing?: "none" | "fxaa" | "msaa";
  samples?: number;
  gpuProfiling?: boolean;
  fog?: { mode?: "none" | "linear" | "exp" | "exp2"; color?: string; density?: number; start?: number; end?: number };
  sky?: { enabled?: boolean; sunAzimuth?: number; sunElevation?: number; turbidity?: number; rayleigh?: number; mie?: number; luminance?: number };
  dof?: { enabled?: boolean; focusDistance?: number; focalLength?: number; fStop?: number; quality?: 0 | 1 | 2 };
  reflections?: {
    ssr?: { enabled?: boolean; maxSteps?: number; step?: number; maxDistance?: number; thickness?: number; strength?: number; roughnessFactor?: number; blur?: number; downsample?: number };
    planar?: { enabled?: boolean; maxMirrors?: number; maxPixels?: number; scale?: number };
  };
  views?: { depth?: number; scale?: number; recursiveScale?: number; samples?: number; maxViews?: number; maxPixels?: number; minArea?: number; minResolution?: number; particles?: boolean };
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
export interface PlanarReflectionSettings { enabled: boolean; axis?: "x" | "y" | "z"; offset?: number; blur?: number; intensity?: number; }
