export interface BakeOptions { resolution:number;aoSamples:number;aoDistance:number;bias:number; }
export function bakeOptions(input?:unknown):BakeOptions;
export function rasterizeLightmap(data:{positions:ArrayLike<number>;normals:ArrayLike<number>;uvs:ArrayLike<number>;indices:ArrayLike<number>},resolution:number):{samples:Float64Array;pixels:Uint32Array;coverage:number};
export function padLightmap(rgb:Float32Array,pixels:Uint32Array,resolution:number,passes?:number):Float32Array;
export function encodeLightmap(rgb:Float32Array,resolution:number):{png:Uint8Array;scale:number};
export function sceneLightingSignature(state:{nodes:any[];settings:any}):string;
