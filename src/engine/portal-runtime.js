// Paired planar apertures: world transforms, geometry, traversal, rays and bounded recursive views.
(function (root) {
  "use strict";
  function create(B, o) {
    const S = root.ArkGlideSpatial,
      scene = o.scene,
      physics = o.physics,
      surfaces = new Map(),
      portals = new Map(),
      actors = new Map(),
      listeners = new Set(),
      blockedListeners = new Set(),
      views = [];
    let disposed = false,
      serial = 0,
      rendering = false,
      renderCount = 0;
    let quality = { depth: 2, scale: 1, recursiveScale: 0.75, samples: 4, maxViews: 24 };
    let traversalLimits = { maxSubSteps: 128, maxStepTime: 1 / 240, maxTravelDistance: 0.15 };
    const V = (p) => {
        S.vec(p);
        return new B.Vector3(p.x, p.y, p.z);
      },
      Q = (q) => {
        S.quat(q);
        return new B.Quaternion(q.x, q.y, q.z, q.w);
      };
    const transform = (p) =>
      B.Matrix.Compose(B.Vector3.One(), p.rotation, p.position);
    const flip = B.Matrix.RotationY(Math.PI),
      epsilon = 0.0005;
    function guard(owner) {
      if (disposed || (owner && !owner.record.active))
        throw Error("Portal handle expired");
    }
    function valid(e) {
      if (!e || e.destroyed || o.find(e.id) !== e)
        throw Error("Portal entity absent");
      return e;
    }
    function active(p) {
      return (
        p.enabled &&
        !p.dead &&
        p.link &&
        !p.link.dead &&
        p.link.enabled &&
        p.link.link === p
      );
    }
    function mapping(p) {
      if (!active(p)) throw Error("Portal is not linked");
      syncSurface(p.surface);
      syncSurface(p.link.surface);
      return B.Matrix.Invert(transform(p))
        .multiply(flip)
        .multiply(transform(p.link));
    }
    function normal(p) {
      return B.Vector3.TransformNormal(B.Axis.Z, transform(p)).normalize();
    }
    function local(p, v) {
      return B.Vector3.TransformCoordinates(v, B.Matrix.Invert(transform(p)));
    }
    function inside(p, v, inset = 0) {
      const a = p.width / 2 - inset,
        b = p.height / 2 - inset;
      if (a <= 0 || b <= 0) return false;
      return p.shape === "ellipse"
        ? (v.x * v.x) / (a * a) + (v.y * v.y) / (b * b) <= 1 + 1e-6
        : Math.abs(v.x) <= a + 1e-6 && Math.abs(v.y) <= b + 1e-6;
    }
    function contour(p) {
      const points = [];
      if (p.shape === "rectangle")
        return [
          [-1, -1],
          [1, -1],
          [1, 1],
          [-1, 1],
        ].map(
          ([x, y]) => new B.Vector3((x * p.width) / 2, (y * p.height) / 2, 0),
        );
      for (let i = 0; i < 32; i++) {
        const a = (i / 32) * Math.PI * 2;
        points.push(
          new B.Vector3(
            (Math.cos(a) * p.width) / 2,
            (Math.sin(a) * p.height) / 2,
            0,
          ),
        );
      }
      return points;
    }
    // Polygon clipping interpolates UVs, so textured panels survive aperture rebuilding.
    function split(poly, n, d) {
      const positive = [],
        negative = [];
      for (let i = 0; i < poly.length; i++) {
        const a = poly[i],
          b = poly[(i + 1) % poly.length],
          da = B.Vector3.Dot(a.p, n) + d,
          db = B.Vector3.Dot(b.p, n) + d;
        if (da >= -1e-8) positive.push(a);
        if (da <= 1e-8) negative.push(a);
        if ((da > 1e-8 && db < -1e-8) || (da < -1e-8 && db > 1e-8)) {
          const t = da / (da - db),
            v = {
              p: B.Vector3.Lerp(a.p, b.p, t),
              u: a.u + (b.u - a.u) * t,
              v: a.v + (b.v - a.v) * t,
            };
          positive.push(v);
          negative.push(v);
        }
      }
      return { positive, negative };
    }
    function cut(poly, planes) {
      let insidePoly = poly;
      const result = [];
      for (const [n, d] of planes) {
        if (insidePoly.length < 3) break;
        const s = split(insidePoly, n, d);
        if (s.positive.length >= 3) result.push(s.positive);
        insidePoly = s.negative;
      }
      return result;
    }
    function hole(p) {
      const matrix = transform(p),
        points = contour(p).map((v) =>
          B.Vector3.TransformCoordinates(v, matrix),
        ),
        n = normal(p),
        planes = [];
      for (let i = 0; i < points.length; i++) {
        const a = points[i],
          b = points[(i + 1) % points.length],
          out = B.Vector3.Cross(b.subtract(a), n).normalize();
        planes.push([out, -B.Vector3.Dot(out, a)]);
      }
      planes.push([n, -B.Vector3.Dot(n, p.position) - epsilon]);
      const back = n.negate();
      planes.push([back, B.Vector3.Dot(n, p.position) - p.depth - epsilon]);
      return { points, n, planes };
    }
    // Subtract each convex aperture prism from a solid box, retaining disjoint
    // convex cells. Unlike a triangle mesh, these cells support native motion.
    function splitSolid(faces, n, d) {
      const positive = [], negative = [], cap = [];
      for (const face of faces) {
        const s = split(face.map((p) => ({ p, u: 0, v: 0 })), n, d);
        for (const [parts, result] of [[s.positive, positive], [s.negative, negative]]) {
          if (parts.length >= 3) result.push(parts.map((v) => v.p));
          for (const v of parts)
            if (Math.abs(B.Vector3.Dot(n, v.p) + d) < 1e-7 &&
                !cap.some((p) => B.Vector3.DistanceSquared(p, v.p) < 1e-14)) cap.push(v.p);
        }
      }
      if (cap.length >= 3 && positive.length && negative.length) {
        const center = cap.reduce((sum, p) => sum.add(p), B.Vector3.Zero()).scale(1 / cap.length);
        const u = B.Vector3.Cross(n, Math.abs(n.y) > 0.9 ? B.Axis.X : B.Axis.Y).normalize();
        const v = B.Vector3.Cross(n, u);
        cap.sort((a, b) => {
          const x = a.subtract(center), y = b.subtract(center);
          return Math.atan2(B.Vector3.Dot(x, v), B.Vector3.Dot(x, u)) -
            Math.atan2(B.Vector3.Dot(y, v), B.Vector3.Dot(y, u));
        });
        positive.push(cap);
        negative.push([...cap].reverse());
      }
      return { positive, negative };
    }
    function solidCells(surface, holes, world, inverse) {
      const half = V(surface.config.size).scale(0.5), vertices = [];
      for (const x of [-1, 1]) for (const y of [-1, 1]) for (const z of [-1, 1])
        vertices.push(B.Vector3.TransformCoordinates(new B.Vector3(x * half.x, y * half.y, z * half.z), world));
      let cells = [[
        [0, 1, 3, 2], [4, 6, 7, 5], [0, 4, 5, 1],
        [2, 3, 7, 6], [0, 2, 6, 4], [1, 5, 7, 3],
      ].map((indices) => indices.map((i) => vertices[i]))];
      for (const portal of holes) {
        const outside = [];
        for (const cell of cells) {
          let remainder = cell;
          for (const [n, d] of hole(portal).planes) {
            if (!remainder.length) break;
            const points = remainder.flat(), distances = points.map((p) => B.Vector3.Dot(n, p) + d);
            if (Math.min(...distances) >= -1e-8) { outside.push(remainder); remainder = []; break; }
            if (Math.max(...distances) <= 1e-8) continue;
            const s = splitSolid(remainder, n, d);
            if (s.positive.length) outside.push(s.positive);
            remainder = s.negative;
          }
        }
        cells = outside;
      }
      const scale = S.pose(B, surface.object).scale;
      return cells.map((faces) => {
        const unique = [];
        for (const p of faces.flat()) {
          const q = B.Vector3.TransformCoordinates(p, inverse).multiply(scale);
          if (!unique.some((v) => B.Vector3.DistanceSquared(q, v) < 1e-14)) unique.push(q);
        }
        return unique;
      }).filter((points) => {
        if (points.length < 4) return false;
        const a = points[0];
        return points.some((b) => points.some((c) => points.some((d) =>
          Math.abs(B.Vector3.Dot(b.subtract(a), B.Vector3.Cross(c.subtract(a), d.subtract(a)))) > 1e-10)));
      });
    }
    function rebuild(surface) {
      if (surface.entity.destroyed) return;
      const holes = [...portals.values()].filter(
          (p) => p.surface === surface && active(p),
        ),
        mesh = surface.object;
      if (!holes.length) {
        surface.original.applyToMesh(mesh, true);
        physics.replaceApertureGeometry(surface.entity, null);
        return;
      }
      const world = mesh.computeWorldMatrix(true),
        inverse = B.Matrix.Invert(world),
        polys = [];
      const original = surface.original;
      for (let i = 0; i < original.indices.length; i += 3) {
        let parts = [
          [0, 1, 2].map((k) => {
            const j = original.indices[i + k];
            return {
              p: B.Vector3.TransformCoordinates(
                new B.Vector3(...original.positions.slice(j * 3, j * 3 + 3)),
                world,
              ),
              u: original.uvs?.[j * 2] || 0,
              v: original.uvs?.[j * 2 + 1] || 0,
            };
          }),
        ];
        for (const p of holes)
          parts = parts.flatMap((poly) => cut(poly, hole(p).planes));
        polys.push(...parts);
      }
      for (const p of holes) {
        const h = hole(p);
        for (let i = 0; i < h.points.length; i++) {
          const a = h.points[i],
            b = h.points[(i + 1) % h.points.length],
            c = b.subtract(h.n.scale(p.depth)),
            d = a.subtract(h.n.scale(p.depth));
          polys.push(
            [a, b, c, d].map((p, k) => ({
              p,
              u: k === 1 || k === 2 ? 1 : 0,
              v: k >= 2 ? 1 : 0,
            })),
          );
        }
      }
      const positions = [],
        uvs = [],
        indices = [];
      for (const poly of polys) {
        const base = positions.length / 3;
        for (const v of poly) {
          const p = B.Vector3.TransformCoordinates(v.p, inverse);
          positions.push(p.x, p.y, p.z);
          uvs.push(v.u, v.v);
        }
        for (let k = 1; k < poly.length - 1; k++)
          indices.push(base, base + k, base + k + 1);
      }
      const normals = [];
      B.VertexData.ComputeNormals(positions, indices, normals);
      const data = new B.VertexData();
      Object.assign(data, { positions, normals, uvs, indices });
      data.applyToMesh(mesh, true);
      const scale = S.pose(B, mesh).scale,
        collision = positions.map(
          (v, i) => v * [scale.x, scale.y, scale.z][i % 3],
        );
      physics.replaceApertureGeometry(surface.entity, collision, indices,
        surface.config.motion === "static" ? null : solidCells(surface, holes, world, inverse));
    }
    function rebuildAll() {
      for (const s of [...surfaces.values()]) {
        if (s.entity.destroyed) {
          surfaces.delete(s.entity.id);
          for (const p of portals.values())
            if (p.surface === s) {
              p.surface = null;
              p.enabled = false;
            }
          continue;
        }
        try {
          physics.describe(s.entity);
        } catch {
          surfaces.delete(s.entity.id);
          continue;
        }
        rebuild(s);
      }
    }
    function surfaceSignature(pose) {
      return [
        pose.pos?.x ?? pose.position.x,
        pose.pos?.y ?? pose.position.y,
        pose.pos?.z ?? pose.position.z,
        pose.rot?.x ?? pose.rotation.x,
        pose.rot?.y ?? pose.rotation.y,
        pose.rot?.z ?? pose.rotation.z,
        pose.rot?.w ?? pose.rotation.w,
        pose.scale.x,
        pose.scale.y,
        pose.scale.z,
      ]
        .map((v) => v.toFixed(6))
        .join(",");
    }
    function addSurface(e, options, owner) {
      guard(owner); physics.assertMutable?.();
      valid(e);
      if (options.regions !== undefined && (!Array.isArray(options.regions) || !options.regions.length)) throw Error("Planar regions must be a nonempty array");
      if (surfaces.has(e.id)) throw Error("Surface already registered");
      const d = physics.describe(e);
      if (
        (d.config.shape !== "box" && !(d.config.shape === "mesh" && d.config.motion === "static" && options.regions?.length)) ||
        !d.object.getVerticesData?.(B.VertexBuffer.PositionKind)
      )
        throw Error("Portal surfaces require a box or a static mesh with planar regions");
      if (actors.has(e.id)) throw Error("A portal surface cannot also be a traveler");
      const object = d.object,
        original = B.VertexData.ExtractFromMesh(object, true, true),
        scale = d.pose.scale;
      if (object.getChildMeshes().length || object.skeleton)
        throw Error("Portal surface must be an individual mesh");
      if (options.regions && object.subMeshes?.length>1) throw Error("Planar portal mesh needs a single material/submesh");
      // Collision and visible geometry must describe the same solid slab.
      const bounds = object.getBoundingInfo().boundingBox.extendSize;
      if (d.config.shape === "box" && (
        ["x", "y", "z"].some(
          (k) => Math.abs(bounds[k] * 2 - d.config.size[k]) > 0.001,
        )
      ))
        throw Error("Surface visual/collision dimensions differ");
      if (d.config.shape === "box" && object.getBoundingInfo().boundingBox.center.length() > 0.001)
        throw Error("Surface box mesh must be centered on its collision origin");
      const faces = options.faces || ["+x", "-x", "+y", "-y", "+z", "-z"];
      if (
        !Array.isArray(faces) ||
        faces.some((f) => !["+x", "-x", "+y", "-y", "+z", "-z"].includes(f))
      )
        throw Error("Invalid portal surface faces");
      if (options.canPlace !== undefined && typeof options.canPlace !== "function") throw Error("Expected placement predicate");
      const regions = options.regions?.map(r => {
        if (typeof r.id !== "string" || !r.id || ![r.width,r.height,r.depth].every(v => Number.isFinite(v) && v > 0)) throw Error("Invalid planar region");
        const position = V(r.position), rotation = S.look(B,V(r.normal),V(r.up || {x:0,y:1,z:0})), matrix = B.Matrix.Compose(B.Vector3.One(),rotation,position), inverse = B.Matrix.Invert(matrix);
        // A region must be wholly covered by triangles on its front plane.
        // Clipped triangle areas make this independent of mesh tessellation.
        const planes = [[B.Axis.X,r.width/2],[B.Axis.X.negate(),r.width/2],[B.Axis.Y,r.height/2],[B.Axis.Y.negate(),r.height/2]];
        let area = 0;
        for (let i = 0; i < original.indices.length; i += 3) {
          let poly = [0,1,2].map(k => { const j=original.indices[i+k]; return {p:B.Vector3.TransformCoordinates(new B.Vector3(...original.positions.slice(j*3,j*3+3)),inverse),u:0,v:0}; });
          if (poly.some(v => Math.abs(v.p.z) > epsilon)) continue;
          for (const [n,d] of planes) poly = split(poly,n,d).positive;
          if (poly.length < 3) continue;
          for (let k=1;k<poly.length-1;k++) area += Math.abs(B.Vector3.Cross(poly[k].p.subtract(poly[0].p),poly[k+1].p.subtract(poly[0].p)).z)/2;
        }
        if (Math.abs(area-r.width*r.height) > epsilon * Math.max(1,r.width*r.height)) throw Error("Planar region is not covered by model geometry");
        return {...r,matrix};
      });
      if (regions && (d.config.motion !== "static" || new Set(regions.map(r=>r.id)).size !== regions.length)) throw Error("Planar model regions require unique IDs and a static body");
      const s = {
        entity: e,
        signature: surfaceSignature(d.pose),
        object,
        original,
        config: d.config,
        scale: scale.clone(),
        faces,
        regions,
        canPlace: options.canPlace,
        margin: S.number(
          options.margin ?? 0.02,
          0,
          10,
          "Invalid surface margin",
        ),
        collisionVertices: original.positions.map(
          (v, i) => v * [scale.x, scale.y, scale.z][i % 3],
        ),
      };
      surfaces.set(e.id, s);
      physics.lockGeometry?.(e,s);
      let off;
      const destroy = () => {
        if (!surfaces.has(e.id)) return;
        physics.assertMutable?.();
        for (const p of portals.values())
          if (p.surface === s) {
            evacuate(p);
            p.surface = null;
            p.enabled = false;
            p.sync();
          }
        if (!e.destroyed) {
          s.original.applyToMesh(object, true);
          try {
            physics.describe(e);
            physics.replaceApertureGeometry(e, null);
          } catch {}
        }
        surfaces.delete(e.id);
        if (!e.destroyed) { try { physics.lockGeometry?.(e,null); } catch {} }
        rebuildAll();
        off?.();
      };
      s.destroy = destroy;
      off = owner.track(destroy);
      return Object.freeze({ entity: e, destroy,
        setPlacementRule(fn) { guard(owner); if (!surfaces.has(e.id)) throw Error("Surface expired"); if (fn !== null && typeof fn !== "function") throw Error("Expected placement predicate"); s.canPlace=fn; },
      });
    }
    const shader = {
      vertexSource:
        "precision highp float; attribute vec3 position; uniform mat4 world; uniform mat4 worldViewProjection; varying vec4 screenPosition; varying vec3 worldPosition; void main(){vec4 p=vec4(position,1.0);screenPosition=worldViewProjection*p;worldPosition=(world*p).xyz;gl_Position=screenPosition;if(gl_Position.w>0.0)gl_Position.z=max(gl_Position.z,-gl_Position.w);}",
      fragmentSource:
        "precision highp float; varying vec4 screenPosition; varying vec3 worldPosition; uniform sampler2D portalView; uniform vec3 fallback; uniform vec4 clipping; uniform float clipEnabled; uniform float hasView; uniform float linearOutput; uniform vec2 portalSize; uniform float ellipse; uniform mat4 worldInverse; void main(){if(clipEnabled>0.5&&dot(vec4(worldPosition,1.0),clipping)>0.0)discard;vec3 p=(worldInverse*vec4(worldPosition,1.0)).xyz;if(ellipse>0.5&&dot(p.xy/portalSize*2.0,p.xy/portalSize*2.0)>1.0)discard;vec2 uv=screenPosition.xy/screenPosition.w*0.5+0.5;gl_FragColor=hasView>0.5?texture2D(portalView,uv):vec4(linearOutput>0.5?pow(fallback,vec3(2.2)):fallback,1.0);}",
    };
    function createPortal(options, owner) {
      guard(owner); physics.assertMutable?.();
      const id = options.id || "portal:" + ++serial;
      if (portals.has(id)) throw Error("Duplicate portal ID");
      const width = S.number(
          options.width ?? 1.8,
          0.1,
          100,
          "Invalid portal width",
        ),
        height = S.number(
          options.height ?? 2.6,
          0.1,
          100,
          "Invalid portal height",
        ),
        shape = options.shape || "ellipse";
      if (!["ellipse", "rectangle"].includes(shape))
        throw Error("Invalid portal shape");
      const position = V(options.position || { x: 0, y: 0, z: 0 }),
        rotation = Q(options.rotation || { x: 0, y: 0, z: 0, w: 1 });
      const mesh = B.MeshBuilder.CreatePlane(
        id + ":view",
        { width, height, sideOrientation: B.Mesh.DOUBLESIDE },
        scene,
      );
      mesh.isPickable = false;
      const material = new B.ShaderMaterial(id + ":material", scene, shader, {
        attributes: ["position"],
        uniforms: [
          "world",
          "worldViewProjection",
          "worldInverse",
          "fallback",
          "clipping",
          "clipEnabled",
          "hasView",
          "linearOutput",
          "portalSize",
          "ellipse",
        ],
        samplers: ["portalView"],
      });
      material.backFaceCulling = false;
      // Bias depth instead of shifting the aperture ahead of its traversal plane.
      // A geometric offset leaves a visible gap just before the eye crosses.
      material.zOffset = -1;
      material.setColor3(
        "fallback",
        B.Color3.FromHexString(options.color || "#236CFF"),
      );
      material.setFloat("hasView", 0);
      material.setVector2("portalSize", new B.Vector2(width, height));
      material.setFloat("ellipse", shape === "ellipse" ? 1 : 0);
      material.setFloat("clipEnabled", 0);
      mesh.material = material;
      const rimPath = contour({ width, height, shape });
      rimPath.push(rimPath[0].clone());
      const rim = B.MeshBuilder.CreateTube(
          id + ":rim",
          { path: rimPath, radius: 0.035, tessellation: 8 },
          scene,
        ),
        rimMaterial = new B.StandardMaterial(id + ":rim-material", scene);
      rimMaterial.disableLighting = true;
      rimMaterial.emissiveColor = B.Color3.FromHexString(
        options.color || "#236CFF",
      );
      rim.material = rimMaterial;
      rim.parent = mesh;
      rim.isPickable = false;
      const p = {
        id,
        width,
        height,
        shape,
        position,
        rotation,
        mesh,
        material,
        enabled: options.enabled !== false,
        dead: false,
        link: null,
        surface: null,
        depth: 0.2,
        view: null,
      };
      portals.set(id, p);
      let off;
      function sync() {
        mesh.position.copyFrom(p.position);
        mesh.rotationQuaternion = p.rotation.clone();
        mesh.setEnabled(p.enabled);
        material.setMatrix(
          "worldInverse",
          B.Matrix.Invert(mesh.computeWorldMatrix(true)),
        );
      }
      function destroy() {
        if (p.dead) return;
        physics.assertMutable?.();
        evacuate(p);
        p.dead = true;
        portals.delete(id);
        if (p.link) p.link.link = null;
        rebuildAll();
        mesh.dispose();
        material.dispose();
        rimMaterial.dispose();
        off?.();
      }
      off = owner.track(destroy);
      const check = () => {
        guard(owner);
        if (p.dead) throw Error("Portal destroyed");
      };
      const handle = {
        id,
        get width() {
          check();
          return p.width;
        },
        get height() {
          check();
          return p.height;
        },
        get shape() {
          check();
          return p.shape;
        },
        get enabled() {
          check();
          return p.enabled;
        },
        get linked() {
          check();
          return !!active(p);
        },
        getDestination() {
          check();
          return p.link && !p.link.dead ? p.link.handle : null;
        },
        getPose() {
          check();
          syncSurface(p.surface);
          return {
            position: S.plain(p.position),
            rotation: S.plainQ(p.rotation),
          };
        },
        setPose(pose) {
          check(); physics.assertMutable?.();
          if (p.dead) throw Error("Portal destroyed");
          const position = V(pose.position),
            rotation = Q(pose.rotation);
          evacuate(p);
          p.position = position;
          p.rotation = rotation;
          p.surface = null;
          sync();
          rebuildAll();
        },
        setEnabled(enabled) {
          check(); physics.assertMutable?.();
          if (!enabled) evacuate(p);
          p.enabled = !!enabled;
          sync();
          rebuildAll();
        },
        link(other) {
          check(); physics.assertMutable?.();
          const target = portals.get(
            typeof other === "string" ? other : other.id,
          );
          if (!target || target === p) throw Error("Invalid portal link");
          evacuate(p);
          evacuate(target);
          if (p.link) p.link.link = null;
          if (target.link) target.link.link = null;
          p.link = target;
          target.link = p;
          rebuildAll();
        },
        unlink() {
          check(); physics.assertMutable?.();
          evacuate(p);
          if (p.link) p.link.link = null;
          p.link = null;
          rebuildAll();
        },
        place(origin, direction, opts = {}) {
          check(); physics.assertMutable?.();
          const traced =
              opts.throughPortals === false
                ? null
                : trace(
                    origin,
                    direction,
                    { sensors: false, ignore: opts.ignore },
                    owner,
                  ),
            hit = traced
              ? traced.hit
              : physics.forOwner(owner).raycast(origin, direction, {
                  sensors: false,
                  ignore: opts.ignore,
                });
          if (traced?.truncated)
            return { placed: false, reason: "ray-hop-limit" };
          if (!hit) return { placed: false, reason: "no-hit" };
          const surface = surfaces.get(hit.entity.id);
          if (!surface)
            return { placed: false, reason: "surface-not-registered" };
          const pose = S.pose(B, surface.object),
            inv = B.Matrix.Invert(surface.object.getWorldMatrix()),
            point = V(hit.point),
            n = V(hit.normal).normalize(),
            localNormal = B.Vector3.TransformNormal(
              n,
              B.Matrix.Compose(
                B.Vector3.One(),
                pose.rotation.conjugate(),
                B.Vector3.Zero(),
              ),
            );
          let axis = "x";
          for (const k of ["y", "z"])
            if (Math.abs(localNormal[k]) > Math.abs(localNormal[axis]))
              axis = k;
          const region = surface.regions?.find(r => {
            const matrix=r.matrix.multiply(surface.object.getWorldMatrix()), inverse=B.Matrix.Invert(matrix), q=B.Vector3.TransformCoordinates(point,inverse),
              rn=B.Vector3.Cross(B.Vector3.TransformNormal(B.Axis.X,matrix),B.Vector3.TransformNormal(B.Axis.Y,matrix)).normalize();
            return Math.abs(q.z) <= epsilon && Math.abs(q.x)<=r.width/2 && Math.abs(q.y)<=r.height/2 && B.Vector3.Dot(rn,n)>0.999;
          });
          if (surface.regions && !region) return {placed:false,reason:"outside-planar-region"};
          if (!region && Math.abs(localNormal[axis]) < 0.999)
            return { placed: false, reason: "non-planar-face" };
          const face = (localNormal[axis] > 0 ? "+" : "-") + axis;
          if (!region && !surface.faces.includes(face))
            return { placed: false, reason: "face-disabled" };
          let up = V(opts.up || { x: 0, y: 1, z: 0 });
          if (traced)
            for (const id of traced.path)
              up = B.Vector3.TransformNormal(up, mapping(portals.get(id)));
          up = up.subtract(n.scale(B.Vector3.Dot(up, n)));
          if (up.lengthSquared() < 1e-8) {
            up = V(direction).negate();
            up = up.subtract(n.scale(B.Vector3.Dot(up, n)));
            if (up.lengthSquared() < 1e-8)
              up = B.Vector3.TransformNormal(
                axis === "y" ? B.Axis.Z : B.Axis.Y,
                B.Matrix.Compose(
                  B.Vector3.One(),
                  pose.rotation,
                  B.Vector3.Zero(),
                ),
              );
          }
          up.normalize();
          const rot = S.look(B, n, up),
            candidate = { ...p, position: point, rotation: rot };
          const footprint = contour(candidate).map(v=>B.Vector3.TransformCoordinates(v,transform(candidate))),
            regionWorld=region?.matrix.multiply(surface.object.getWorldMatrix()), regionInverse=regionWorld&&B.Matrix.Invert(regionWorld);
          for (const worldPoint of footprint) {
            if (region) {
              const q=B.Vector3.TransformCoordinates(worldPoint,regionInverse), mx=surface.margin/B.Vector3.TransformNormal(B.Axis.X,regionWorld).length(), my=surface.margin/B.Vector3.TransformNormal(B.Axis.Y,regionWorld).length();
              if (Math.abs(q.x)+mx>region.width/2 || Math.abs(q.y)+my>region.height/2) return {placed:false,reason:"outside-planar-region"};
              continue;
            }
            const q = B.Vector3.TransformCoordinates(
              worldPoint,
              inv,
            );
            for (const k of ["x", "y", "z"])
              if (
                k !== axis &&
                Math.abs(q[k]) + surface.margin / pose.scale[k] >
                  surface.config.size[k] / 2
              )
                return { placed: false, reason: "outside-surface" };
          }
          if (surface.canPlace && surface.canPlace(Object.freeze({entity:surface.entity,point:S.plain(point),normal:S.plain(n),footprint:footprint.map(S.plain),portal:p.handle,regionId:region?.id||null,subShape:hit.subShape})) !== true)
            return {placed:false,reason:"placement-policy"};
          for (const other of portals.values())
            if (other !== p && other.enabled && other.surface === surface) {
              const distance = point.subtract(other.position);
              if (
                distance.length() <
                (Math.hypot(p.width, p.height) +
                  Math.hypot(other.width, other.height)) /
                  2
              )
                return { placed: false, reason: "overlapping-portal" };
            }
          evacuate(p);
          p.position = point;
          p.rotation = rot;
          p.depth = region ? region.depth*Math.abs(B.Vector3.Dot(B.Vector3.TransformNormal(B.Axis.Z,regionWorld),n)) : surface.config.size[axis] * pose.scale[axis];
          p.surface = surface;
          p.attachment = {
            position: B.Vector3.TransformCoordinates(point, inv),
            rotation: pose.rotation.conjugate().multiply(rot).normalize(),
          };
          p.enabled = true;
          sync();
          rebuildAll();
          return {
            placed: true,
            surface: surface.entity,
            point: S.plain(point),
            normal: S.plain(n),
          };
        },
        mapPoint(point) {
          check();
          return S.plain(B.Vector3.TransformCoordinates(V(point), mapping(p)));
        },
        mapVector(vector) {
          check();
          return S.plain(B.Vector3.TransformNormal(V(vector), mapping(p)));
        },
        mapRotation(rotation) {
          check();
          const scale = new B.Vector3(),
            q = new B.Quaternion(),
            pos = new B.Vector3();
          mapping(p).decompose(scale, q, pos);
          return S.plainQ(q.multiply(Q(rotation)).normalize());
        },
        destroy,
      };
      p.handle = Object.freeze(handle);
      p.sync = sync;
      sync();
      return p.handle;
    }
    function trace(origin, direction, filter = {}, owner) {
      guard(owner);
      for (const surface of surfaces.values()) syncSurface(surface);
      let start = V(origin),
        delta = V(direction),
        remaining = delta.length();
      if (!Number.isFinite(remaining) || remaining < 1e-8) throw Error("Ray direction must have finite nonzero length");
      delta.normalize();
      const totalRange = remaining,
        segments = [],
        path = [],
        max = filter.maxHops ?? 8;
      S.number(max, 0, 32, "Invalid ray hop limit");
      if (!Number.isSafeInteger(max)) throw Error("Ray hop limit must be an integer");
      let distance = 0;
      for (let hop = 0; hop <= max; hop++) {
        const hit = physics
          .forOwner(owner)
          .raycast(S.plain(start), S.plain(delta.scale(remaining)), {
            ...filter,
            all: false,
          });
        let best = null;
        for (const p of portals.values())
          if (active(p)) {
            const a = local(p, start),
              d = B.Vector3.TransformNormal(
                delta,
                B.Matrix.Invert(transform(p)),
              );
            if (a.z < -epsilon || d.z >= -1e-8) continue;
            const t = -a.z / d.z;
            if (t < 0 || t > remaining) continue;
            const cross = a.add(d.scale(t));
            if (inside(p, cross) && (!best || t < best.t)) best = { p, t };
          }
        if (best && hop === max && (!hit || hit.distance >= best.t - epsilon)) {
          segments.push({
            origin: S.plain(start),
            end: S.plain(start.add(delta.scale(best.t))),
          });
          return { hit: null, segments, path, truncated: true };
        }
        if (!best || (hit && hit.distance < best.t - epsilon)) {
          const length = hit?.distance ?? remaining,
            end = start.add(delta.scale(length));
          segments.push({ origin: S.plain(start), end: S.plain(end) });
          return {
            hit: hit
              ? {
                  ...hit,
                  distance: distance + length,
                  fraction: (distance + length) / totalRange,
                }
              : null,
            segments,
            path,
            truncated: !!best && hop === max,
          };
        }
        const point = start.add(delta.scale(best.t)),
          m = mapping(best.p);
        segments.push({
          origin: S.plain(start),
          end: S.plain(point),
          portalId: best.p.id,
        });
        path.push(best.p.id);
        distance += best.t;
        remaining -= best.t;
        delta = B.Vector3.TransformNormal(delta, m).normalize();
        start = B.Vector3.TransformCoordinates(point, m).add(
          delta.scale(epsilon),
        );
        distance += Math.min(epsilon, remaining);
        remaining = Math.max(0, remaining - epsilon);
        if (remaining < 1e-8) {
          segments.push({ origin: S.plain(start), end: S.plain(start) });
          return { hit: null, segments, path, truncated: false };
        }
      }
    }
    function watch(e, config, owner) {
      guard(owner);
      valid(e);
      if (surfaces.has(e.id)) throw Error("A portal surface cannot also be a traveler");
      const state = physics.getState(e);
      if (!["dynamic", "character", "kinematic"].includes(state.kind))
        throw Error("Portal traveler needs moving physics");
      if (actors.has(e.id)) throw Error("Traveler already registered");
      S.number(config.visualMargin ?? 0.5, 0, 100, "Invalid portal visual margin");
      const r = {
        entity: e,
        owner,
        config: { ...config },
        last: null,
        crossings: 0,
        visual: null,
      };
      actors.set(e.id, r);
      let off;
      const destroy = () => {
        if (actors.get(e.id) === r) actors.delete(e.id);
        releaseVisual(r);
        off?.();
      };
      r.destroy = destroy;
      off = owner.track(destroy);
      return Object.freeze({ entity: e, destroy });
    }
    function watchAssembly(e, options, owner) {
      guard(owner);
      const entities = physics.connectedBodies(valid(e));
      const maxBodies = options.maxBodies ?? 32;
      if (!Number.isInteger(maxBodies) || maxBodies < 1 || maxBodies > 64)
        throw Error("Assembly body budget must be 1..64");
      if (entities.length > maxBodies) throw Error("Assembly body budget exceeded");
      // Validate the entire island before changing any registration.
      for (const body of entities) {
        if (physics.getState(body).kind !== "dynamic") throw Error("Portal assemblies require dynamic bodies without fixed-world anchors");
        if (actors.has(body.id) || surfaces.has(body.id)) throw Error("Assembly member already registered");
      }
      const token = {}, handles = [];
      try {
        for (const body of entities) {
          handles.push(watch(body, options, owner));
          actors.get(body.id).assembly = token;
        }
      } catch (error) { for (const handle of handles) handle.destroy(); throw error; }
      return Object.freeze({
        entities: Object.freeze([...entities]),
        destroy() { for (const handle of handles) handle.destroy(); },
      });
    }
    function publish(subscriptions, event, hook) {
      for (const sub of [...subscriptions])
        if (subscriptions.has(sub) && sub.owner.record.active) {
          try { sub.fn(event); }
          catch (error) { o.onError?.({ hook, error }); sub.off(); }
        }
    }
    function pushIslandFront(members, portal) {
      const n = normal(portal), moving = members.filter((e) => physics.getState(e).kind !== "static");
      const states = moving.map((e) => physics.getState(e));
      const clearance = Math.max(0, ...states.map((state) =>
        extent(state, n) + epsilon - local(portal, V(state.position)).z));
      for (let i = 0; i < moving.length; i++) {
        const position = V(states[i].position).add(n.scale(clearance));
        const velocity = V(states[i].velocity), incoming = B.Vector3.Dot(velocity.subtract(frameVelocity(portal, position)), n);
        if (incoming < 0) velocity.subtractInPlace(n.scale(incoming));
        physics.setState(moving[i], { position: S.plain(position), velocity: S.plain(velocity) });
        physics.cancelFrameTarget(moving[i]);
      }
      physics.syncEntities(moving.filter((e, i) => states[i].kind !== "character"));
    }
    function blockTraversal(entity, members, portal, reason) {
      pushIslandFront(members, portal);
      publish(blockedListeners, Object.freeze({ entity, entities: Object.freeze([...members]),
        source: portal.handle, destination: portal.link.handle, reason }), "portals.blocked");
    }
    function evacuate(portal) {
      if (!active(portal)) return;
      const processed = new Set();
      for (const r of actors.values())
        for (const p of [portal, portal.link]) {
          if (r.entity.destroyed || processed.has(r.entity.id)) continue;
          const state = physics.getState(r.entity),
            point = local(p, V(state.position)),
            n = normal(p),
            radius = extent(state, n);
          if (Math.abs(point.z) < radius + epsilon && fits(p, state, point)) {
            const members = state.kind === "character" ? [r.entity] : physics.connectedBodies(r.entity);
            pushIslandFront(members, p);
            for (const member of members) {
              processed.add(member.id);
              const actor = actors.get(member.id);
              if (actor) releaseVisual(actor);
            }
          }
        }
    }
    function extent(state, axis) {
      const matrix = B.Matrix.Compose(
          B.Vector3.One(),
          Q(state.rotation),
          B.Vector3.Zero(),
        ),
        a = B.Vector3.TransformNormal(axis, B.Matrix.Invert(matrix)),
        size = state.size;
      if (state.kind === "character" || state.shape === "capsule") {
        const radius = state.radius ?? size.x / 2;
        const height = state.height ?? size.y;
        return radius + Math.max(0.001, height / 2 - radius) * Math.abs(a.y);
      }
      if (state.shape === "sphere") return size.x / 2;
      if (state.shape === "convex" && state.points) return Math.max(...state.points.map(p=>p.x*a.x+p.y*a.y+p.z*a.z));
      if (!size) return 0.5;
      if (state.shape === "box") {
        const radius = state.convexRadius ?? Math.min(0.05, size.x / 4, size.y / 4, size.z / 4);
        return Math.abs(a.x) * (size.x / 2 - radius) +
          Math.abs(a.y) * (size.y / 2 - radius) +
          Math.abs(a.z) * (size.z / 2 - radius) + radius * a.length();
      }
      return (
        (Math.abs(a.x) * size.x) / 2 +
        (Math.abs(a.y) * size.y) / 2 +
        (Math.abs(a.z) * size.z) / 2
      );
    }
    function fits(p, state, point) {
      // Test against the same convex contour used to cut the native aperture.
      // A capsule is not its bounding rectangle: its rounded feet can fit the
      // ellipse even when the rectangle's nonexistent lower corners do not.
      const points = contour(p), mat = transform(p);
      for (let i = 0; i < points.length; i++) {
        const a = points[i], edge = points[(i + 1) % points.length].subtract(a);
        const n = new B.Vector3(edge.y, -edge.x, 0).normalize();
        const worldNormal = B.Vector3.TransformNormal(n, mat).normalize();
        if (B.Vector3.Dot(n, point) + extent(state, worldNormal) >
            B.Vector3.Dot(n, a) + epsilon) return false;
      }
      return true;
    }
    function materialTree(material) {
      return material
        ? [material, ...(material.subMaterials || []).flatMap(materialTree)]
        : [];
    }
    function textureSet(material) {
      return new Set(
        materialTree(material).flatMap((m) => m.getActiveTextures?.() || []),
      );
    }
    function cloneClipMaterial(original, name, ownedMaterials, ownedTextures) {
      const material = original.clone(name, true);
      if (!material) throw Error("Portal clipping material cannot be cloned");
      const existing = textureSet(original);
      for (const m of materialTree(material)) ownedMaterials.add(m);
      for (const t of textureSet(material))
        if (!existing.has(t)) ownedTextures.add(t);
      return material;
    }
    function releaseVisual(r) {
      const v = r.visual;
      if (!v) return;
      for (const item of v.source)
        if (!item.mesh.isDisposed() && item.mesh.material === item.material)
          item.mesh.material = item.original;
      v.clone.dispose(false, false);
      for (const material of v.materials) material.dispose(false, false);
      for (const texture of v.textures) texture.dispose();
      r.visual = null;
    }
    function updateVisuals() {
      maintenance();
      for (const r of [...actors.values()]) {
        if (r.entity.destroyed) {
          releaseVisual(r);
          continue;
        }
        const state = physics.getState(r.entity);
        let candidate = null;
        for (const p of portals.values())
          if (active(p)) {
            const point = local(p, V(state.position));
            if (
              point.z >= -epsilon &&
              point.z < extent(state, normal(p)) + (r.config.visualMargin ?? 0.5) + epsilon &&
              fits(p, state, point)
            ) {
              candidate = p;
              break;
            }
          }
        if (!candidate) {
          releaseVisual(r);
          continue;
        }
        if (!r.visual) {
          const object =
              o.getObject?.(r.entity.id) || physics.describe(r.entity).object,
            clone = object.clone("__portal:clone:" + r.entity.id, null, false),
            source = [],
            materials = new Set(),
            textures = new Set();
          if (!clone) continue;
          clone.isPickable = false;
          for (const mesh of [object, ...object.getChildMeshes()])
            if (mesh.material) {
              const original = mesh.material,
                material = cloneClipMaterial(
                  original,
                  "__portal:source:" + mesh.name,
                  materials,
                  textures,
                );
              if (material) {
                mesh.material = material;
                source.push({ mesh, original, material });
              }
            }
          const ghostMaterials = new Set();
          for (const mesh of [clone, ...clone.getChildMeshes()]) {
            mesh.isPickable = false;
            mesh.metadata = null;
            if (mesh.material) {
              const material = cloneClipMaterial(
                mesh.material,
                "__portal:ghost:" + mesh.name,
                materials,
                textures,
              );
              mesh.material = material;
              ghostMaterials.add(material);
            }
          }
          r.visual = { clone, source, materials, textures, ghostMaterials };
        }
        const v = r.visual,
          m = mapping(candidate),
          object =
            o.getObject?.(r.entity.id) || physics.describe(r.entity).object,
          world = object.computeWorldMatrix(true).multiply(m),
          scale = new B.Vector3(),
          q = new B.Quaternion(),
          pos = new B.Vector3();
        world.decompose(scale, q, pos);
        v.clone.position.copyFrom(pos);
        v.clone.rotationQuaternion = q;
        v.clone.scaling.copyFrom(scale);
        v.clone.setEnabled(object.isEnabled());
        const n = normal(candidate).negate(),
          exit = normal(candidate.link).negate(),
          sourcePlane = new B.Plane(
            n.x,
            n.y,
            n.z,
            -B.Vector3.Dot(n, candidate.position),
          ),
          exitPlane = new B.Plane(
            exit.x,
            exit.y,
            exit.z,
            -B.Vector3.Dot(exit, candidate.link.position),
          );
        const assign = (m, p) => {
          if (m.subMaterials) {
            for (const sub of m.subMaterials) if (sub) assign(sub, p);
          } else m.clipPlane = p;
        };
        for (const item of v.source) assign(item.material, sourcePlane);
        for (const material of v.ghostMaterials) assign(material, exitPlane);
      }
    }
    function exitContacts(r, state, dt) {
      if (state.sensor) return;
      const position = V(state.position),
        velocity = V(state.velocity);
      for (const p of portals.values())
        if (active(p)) {
          const point = local(p, position),
            distance = extent(state, normal(p));
          if (
            point.z < -epsilon ||
            point.z > distance + velocity.length() * dt ||
            !fits(p, state, point)
          )
            continue;
          const m = mapping(p),
            mapped = B.Vector3.TransformCoordinates(position, m),
            exitVelocity = mappedVelocity(p, position, velocity, m),
            scale = new B.Vector3(),
            rotation = new B.Quaternion(),
            translation = new B.Vector3();
          m.decompose(scale, rotation, translation);
          const q = rotation.multiply(Q(state.rotation)).normalize();
          const hits = physics.castBody(
            r.entity,
            S.plain(mapped),
            S.plainQ(q),
            S.plain(exitVelocity.scale(dt)),
            { ignore: [r.entity], sensors: false, group: state.group },
          );
          for (const hit of hits) {
            if (local(p.link, V(hit.point)).z < -epsilon) continue;
            const n = V(hit.normal),
              inverse = B.Matrix.Invert(m),
              contact = V(hit.point),
              sourcePoint = B.Vector3.TransformCoordinates(contact, inverse),
              sourceNormal = B.Vector3.TransformNormal(n, inverse).normalize();
            const source = physics.contactResponse(
                r.entity,
                S.plain(sourcePoint),
                S.plain(sourceNormal),
              ),
              target = physics.contactResponse(
                hit.entity,
                hit.point,
                hit.normal,
              );
            const mappedPointVelocity = mappedVelocity(p, sourcePoint, V(source.velocity), m),
              relative = B.Vector3.Dot(
                mappedPointVelocity.subtract(V(target.velocity)),
                n,
              ),
              denominator = source.inverseMass + target.inverseMass;
            if (relative >= 0 || denominator < 1e-10) continue;
            const restitution = Math.max(
                source.restitution,
                target.restitution,
              ),
              impulse = (-(1 + restitution) * relative) / denominator;
            physics.impulseAt(
              r.entity,
              S.plain(B.Vector3.TransformNormal(n.scale(impulse), inverse)),
              S.plain(sourcePoint),
            );
            physics.impulseAt(
              hit.entity,
              S.plain(n.scale(-impulse)),
              hit.point,
            );
            // Coulomb friction uses point velocity and world inertia on both sides.
            const nextSource = physics.contactResponse(
                r.entity,
                S.plain(sourcePoint),
                S.plain(sourceNormal),
              ),
              nextTarget = physics.contactResponse(
                hit.entity,
                hit.point,
                hit.normal,
              ),
              relativeVelocity = mappedVelocity(p, sourcePoint, V(nextSource.velocity), m).subtract(V(nextTarget.velocity)),
              tangent = relativeVelocity.subtract(
                n.scale(B.Vector3.Dot(relativeVelocity, n)),
              );
            if (tangent.lengthSquared() > 1e-10) {
              const speed = tangent.length();
              tangent.normalize();
              const localTangent = B.Vector3.TransformNormal(
                  tangent,
                  inverse,
                ).normalize(),
                a = physics.contactResponse(
                  r.entity,
                  S.plain(sourcePoint),
                  S.plain(localTangent),
                ),
                b = physics.contactResponse(
                  hit.entity,
                  hit.point,
                  S.plain(tangent),
                ),
                effective = a.inverseMass + b.inverseMass;
              if (effective > 1e-10) {
                const force = Math.min(
                  speed / effective,
                  Math.sqrt(source.friction * target.friction) * impulse,
                );
                physics.impulseAt(
                  r.entity,
                  S.plain(
                    B.Vector3.TransformNormal(tangent.scale(-force), inverse),
                  ),
                  S.plain(sourcePoint),
                );
                physics.impulseAt(
                  hit.entity,
                  S.plain(tangent.scale(force)),
                  hit.point,
                );
              }
            }
            if (!target.inverseMass) {
              const velocity = V(physics.getState(r.entity).velocity),
                relative = mappedVelocity(p, position, velocity, m).subtract(V(target.velocity)),
                incoming = B.Vector3.Dot(relative, n);
              if (incoming < 0)
                velocity.subtractInPlace(sourceNormal.scale(incoming));
              physics.setState(r.entity, { velocity: S.plain(velocity) });
            }
            if (hit.penetration > epsilon) {
              const push = B.Vector3.TransformNormal(
                n.scale(Math.min(hit.penetration, 0.25)),
                inverse,
              );
              physics.setState(r.entity, {
                position: S.plain(position.add(push)),
              });
            }
            break;
          }
        }
    }
    function maintenance() {
      for (const r of [...actors.values()]) {
        try {
          physics.getState(r.entity);
        } catch {
          r.destroy();
        }
      }
      for (const surface of [...surfaces.values()]) {
        let description;
        try {
          description = physics.describe(surface.entity);
        } catch {
          surface.destroy();
          continue;
        }
        if (B.Vector3.Distance(description.pose.scale, surface.scale) > 1e-4)
          throw Error("Registered portal surface scale changed: unregister before changing scale");
        if (surface.config.motion === "static" && surfaceSignature(description.pose) !== surface.signature)
          throw Error(
            "Registered portal surface moved: unregister, update collider, then register again",
          );
        syncSurface(surface);
      }
    }
    function syncSurface(surface) {
      if (!surface || surface.entity.destroyed) return;
      const pose = S.pose(B, surface.object), world = surface.object.computeWorldMatrix(true);
      for (const p of portals.values()) if (p.surface === surface && p.attachment) {
        p.position = B.Vector3.TransformCoordinates(p.attachment.position, world);
        p.rotation = pose.rotation.multiply(p.attachment.rotation).normalize();
        p.sync();
      }
    }
    function frameVelocity(p, point) {
      if (!p.surface || p.surface.config.motion === "static") return B.Vector3.Zero();
      return V(physics.contactResponse(p.surface.entity, S.plain(point), { x: 1, y: 0, z: 0 }).velocity);
    }
    function mappedVelocity(p, point, velocity, m = mapping(p)) {
      const destination = B.Vector3.TransformCoordinates(point, m);
      return B.Vector3.TransformNormal(velocity.subtract(frameVelocity(p, point)), m)
        .add(frameVelocity(p.link, destination));
    }
    function mappedAngular(p, angular, m) {
      const a = p.surface ? V(physics.getState(p.surface.entity).angularVelocity) : B.Vector3.Zero();
      const b = p.link.surface ? V(physics.getState(p.link.surface.entity).angularVelocity) : B.Vector3.Zero();
      return B.Vector3.TransformNormal(angular.subtract(a), m).add(b);
    }
    function beforeStep(dt) {
      for (const surface of surfaces.values()) syncSurface(surface);
      for (const p of portals.values()) p.previous = { position: p.position.clone(), rotation: p.rotation.clone() };
      for (const r of [...actors.values()]) {
        if (r.entity.destroyed) {
          r.destroy();
          continue;
        }
        try { r.last = physics.getState(r.entity); }
        catch { r.destroy(); continue; }
        if (r.last.kind === "character" || physics.connectedBodies(r.entity).length === 1)
          exitContacts(r, r.last, dt);
        r.last = physics.getState(r.entity);
      }
    }
    function afterStep() {
      for (const surface of surfaces.values()) syncSurface(surface);
      const processed = new Set();
      for (const r of [...actors.values()]) {
        if (r.entity.destroyed || actors.get(r.entity.id) !== r || !r.last || processed.has(r.entity.id)) continue;
        let state;
        try { state = physics.getState(r.entity); } catch { r.destroy(); continue; }
        const
          start = V(r.last.position),
          end = V(state.position);
        let selected = null;
        for (const p of portals.values())
          if (active(p)) {
            const a = local(p.previous || p, start),
              b = local(p, end);
            if (a.z < 0 || b.z >= 0 || a.z - b.z < 1e-9) continue;
            const t = a.z / (a.z - b.z),
              cross = B.Vector3.Lerp(a, b, t);
            if (inside(p, cross) && (!selected || t < selected.t))
              selected = { p, t, cross };
          }
        if (!selected) continue;
        const members = state.kind === "character" ? [r.entity] : physics.connectedBodies(r.entity);
        if (!fits(selected.p, state, selected.cross)) {
          for (const e of members) processed.add(e.id);
          blockTraversal(r.entity, members, selected.p, "traveler-does-not-fit");
          continue;
        }
        if (members.length > 1 && (!r.assembly || members.some((e) =>
          actors.get(e.id)?.assembly !== r.assembly || physics.getState(e).kind !== "dynamic"))) {
          for (const e of members) processed.add(e.id);
          blockTraversal(r.entity, members, selected.p, "joint-policy");
          continue;
        }
        if (members.length > 1) {
          for (const e of members) processed.add(e.id);
          traverseAssembly(r.entity, members, selected.p);
          continue;
        }
        const p = selected.p,
          m = mapping(p),
          position = B.Vector3.TransformCoordinates(end, m),
          velocity = mappedVelocity(p, end, V(state.velocity), m),
          angular = mappedAngular(p, V(state.angularVelocity), m),
          scale = new B.Vector3(),
          rotation = new B.Quaternion(),
          translation = new B.Vector3();
        m.decompose(scale, rotation, translation);
        let orientation = rotation.multiply(Q(state.rotation)).normalize();
        if (state.kind === "character" && r.config.keepUpright !== false) {
          const forward = B.Vector3.TransformNormal(
            B.Axis.Z,
            B.Matrix.Compose(B.Vector3.One(), orientation, B.Vector3.Zero()),
          );
          forward.y = 0;
          if (forward.lengthSquared() < 1e-8)
            orientation = S.look(B, S.horizontalForward(B, orientation), B.Axis.Y);
          else orientation = S.look(B, forward.normalize(), B.Axis.Y);
        }
        const crossWorld = B.Vector3.TransformCoordinates(selected.cross, transform(p));
        const mappedCross = B.Vector3.TransformCoordinates(crossWorld, m);
        if (!fits(p.link, { ...state, rotation: S.plainQ(orientation) }, local(p.link, mappedCross))) {
          processed.add(r.entity.id);
          blockTraversal(r.entity, members, p, "exit-does-not-fit");
          continue;
        }
        const z = local(p.link, position).z;
        if (z < epsilon) position.addInPlace(normal(p.link).scale(epsilon - z));
        physics.setState(r.entity, {
          position: S.plain(position),
          rotation: S.plainQ(orientation),
          velocity: S.plain(velocity),
          angularVelocity: S.plain(angular),
        });
        physics.warpFrame(r.entity, m);
        o.cameras?.warp(r.entity, m);
        r.crossings++;
        const event = Object.freeze({
          entity: r.entity,
          source: p.handle,
          destination: p.link.handle,
          position: S.plain(position),
          velocity: S.plain(velocity),
          matrix: Array.from(m.m),
        });
        publish(listeners, event, "portals.traverse");
      }
    }
    function traverseAssembly(trigger, members, p) {
      const m = mapping(p), q = new B.Quaternion(), destinationNormal = normal(p.link);
      m.decompose(new B.Vector3(), q, new B.Vector3());
      const states = members.map((e) => physics.getState(e));
      const mapped = states.map((state) => ({
        ...state,
        position: S.plain(B.Vector3.TransformCoordinates(V(state.position), m)),
        rotation: S.plainQ(q.multiply(Q(state.rotation)).normalize()),
        velocity: S.plain(mappedVelocity(p, V(state.position), V(state.velocity), m)),
        angularVelocity: S.plain(mappedAngular(p, V(state.angularVelocity), m)),
      }));
      if (states.some((state, i) => !fits(p, state, local(p, V(state.position))) ||
          !fits(p.link, mapped[i], local(p.link, V(mapped[i].position))))) {
        blockTraversal(trigger, members, p, "assembly-too-large");
        return;
      }
      // Whole-island transport clears the entire assembly beyond the exit plane.
      // This is intentionally atomic; it never leaves a native joint spanning rooms.
      const clearance = Math.max(0, ...mapped.map((state) =>
        extent(state, destinationNormal) + epsilon - local(p.link, V(state.position)).z));
      const offset = destinationNormal.scale(clearance);
      for (let i = 0; i < members.length; i++) {
        const hits = physics.castBody(members[i], mapped[i].position, mapped[i].rotation,
          S.plain(offset), { ignore: members, sensors: false, group: states[i].group });
        if (hits.some((hit) => local(p.link, V(hit.point)).z >= -epsilon)) {
          blockTraversal(trigger, members, p, "assembly-exit-obstructed");
          return;
        }
      }
      // Perform every state write before callbacks can inspect the transported island.
      const total = m.multiply(B.Matrix.Translation(offset.x, offset.y, offset.z));
      for (let i = 0; i < members.length; i++) {
        mapped[i].position = S.plain(V(mapped[i].position).add(offset));
        physics.setState(members[i], mapped[i]);
        physics.warpFrame(members[i], total);
        o.cameras?.warp(members[i], total);
        actors.get(members[i].id).crossings++;
      }
      physics.syncEntities(members);
      const entities = Object.freeze([...members]);
      for (let i = 0; i < members.length; i++)
        publish(listeners, Object.freeze({ entity: members[i], entities, source: p.handle,
          destination: p.link.handle, position: { ...mapped[i].position },
          velocity: { ...mapped[i].velocity }, matrix: Array.from(total.m) }), "portals.traverse");
    }
    // Native steps remain at most 1/240 s while travelers approach a portal; split faster motion further.
    function step(dt) {
      guard();
      if (!Number.isFinite(dt) || dt <= 0) throw Error("Invalid portal step duration");
      maintenance();
      physics.beginFrame(dt);
      try {
        let remaining = dt,
          count = 0;
        while (remaining > 1e-8) {
          let quantum = remaining;
          if (actors.size && [...portals.values()].some(active)) {
            quantum = Math.min(quantum, traversalLimits.maxStepTime);
            for (const r of actors.values()) {
              if (r.entity.destroyed) continue;
              const s = physics.getState(r.entity),
                v = V(s.velocity).length();
              if (v > 0) quantum = Math.min(quantum, traversalLimits.maxTravelDistance / v);
            }
          }
          if (++count > traversalLimits.maxSubSteps)
            throw Error("Portal traversal substep budget exceeded");
          beforeStep(quantum);
          physics.step(Math.min(remaining, quantum));
          afterStep();
          remaining -= quantum;
        }
      } finally { physics.endFrame(); }
    }
    function target(index, width, height) {
      const linear = !!scene._arkglideRendering?.linearOutput();
      const caps = scene.getEngine().getCaps();
      const type = linear && caps.textureHalfFloatRender && caps.textureHalfFloatLinearFiltering
        ? B.Constants.TEXTURETYPE_HALF_FLOAT
        : linear && caps.textureFloatRender && caps.textureFloatLinearFiltering ? B.Constants.TEXTURETYPE_FLOAT : B.Constants.TEXTURETYPE_UNSIGNED_BYTE;
      let v = views[index];
      if (v && (v.width !== width || v.height !== height || v.type !== type || v.linear !== linear)) {
        v.texture.dispose();
        v.camera.dispose();
        v = null;
      }
      if (!v) {
        const camera = new B.FreeCamera(
          "__portal:view:" + index,
          B.Vector3.Zero(),
          scene,
        );
        camera.inputs.clear();
        const texture = new B.RenderTargetTexture(
          "__portal:target:" + index,
          { width, height },
          scene,
          false,
          true,
          type,
          false,
          B.Texture.BILINEAR_SAMPLINGMODE,
          true,
          false,
        );
        texture.activeCamera = camera;
        if (o.renderCompute) texture.getCustomRenderList = (_pass, list, length) =>
          scene.activeCamera === camera ? o.renderCompute.select(list, scene.frustumPlanes, length) : null;
        texture.ignoreCameraViewport = true;
        texture.gammaSpace = !linear;
        texture.renderParticles = false;
        texture.samples = Math.min(quality.samples, Math.max(1, scene.getEngine().getCaps().maxMSAASamples || 1));
        v = { camera, texture, width, height, type, linear };
        views[index] = v;
      }
      return v;
    }
    function snapshot() {
      return [...portals.values()].map((p) => ({
        p,
        view: p.view,
        enabled: p.mesh.isEnabled(),
      }));
    }
    function setView(p, view) {
      p.view = view;
      p.material.setFloat("hasView", view ? 1 : 0);
      if (view) p.material.setTexture("portalView", view);
    }
    function render() {
      if (disposed || rendering || !scene.activeCamera) return;
      scene._arkglideRendering?.prepareFrame();
      for (const p of portals.values()) p.material.setFloat("linearOutput", scene._arkglideRendering?.linearOutput() ? 1 : 0);
      rendering = true;
      renderCount = 0;
      const main = scene.activeCamera,
        engine = scene.getEngine(),
        // Read the main framebuffer size before recursive RTTs bind their own.
        width = engine.getRenderWidth(true) * quality.scale,
        height = engine.getRenderHeight(true) * quality.scale,
        maxSize = engine.getCaps().maxTextureSize || 4096,
        oldClip = scene.clipPlane,
        oldClip2 = scene.clipPlane2;
      function visit(camera, depth, exit) {
        const result = new Map();
        const pose = S.pose(B, camera);
        for (const p of portals.values())
          if (
            active(p) &&
            p !== exit &&
            B.Vector3.Dot(pose.position.subtract(p.position), normal(p)) > 0
          ) {
            if (renderCount >= quality.maxViews) break;
            const levelScale = Math.pow(quality.recursiveScale, quality.depth - depth),
              sizeScale = Math.min(levelScale, maxSize / width, maxSize / height),
              view = target(renderCount++, Math.max(1, Math.round(width * sizeScale)), Math.max(1, Math.round(height * sizeScale))),
              m = mapping(p),
              rotation = B.Quaternion.Identity(),
              scale = new B.Vector3(),
              translation = new B.Vector3();
            m.decompose(scale, rotation, translation);
            S.write(
              B,
              view.camera,
              S.plain(B.Vector3.TransformCoordinates(pose.position, m)),
              S.plainQ(rotation.multiply(pose.rotation)),
            );
            view.camera.fov = camera.fov;
            view.camera.fovMode = camera.fovMode;
            view.camera.minZ = Math.min(camera.minZ, 0.01);
            view.camera.maxZ = camera.maxZ;
            const children =
                depth > 1 ? visit(view.camera, depth - 1, p.link) : new Map(),
              saved = snapshot();
            try {
              for (const q of portals.values()) {
                setView(q, children.get(q) || null);
                q.mesh.setEnabled(q.enabled && q !== p.link);
              }
              const n = normal(p.link).negate(),
                d = -B.Vector3.Dot(n, p.link.position) - epsilon;
              scene.clipPlane2 = new B.Plane(n.x, n.y, n.z, d);
              for (const q of portals.values()) {
                q.material.setVector4(
                  "clipping",
                  new B.Vector4(n.x, n.y, n.z, d),
                );
                q.material.setFloat("clipEnabled", 1);
              }
              view.texture.renderList = scene.meshes.filter(
                (mesh) => mesh.isEnabled() && !mesh.isDisposed(),
              );
              view.texture.render(false, false);
              result.set(p, view.texture);
            } finally {
              for (const x of saved) {
                setView(x.p, x.view);
                x.p.mesh.setEnabled(x.enabled);
              }
            }
          }
        return result;
      }
      try {
        const result = visit(main, quality.depth, null);
        for (const p of portals.values()) setView(p, result.get(p) || null);
      } finally {
        scene.clipPlane = oldClip;
        scene.clipPlane2 = oldClip2;
        scene.activeCamera = main;
        for (const p of portals.values()) {
          p.material.setFloat("clipEnabled", 0);
          p.mesh.setEnabled(p.enabled);
        }
        scene.updateTransformMatrix(true);
        rendering = false;
      }
    }
    o.cameras?.setViewResolver?.((entity, position, rotation) => {
      if (disposed || !actors.has(entity.id)) return null;
      let state;
      try { state = physics.getState(entity); }
      catch { actors.get(entity.id)?.destroy(); return null; }
      const center = V(state.position);
      for (const p of portals.values()) if (active(p)) {
        const a = local(p, center), b = local(p, position);
        if (a.z < -epsilon || b.z >= 0 || a.z - b.z <= epsilon) continue;
        if (!inside(p, B.Vector3.Lerp(a, b, a.z / (a.z - b.z)))) continue;
        const m = mapping(p), q = new B.Quaternion();
        m.decompose(new B.Vector3(), q, new B.Vector3());
        return { position: B.Vector3.TransformCoordinates(position, m), rotation: q.multiply(rotation).normalize(), path: [p.id] };
      }
      return null;
    });
    const projection = root.ArkGlidePortalProjection?.create(B,{S,V,Q,guard,portals,physics,mapping,active,local,transform,contour,inside,fits,extent,normal,tolerance:epsilon});
    function captureState(key) {
      for(const s of surfaces.values())syncSurface(s);
      return [...portals.values()].map(p=>({id:p.id,width:p.width,height:p.height,shape:p.shape,enabled:p.enabled,link:p.link?.id||null,
        position:S.plain(p.position),rotation:S.plainQ(p.rotation),depth:p.depth||0,surface:p.surface?key(p.surface.entity):null,
        attachment:p.attachment?{position:S.plain(p.attachment.position),rotation:S.plainQ(p.attachment.rotation)}:null}));
    }
    function validateState(state,resolve) {
      if(!Array.isArray(state)||state.length!==portals.size||new Set(state.map(p=>p.id)).size!==state.length)throw Error("Portal checkpoint topology differs");
      for(const saved of state){
        const p=portals.get(saved.id);if(!p||p.width!==saved.width||p.height!==saved.height||p.shape!==saved.shape||typeof saved.enabled!=="boolean"||!Number.isFinite(saved.depth)||saved.depth<0)throw Error("Portal checkpoint definition differs");
        S.vec(saved.position);S.quat(saved.rotation);
        if(saved.surface&&(!saved.attachment||!surfaces.has(resolve(saved.surface)?.id)))throw Error("Portal checkpoint surface absent");
        if(saved.attachment){S.vec(saved.attachment.position);S.quat(saved.attachment.rotation);}
        if(saved.link&&(!state.some(q=>q.id===saved.link&&q.link===saved.id)||saved.link===saved.id))throw Error("Portal checkpoint link invalid");
      }
    }
    function restoreState(state,resolve) {
      validateState(state,resolve);
      for(const saved of state){const p=portals.get(saved.id);p.position=V(saved.position);p.rotation=Q(saved.rotation);p.depth=saved.depth;p.surface=saved.surface?surfaces.get(resolve(saved.surface).id):null;
        p.attachment=saved.attachment?{position:V(saved.attachment.position),rotation:Q(saved.attachment.rotation)}:null;p.enabled=saved.enabled;p.link=saved.link?portals.get(saved.link):null;p.sync();}
      rebuildAll();
      for(const r of actors.values()){releaseVisual(r);r.last=physics.getState(r.entity);}
    }
    return {
      captureState,validateState,restoreState,
      viewPath: (entity, origin) => o.cameras?.getViewPath?.(entity, origin) || [],
      forOwner(owner) {
        guard(owner);
        return Object.freeze({
          create: (options) => createPortal(options || {}, owner),
          get(id) {
            guard(owner);
            return portals.get(id)?.handle || null;
          },
          addSurface: (e, options = {}) => addSurface(e, options, owner),
          watch: (e, config = {}) => watch(e, config, owner),
          watchAssembly: (e, options = {}) => watchAssembly(e, options, owner),
          raycast: (origin, direction, filter) =>
            trace(origin, direction, filter, owner),
          shapeCast(shape,origin,direction,filter) {
            if(!projection)throw Error("Portal projection runtime not loaded");
            return projection.shapeCast(owner,shape,origin,direction,filter);
          },
          projectVolume(options) {
            if(!projection)throw Error("Portal projection runtime not loaded");
            return projection.project(owner,options);
          },
          setProjectionLimits(limits) { guard(owner); if(!projection)throw Error("Portal projection runtime not loaded"); projection.setLimits(limits); },
          getTraversalLimits() { guard(owner); return { ...traversalLimits }; },
          setTraversalLimits(patch) {
            guard(owner);
            if (!patch || typeof patch !== "object" || Array.isArray(patch)) throw Error("Invalid traversal limits");
            for (const [key, value] of Object.entries(patch)) {
              if (!Object.hasOwn(traversalLimits, key) || !Number.isFinite(value) || value <= 0 ||
                  (key === "maxSubSteps" && !Number.isSafeInteger(value))) throw Error("Invalid traversal limit: " + key);
            }
            traversalLimits = { ...traversalLimits, ...patch };
          },
          onTraverse(fn) {
            guard(owner);
            if (typeof fn !== "function")
              throw Error("Expected traversal callback");
            const s = { owner, fn };
            listeners.add(s);
            s.off = owner.track(() => listeners.delete(s));
            return s.off;
          },
          onBlocked(fn) {
            guard(owner);
            if (typeof fn !== "function") throw Error("Expected portal blocked callback");
            const s = { owner, fn };
            blockedListeners.add(s);
            s.off = owner.track(() => blockedListeners.delete(s));
            return s.off;
          },
          setQuality(config) {
            guard(owner);
            const next = { ...quality, ...config };
            if (
              !Number.isInteger(next.depth) ||
              !Number.isInteger(next.maxViews)
            )
              throw Error("Portal quality needs integer budgets");
            S.number(next.depth, 1, 5, "Invalid recursion depth");
            S.number(next.scale, 0.1, 2, "Invalid render scale");
            S.number(next.recursiveScale, 0.1, 1, "Invalid recursive render scale");
            if (!Number.isInteger(next.samples) || ![1, 2, 4, 8].includes(next.samples))
              throw Error("Invalid portal sample count");
            S.number(next.maxViews, 1, 64, "Invalid view budget");
            quality = next;
            for (const p of portals.values()) setView(p, null);
            for (const v of views) {
              v?.texture.dispose();
              v?.camera.dispose();
            }
            views.length = 0;
          },
        });
      },
      step,
      render,
      updateVisuals,
      stats: () => ({
        portals: portals.size,
        portalSurfaces: surfaces.size,
        portalTravelers: actors.size,
        portalClones: [...actors.values()].filter((r) => r.visual).length,
        portalViews: views.filter(Boolean).length,
        portalRenderedViews: renderCount,
        portalTraversals: [...actors.values()].reduce(
          (n, r) => n + r.crossings,
          0,
        ),
      }),
      dispose() {
        if (disposed) return;
        o.cameras?.setViewResolver?.(null);
        for (const r of actors.values()) releaseVisual(r);
        for (const p of [...portals.values()]) p.handle.destroy();
        for (const s of [...surfaces.values()]) s.destroy();
        for (const v of views) {
          v?.texture.dispose();
          v?.camera.dispose();
        }
        views.length = 0;
        renderCount = 0;
        surfaces.clear();
        actors.clear();
        listeners.clear();
        blockedListeners.clear();
        disposed = true;
      },
    };
  }
  root.ArkGlidePortals = { create };
})(globalThis);
