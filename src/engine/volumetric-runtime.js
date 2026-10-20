// World-space single scattering on the GPU; all render targets belong to this host.
(function(root) {
  "use strict";
  function budget(width,height,config,maxSize=8192) {
    const scale=Math.min(config.scale,Math.sqrt(config.maxPixels/Math.max(1,width*height)),maxSize/Math.max(width,height));
    return {width:Math.max(1,Math.floor(width*scale)),height:Math.max(1,Math.floor(height*scale))};
  }
  const reconstruction=`
    vec3 worldAt(vec2 uv, float depth) {
      vec4 p = inverseViewProjection * vec4(uv * 2.0 - 1.0, depth * depthRange.x + depthRange.y, 1.0);
      return p.xyz / p.w;
    }
    float rayLength(vec2 uv) {
      return min(maxDistance, length(worldAt(uv, texture2D(depthSampler, uv).r) - worldAt(uv, nearDepth)));
    }
  `;
  const integrate=`
    precision highp float;
    varying vec2 vUV;
    uniform sampler2D depthSampler, lightDepthSampler;
    uniform mat4 inverseViewProjection, lightViewProjection;
    uniform vec2 depthRange;
    uniform vec4 medium, lighting, variation;
    uniform vec3 fogColor, sunDirection, sunColor;
    uniform float maxDistance, nearDepth, shadowEnabled, shadowBias, reverseDepth;
    ${reconstruction}
    float hash(vec3 p) { p = fract(p * .1031); p += dot(p, p.yzx + 33.33); return fract((p.x + p.y) * p.z); }
    float noise(vec3 p) {
      vec3 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
      return mix(mix(mix(hash(i),hash(i+vec3(1,0,0)),f.x),mix(hash(i+vec3(0,1,0)),hash(i+vec3(1,1,0)),f.x),f.y),
                 mix(mix(hash(i+vec3(0,0,1)),hash(i+vec3(1,0,1)),f.x),mix(hash(i+vec3(0,1,1)),hash(i+vec3(1,1,1)),f.x),f.y),f.z);
    }
    float visibility(vec3 p) {
      if (shadowEnabled < .5) return 1.0;
      vec4 clip = lightViewProjection * vec4(p,1.0);
      vec3 q = clip.xyz / clip.w; q.xy = q.xy*.5+.5; q.z = (q.z-depthRange.y)/depthRange.x;
      if (min(q.x,q.y)<0.0 || max(q.x,q.y)>1.0 || q.z<0.0 || q.z>1.0) return 1.0;
      float sampleDepth = texture2D(lightDepthSampler,q.xy).r;
      return reverseDepth>.5?step(sampleDepth-shadowBias,q.z):step(q.z-shadowBias,sampleDepth);
    }
    void main() {
      vec3 origin = worldAt(vUV,nearDepth), delta = worldAt(vUV,texture2D(depthSampler,vUV).r)-origin;
      float distance = min(length(delta),maxDistance), stepSize = distance/float(VOLUME_STEPS);
      vec3 ray = delta/max(length(delta),.000001);
      float mu = clamp(dot(ray,sunDirection),-1.0,1.0), g = lighting.z;
      float phase = (1.0-g*g)/pow(max(.01,1.0+g*g-2.0*g*mu),1.5);
      vec3 result = vec3(0.0); float transmittance = 1.0;
      // Fixed world-independent screen jitter avoids an animated noise pattern.
      float jitter = mix(.5,hash(vec3(gl_FragCoord.xy,7.0)),variation.z);
      for(int i=0;i<VOLUME_STEPS;i++) {
        vec3 p = origin+ray*((float(i)+jitter)*stepSize);
        // Height density saturates below the reference plane instead of exploding.
        float density = medium.x*exp(-max(0.0,p.y-medium.y)*medium.z);
        if(variation.x>0.0) density *= mix(1.0,.15+1.7*noise(p*variation.y),variation.x);
        float attenuation = exp(-density*stepSize);
        vec3 illumination = vec3(lighting.x)+sunColor*(lighting.y*phase*visibility(p));
        result += transmittance*(1.0-attenuation)*fogColor*illumination;
        transmittance *= attenuation;
        if(transmittance<.003) break;
      }
      gl_FragColor = vec4(result,transmittance);
    }
  `;
  const composite=`
    precision highp float;
    varying vec2 vUV;
    uniform sampler2D textureSampler, sceneSampler, depthSampler;
    uniform mat4 inverseViewProjection;
    uniform vec2 depthRange, volumeSize;
    uniform float maxDistance, nearDepth;
    ${reconstruction}
    void main() {
      vec2 p = vUV*volumeSize-.5, base = floor(p), f = fract(p);
      float reference = rayLength(vUV), sum = 0.0, best = 1.e20;
      vec4 volume = vec4(0.0), nearestVolume = vec4(0,0,0,1);
      for(int y=0;y<2;y++) for(int x=0;x<2;x++) {
        vec2 uv = clamp((base+vec2(float(x),float(y))+.5)/volumeSize,.5/volumeSize,1.0-.5/volumeSize);
        float error = abs(rayLength(uv)-reference);
        vec4 value = texture2D(textureSampler,uv);
        float weight = (x==0?1.0-f.x:f.x)*(y==0?1.0-f.y:f.y)*exp(-error/max(.05,reference*.02));
        volume += value*weight; sum += weight;
        if(error<best) { best=error; nearestVolume=value; }
      }
      volume = sum>.00001?volume/sum:nearestVolume;
      // If a thin foreground has no matching low-res sample, preserve its color
      // rather than borrowing the fog accumulated behind its silhouette.
      if(best>max(.1,reference*.05)) volume=vec4(0,0,0,1);
      vec4 scene = texture2D(sceneSampler,vUV);
      gl_FragColor = vec4(scene.rgb*volume.a+volume.rgb,scene.a);
    }
  `;
  function create(B,scene) {
    const engine=scene.getEngine(),caps=engine.getCaps();
    const supported=engine.webGLVersion>=2&&!engine.isWebGPU&&!!(caps.textureFloatRender||caps.textureHalfFloatRender)&&!!B.DepthRenderer;
    let camera=null,config=null,capture=null,march=null,combine=null,mainDepth=null,lightDepth=null,lightCamera=null;
    let width=0,height=0,shadowSize=0,shadowActive=false,light=null,combineSize=null;
    const inverse=B.Matrix.Identity(),lightMatrix=B.Matrix.Identity(),sun=B.Vector3.Up(),sunColor=new B.Color3(0,0,0);
    const depthRange=[engine.isNDCHalfZRange?1:2,engine.isNDCHalfZRange?0:-1],nearDepth=engine.useReverseDepthBuffer?1:0;
    function releaseDepth(renderer) { if(renderer)renderer.dispose(); }
    function clear() {
      for(const post of [capture,march,combine])post?.dispose(camera);
      capture=march=combine=null;
      releaseDepth(mainDepth); releaseDepth(lightDepth); mainDepth=lightDepth=null;
      lightCamera?.dispose(); lightCamera=null;
      camera=null; config=null; width=height=shadowSize=0; shadowActive=false;light=null;combineSize=null;
    }
    function depth(targetCamera,name) {
      // Unique registry keys let Babylon own compilation/readiness and disposal,
      // without replacing any depth renderer borrowed by DOF, AO or the host.
      const type=caps.textureFloatRender?B.Constants.TEXTURETYPE_FLOAT:B.Constants.TEXTURETYPE_HALF_FLOAT;
      const renderer=new B.DepthRenderer(scene,type,targetCamera,true,B.Texture.NEAREST_SAMPLINGMODE,false,name);
      scene._depthRenderer ||= {};
      scene._depthRenderer[name+':'+targetCamera.uniqueId]=renderer;
      renderer.clearColor=new B.Color4(engine.useReverseDepthBuffer?0:1,0,0,1);
      return renderer;
    }
    function common(effect) {
      effect.setMatrix('inverseViewProjection',inverse);
      effect.setFloat2('depthRange',...depthRange); effect.setFloat('nearDepth',nearDepth);
      effect.setFloat('maxDistance',config.maxDistance); effect.setTexture('depthSampler',mainDepth.getDepthMap());
    }
    function configure(next,targetCamera) {
      clear();
      if(!next.enabled||!targetCamera||!supported)return;
      camera=targetCamera; config=next;
      B.Effect.ShadersStore.arkglideVolumePixelShader=integrate;
      B.Effect.ShadersStore.arkglideVolumeCompositePixelShader=composite;
      mainDepth=depth(camera,'arkglide:volume-depth');
      const type=caps.textureHalfFloatRender?B.Constants.TEXTURETYPE_HALF_FLOAT:B.Constants.TEXTURETYPE_FLOAT;
      // First full-size input retains original scene color. The march runs into
      // combine's small input; combine then draws at the next pass's full size.
      capture=new B.PassPostProcess('arkglide:volume-color',1,camera,B.Texture.NEAREST_SAMPLINGMODE,engine,false,type);
      march=new B.PostProcess('arkglide:volume-march','arkglideVolume',['inverseViewProjection','lightViewProjection','depthRange','nearDepth','maxDistance','medium','lighting','variation','fogColor','sunDirection','sunColor','shadowEnabled','shadowBias','reverseDepth'],['depthSampler','lightDepthSampler'],1,camera,B.Texture.NEAREST_SAMPLINGMODE,engine,false,'#define VOLUME_STEPS '+config.steps,type);
      const target=budget(engine.getRenderWidth(),engine.getRenderHeight(),config,caps.maxTextureSize);
      // Keep this options object: mutate dimensions on resize using the public
      // constructor option, without touching Babylon's private texture cache.
      combineSize={width:target.width,height:target.height};
      combine=new B.PostProcess('arkglide:volume-composite','arkglideVolumeComposite',['inverseViewProjection','depthRange','nearDepth','maxDistance','volumeSize'],['sceneSampler','depthSampler'],combineSize,camera,B.Texture.NEAREST_SAMPLINGMODE,engine,false,null,type);
      const color=B.Color3.FromHexString(config.color).toLinearSpace();
      march.onApply=effect=>{
        common(effect); effect.setMatrix('lightViewProjection',lightMatrix);
        effect.setFloat4('medium',config.density,config.height,config.falloff,0);
        effect.setFloat4('lighting',config.ambient,config.lightIntensity,config.anisotropy,0);
        effect.setFloat4('variation',config.noiseStrength,config.noiseScale,1,0);
        effect.setColor3('fogColor',color); effect.setVector3('sunDirection',sun);effect.setColor3('sunColor',sunColor);
        effect.setFloat('shadowEnabled',shadowActive?1:0);effect.setFloat('shadowBias',config.shadowBias);
        effect.setFloat('reverseDepth',engine.useReverseDepthBuffer?1:0);
        effect.setTexture('lightDepthSampler',(lightDepth||mainDepth).getDepthMap());
      };
      combine.onApply=effect=>{common(effect);effect.setFloat2('volumeSize',width,height);effect.setTextureFromPostProcess('sceneSampler',capture);};
    }
    function visible(mesh) { return !mesh.isDisposed()&&mesh.isEnabled()&&mesh.isVisible&&mesh.visibility>0&&!mesh.infiniteDistance&&!mesh.metadata?.arkglideRenderInternal&&mesh.getTotalVertices()>0; }
    function casts(mesh) {
      for(let node=mesh;node;node=node.parent)if(node.metadata?.arkglideRendering)return node.metadata.arkglideRendering.castShadows!==false;
      return true;
    }
    function prepare() {
      if(!camera||!config)return;
      const mainWidth=engine.getRenderWidth(),mainHeight=engine.getRenderHeight();
      const target=budget(mainWidth,mainHeight,config,caps.maxTextureSize);
      width=target.width;height=target.height;Object.assign(combineSize,target);
      const map=mainDepth.getDepthMap(),old=map.getSize();
      if(old.width!==mainWidth||old.height!==mainHeight)map.resize({width:mainWidth,height:mainHeight});
      camera.getViewMatrix(true).multiply(camera.getProjectionMatrix(true)).invertToRef(inverse);
      const meshes=scene.meshes.filter(visible);map.renderList=meshes;
      light=scene.lights.find(l=>l.getClassName()==='DirectionalLight'&&l.isEnabled()&&l.intensity>0&&l.direction.lengthSquared()>1.e-10)||null;
      sunColor.set(0,0,0);
      if(light) {
        const transformed=light.computeTransformedInformation();
        sun.copyFrom(transformed?light.transformedDirection:light.direction).normalize().scaleInPlace(-1);
        sunColor.copyFrom(light.diffuse).scaleInPlace(light.intensity);
      }
      shadowActive=!!light&&config.shadows;
      if(!shadowActive){releaseDepth(lightDepth);lightDepth=null;lightCamera?.dispose();lightCamera=null;shadowSize=0;return;}
      if(!lightCamera) {
        lightCamera=new B.FreeCamera('arkglide:volume-light',B.Vector3.Zero(),scene);lightCamera.mode=B.Camera.ORTHOGRAPHIC_CAMERA;
        lightCamera.metadata={arkglideRenderInternal:true};
        lightDepth=depth(lightCamera,'arkglide:volume-light-depth');
      }
      const size=Math.min(config.shadowMapSize,caps.maxTextureSize),radius=config.shadowDistance;
      if(size!==shadowSize){lightDepth.getDepthMap().resize(size);shadowSize=size;}
      const forward=camera.getForwardRay().direction,center=camera.globalPosition.add(forward.scale(Math.min(config.maxDistance,radius)*.45));
      const direction=sun.scale(-1),up=Math.abs(direction.y)>.98?B.Axis.Z:B.Axis.Y;
      const right=B.Vector3.Cross(up,direction).normalize(),vertical=B.Vector3.Cross(direction,right).normalize(),texel=2*radius/size;
      // Snap light-space X/Y to texels so camera movement does not crawl shadows.
      center.addInPlace(right.scale(Math.round(B.Vector3.Dot(center,right)/texel)*texel-B.Vector3.Dot(center,right)));
      center.addInPlace(vertical.scale(Math.round(B.Vector3.Dot(center,vertical)/texel)*texel-B.Vector3.Dot(center,vertical)));
      lightCamera.upVector.copyFrom(up);lightCamera.position.copyFrom(center.subtract(direction.scale(radius*2)));
      lightCamera.setTarget(center);lightCamera.minZ=.1;lightCamera.maxZ=radius*4;
      lightCamera.orthoLeft=lightCamera.orthoBottom=-radius;lightCamera.orthoRight=lightCamera.orthoTop=radius;
      lightCamera.getViewMatrix(true).multiplyToRef(lightCamera.getProjectionMatrix(true),lightMatrix);
      lightDepth.getDepthMap().renderList=meshes.filter(casts);
    }
    return {configure,prepare,clear,supported,stats:()=>({volumetricSupported:supported,volumetricEnabled:!!march,volumetricPixels:width*height,volumetricWidth:width,volumetricHeight:height,volumetricSteps:config?.steps||0,volumetricShadowSize:shadowSize,volumetricShadowed:shadowActive,volumetricLight:light?.name||null})};
  }
  root.ArkGlideVolumetric={create,budget};
})(globalThis);
