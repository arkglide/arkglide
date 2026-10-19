(function(root){
 'use strict';
 const plugins=new WeakMap();
 function apply(B,material,enabled){
  material.metadata={...material.metadata,arkglideBakedDirectLighting:!!enabled};
  let plugin=plugins.get(material);if(!plugin&&!enabled)return;
  if(!plugin){
   class BakedDiffuse extends B.MaterialPluginBase{
    constructor(){super(material,'ArkGlideBakedDiffuse',210,{ARKGLIDE_BAKED_DIFFUSE:false});this.enabled=false;}
    getClassName(){return 'ArkGlideBakedDiffuse';}
    prepareDefines(defines){defines.ARKGLIDE_BAKED_DIFFUSE=this.enabled;}
    getCustomCode(shader){return shader==='fragment'?{CUSTOM_FRAGMENT_BEFORE_FOG:`
#if defined(ARKGLIDE_BAKED_DIFFUSE) && defined(LIGHTMAP) && !defined(USELIGHTMAPASSHADOWMAP) && !defined(LIGHTMAPEXCLUDED)
// Native PBR lightmaps add radiance. Our baker stores diffuse irradiance, so
// replace that addition with the current textured/metalness-adjusted albedo.
finalColor.rgb += lightmapColor.rgb * (surfaceAlbedo - vec3(1.0));
#endif
`}:null;}
   }
   plugin=new BakedDiffuse();plugins.set(material,plugin);
  }
  if(plugin.enabled!==!!enabled){plugin.enabled=!!enabled;plugin._enable(!!enabled);plugin.markAllDefinesAsDirty();}
 }
 root.ArkGlideBakedLighting={apply};
})(globalThis);
