// Analytic single-scattering sky. No external textures or CPU per-pixel work.
(function (root) {
  "use strict";
  function create(B, scene) {
    let sky = null, material = null, previous = null, previousLinear = null;
    const original = { mode: scene.fogMode, color: scene.fogColor.clone(), density: scene.fogDensity, start: scene.fogStart, end: scene.fogEnd };
    function clearSky() { sky?.dispose(false, true); sky = material = null; }
    function configure(config, linear) {
      if (previous === config && previousLinear === linear) return;
      previous = config; previousLinear = linear;
      const fog = config.fog, s = config.sky;
      scene.fogMode = { none: B.Scene.FOGMODE_NONE, linear: B.Scene.FOGMODE_LINEAR, exp: B.Scene.FOGMODE_EXP, exp2: B.Scene.FOGMODE_EXP2 }[fog.mode];
      scene.fogColor.copyFrom(B.Color3.FromHexString(fog.color));
      scene.fogDensity = fog.density; scene.fogStart = fog.start; scene.fogEnd = fog.end;
      if (!s.enabled) { clearSky(); return; }
      if (!sky) {
        material = new B.ShaderMaterial("arkglide:atmosphere", scene, { vertexSource: `
          precision highp float;
          attribute vec3 position;
          uniform mat4 worldViewProjection;
          varying vec3 skyDirection;
          void main() { skyDirection = position; gl_Position = worldViewProjection * vec4(position, 1.0); gl_Position.z = gl_Position.w * 0.999999; }
        `, fragmentSource: `
          precision highp float;
          varying vec3 skyDirection;
          uniform vec3 sunDirection;
          uniform vec4 scattering;
          uniform float luminance;
          uniform float linearOutput;
          void main() {
            vec3 ray = normalize(skyDirection);
            float mu = clamp(dot(ray, sunDirection), -1.0, 1.0);
            float airMass = 1.0 / (max(ray.y, 0.0) + 0.12);
            vec3 betaR = vec3(0.0058, 0.0135, 0.0331) * scattering.y;
            vec3 betaM = vec3(scattering.z * scattering.x);
            vec3 beta = max(betaR + betaM, vec3(0.00001));
            vec3 extinction = exp(-beta * airMass * 8.0);
            float phaseR = 0.0596831 * (1.0 + mu * mu);
            float phaseM = 0.0795775 * 0.36 / pow(max(0.01, 1.64 - 1.6 * mu), 1.5);
            float daylight = smoothstep(-0.12, 0.08, sunDirection.y);
            vec3 radiance = (betaR * phaseR + betaM * phaseM) / beta * (1.0 - extinction) * 12.0;
            radiance *= vec3(1.0, 0.88 + 0.12 * daylight, 0.7 + 0.3 * daylight) * daylight;
            radiance += vec3(0.003, 0.006, 0.018) * (1.0 - daylight);
            radiance += smoothstep(0.99994, 0.99999, mu) * extinction * 15.0 * daylight;
            radiance = mix(vec3(0.025, 0.03, 0.04), radiance, smoothstep(-0.12, 0.015, ray.y)) * luminance;
            if (linearOutput < 0.5) radiance = pow(max(radiance, vec3(0.0)), vec3(1.0 / 2.2));
            gl_FragColor = vec4(radiance, 1.0);
          }
        ` }, { attributes: ["position"], uniforms: ["worldViewProjection", "sunDirection", "scattering", "luminance", "linearOutput"] });
        material.backFaceCulling = false; material.disableDepthWrite = true; material.fogEnabled = false;
        sky = B.MeshBuilder.CreateBox("arkglide:atmosphere", { size: 2 }, scene);
        sky.infiniteDistance = true; sky.isPickable = false; sky.alwaysSelectAsActiveMesh = true;
        sky.metadata = { arkglideRenderInternal: true }; sky.material = material;
        sky.renderingGroupId = 0;
      }
      const az = s.sunAzimuth * Math.PI / 180, el = s.sunElevation * Math.PI / 180;
      material.setVector3("sunDirection", new B.Vector3(Math.cos(el) * Math.sin(az), Math.sin(el), Math.cos(el) * Math.cos(az)));
      material.setVector4("scattering", new B.Vector4(s.turbidity, s.rayleigh, s.mie, 0));
      material.setFloat("luminance", s.luminance); material.setFloat("linearOutput", linear ? 1 : 0);
    }
    return { configure, stats: () => ({ atmosphereSky: !!sky, fogMode: scene.fogMode }), clear() {
      previous = null; clearSky(); scene.fogMode = original.mode; scene.fogColor.copyFrom(original.color);
      scene.fogDensity = original.density; scene.fogStart = original.start; scene.fogEnd = original.end;
    } };
  }
  root.ArkGlideAtmosphere = { create };
})(globalThis);
