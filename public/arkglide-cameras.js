(function (root) {
  "use strict";
  function create(B, o) {
    const S = root.ArkGlideSpatial,
      scene = o.scene,
      records = new Map(),
      rigs = new Set();
    let disposed = false,
      serial = 0;
    const vector = (p) => {
      S.vec(p);
      return new B.Vector3(p.x, p.y, p.z);
    };
    function valid(e) {
      if (!e || e.destroyed || o.find(e.id) !== e)
        throw Error("Invalid camera target");
      return o.getObject(e.id);
    }
    function check() {
      if (disposed) throw Error("Camera session stopped");
    }
    function resource(id) {
      const camera = records.get(id)?.camera || o.getCamera?.(id);
      return camera?.getViewMatrix ? camera : null;
    }
    function handle(camera, id, owner, owned = false) {
      const guard = () => {
        check();
        if (!owner.record.active || camera.isDisposed())
          throw Error("Camera handle expired");
      };
      const h = {
        id,
        getPose() {
          guard();
          const p = S.pose(B, camera);
          return {
            position: S.plain(p.position),
            rotation: S.plainQ(p.rotation),
          };
        },
        setPose(p) {
          guard();
          S.write(B, camera, p.position, p.rotation);
        },
        lookAt(p, up = { x: 0, y: 1, z: 0 }) {
          guard();
          const pos = S.pose(B, camera).position,
            d = vector(p).subtract(pos);
          if (d.lengthSquared() < 1e-12)
            throw Error("Look target equals camera position");
          const u = vector(up).normalize();
          if (B.Vector3.Cross(d, u).lengthSquared() < 1e-10)
            throw Error("Look direction parallel to up");
          S.write(
            B,
            camera,
            S.plain(pos),
            S.plainQ(S.look(B, d.normalize(), u)),
          );
        },
        setLens(lens) {
          guard();
          const next = {
            fov: (camera.fov * 180) / Math.PI,
            near: camera.minZ,
            far: camera.maxZ,
            ...lens,
          };
          S.number(next.fov, 1, 179, "Invalid FOV");
          S.number(next.near, 0.001, 1000, "Invalid near plane");
          S.number(next.far, next.near + 0.001, 1e7, "Invalid far plane");
          camera.fov = (next.fov * Math.PI) / 180;
          camera.minZ = next.near;
          camera.maxZ = next.far;
        },
        getLens() {
          guard();
          return {
            fov: (camera.fov * 180) / Math.PI,
            near: camera.minZ,
            far: camera.maxZ,
          };
        },
        ray(x = 0.5, y = 0.5, length = 1000) {
          guard();
          S.number(x, 0, 1, "Invalid screen x");
          S.number(y, 0, 1, "Invalid screen y");
          S.number(length, 0.001, 1e7, "Invalid ray length");
          const engine = scene.getEngine();
          camera.getViewMatrix(true);
          camera.getProjectionMatrix(true);
          const ray = scene.createPickingRay(
            x * engine.getRenderWidth(),
            y * engine.getRenderHeight(),
            B.Matrix.Identity(),
            camera,
          );
          return {
            origin: S.plain(ray.origin),
            direction: S.plain(ray.direction.scale(length)),
          };
        },
        destroy() {
          if (owned) records.get(id)?.destroy();
        },
      };
      return Object.freeze(h);
    }
    function createCamera(options, owner) {
      check();
      const id = options.id || "camera:" + ++serial;
      if (resource(id)) throw Error("Duplicate camera ID");
      const position = vector(options.position || { x: 0, y: 0, z: 0 });
      if (options.rotation) S.quat(options.rotation);
      const camera = new B.FreeCamera(id, position, scene);
      camera.inputs.clear();
      camera.rotationQuaternion = B.Quaternion.Identity();
      if (options.rotation) S.quat(options.rotation);
      if (options.rotation)
        camera.rotationQuaternion = new B.Quaternion(
          options.rotation.x,
          options.rotation.y,
          options.rotation.z,
          options.rotation.w,
        );
      let untrack;
      const r = {
        camera,
        destroy() {
          if (!records.has(id)) return;
          if (scene.activeCamera === camera) scene.activeCamera = o.fallback();
          camera.dispose();
          records.delete(id);
          untrack?.();
        },
      };
      records.set(id, r);
      untrack = owner.track(r.destroy);
      const h = handle(camera, id, owner, true);
      try {
        h.setLens({
          ...options,
          fov: options.fov ?? 60,
          near: options.near ?? 0.05,
          far: options.far ?? 10000,
        });
        if (options.active !== false) scene.activeCamera = camera;
        return h;
      } catch (error) {
        r.destroy();
        throw error;
      }
    }
    function createRig(config, owner) {
      check();
      const modes = ["firstPerson", "thirdPerson", "observer", "fixed"];
      if (!modes.includes(config.mode || "firstPerson"))
        throw Error("Invalid camera rig mode");
      if (config.target) valid(config.target);
      if (config.viewpoint) valid(config.viewpoint);
      if (config.mode === "observer" && !config.viewpoint)
        throw Error("Observer camera needs viewpoint");
      const h = createCamera(config, owner),
        cam = resource(h.id);
      let mode = config.mode || "firstPerson",
        rotation = config.rotation
          ? new B.Quaternion(
              config.rotation.x,
              config.rotation.y,
              config.rotation.z,
              config.rotation.w,
            )
          : B.Quaternion.Identity();
      const eyeOffset = vector(
          config.eyeOffset ||
            (mode === "firstPerson" ? config.offset : null) || {
              x: 0,
              y: 0.7,
              z: 0,
            },
        ),
        followOffset = vector(
          config.followOffset ||
            (mode === "thirdPerson" ? config.offset : null) || {
              x: 0,
              y: 1,
              z: -4,
            },
        ),
        observerOffset = vector(
          config.observerOffset ||
            (mode === "observer" ? config.offset : null) || {
              x: 0,
              y: 0,
              z: 0,
            },
        );
      const uprightSpeed = S.number(
        config.uprightSpeed ?? 0,
        0,
        100,
        "Invalid upright speed",
      );
      const sensitivity = S.number(
          config.sensitivity ?? 0.002,
          0,
          1,
          "Invalid sensitivity",
        ),
        pitchLimit =
          (S.number(config.pitchLimit ?? 89, 1, 89.9, "Invalid pitch limit") *
            Math.PI) /
          180,
        radius = S.number(
          config.collisionRadius ?? 0.15,
          0.01,
          10,
          "Invalid camera collision radius",
        );
      let live = true,
        untrack;
      const guard = () => {
        if (!live || !owner.record.active || disposed)
          throw Error("Rig handle expired");
      };
      const r = {
        target: config.target,
        camera: cam,
        warp(matrix) {
          const scale = new B.Vector3(),
            q = new B.Quaternion(),
            p = new B.Vector3();
          matrix.decompose(scale, q, p);
          rotation = q.multiply(rotation).normalize();
        },
        update(dt = 0) {
          if (!live) return;
          if (uprightSpeed && dt > 0) {
            const forward = B.Vector3.TransformNormal(
              B.Axis.Z,
              B.Matrix.Compose(B.Vector3.One(), rotation, B.Vector3.Zero()),
            );
            let desired = forward;
            if (Math.abs(forward.y) >= 0.999) {
              const right = B.Vector3.TransformNormal(
                B.Axis.X,
                B.Matrix.Compose(B.Vector3.One(), rotation, B.Vector3.Zero()),
              );
              desired = B.Vector3.Cross(right, B.Axis.Y).normalize();
            }
            rotation = B.Quaternion.Slerp(
              rotation,
              S.look(B, desired, B.Axis.Y),
              Math.min(1, uprightSpeed * dt),
            );
          }
          if (config.target?.destroyed || config.viewpoint?.destroyed) {
            r.destroy();
            return;
          }
          const offset =
            mode === "thirdPerson"
              ? followOffset
              : mode === "observer"
                ? observerOffset
                : eyeOffset;
          if (mode === "fixed") return;
          if (mode === "observer") {
            const p = S.pose(B, valid(config.viewpoint));
            S.write(
              B,
              cam,
              S.plain(
                p.position.add(
                  B.Vector3.TransformCoordinates(
                    offset,
                    B.Matrix.Compose(
                      B.Vector3.One(),
                      p.rotation,
                      B.Vector3.Zero(),
                    ),
                  ),
                ),
              ),
              S.plainQ(p.rotation),
            );
            if (config.target && config.lookAtTarget !== false)
              h.lookAt(config.target.getWorldPosition());
            return;
          }
          const target = config.target;
          if (!target) throw Error("Following camera needs target");
          const p = vector(target.getWorldPosition());
          let position;
          if (mode === "firstPerson") position = p.add(offset);
          else {
            const anchor = p.add(
                vector(config.pivotOffset || { x: 0, y: 0.7, z: 0 }),
              ),
              delta = B.Vector3.TransformNormal(
                offset,
                B.Matrix.Compose(B.Vector3.One(), rotation, B.Vector3.Zero()),
              );
            position = anchor.add(delta);
            if (config.collision !== false && o.physics) {
              const hit = o.physics.shapeCast(
                { kind: "sphere", radius },
                S.plain(anchor),
                S.plain(delta),
                { ignore: [target], sensors: false },
              );
              if (hit)
                position = anchor.add(
                  delta.scale(Math.max(0, hit.fraction - 0.01)),
                );
            }
          }
          S.write(B, cam, S.plain(position), S.plainQ(rotation));
        },
        destroy() {
          if (!live) return;
          live = false;
          rigs.delete(r);
          h.destroy();
          untrack?.();
        },
      };
      rigs.add(r);
      untrack = owner.track(r.destroy);
      const result = {
        camera: h,
        look(dx, dy) {
          guard();
          S.number(dx, -1e6, 1e6, "Invalid look x");
          S.number(dy, -1e6, 1e6, "Invalid look y");
          const yaw = B.Quaternion.RotationAxis(B.Axis.Y, dx * sensitivity),
            candidate = yaw
              .multiply(rotation)
              .multiply(B.Quaternion.RotationAxis(B.Axis.X, dy * sensitivity))
              .normalize();
          const f = B.Vector3.TransformNormal(
            B.Axis.Z,
            B.Matrix.Compose(B.Vector3.One(), candidate, B.Vector3.Zero()),
          );
          if (Math.abs(Math.asin(Math.max(-1, Math.min(1, f.y)))) <= pitchLimit)
            rotation = candidate;
          else rotation = yaw.multiply(rotation).normalize();
        },
        direction(x, z) {
          guard();
          S.number(x, -1, 1, "Invalid movement x");
          S.number(z, -1, 1, "Invalid movement z");
          const matrix = B.Matrix.Compose(
              B.Vector3.One(),
              mode === "observer" || mode === "fixed"
                ? S.pose(B, cam).rotation
                : rotation,
              B.Vector3.Zero(),
            ),
            forward = B.Vector3.TransformNormal(B.Axis.Z, matrix);
          forward.y = 0;
          if (forward.lengthSquared() < 1e-8)
            forward.copyFrom(S.horizontalForward(B,
              mode === "observer" || mode === "fixed" ? S.pose(B, cam).rotation : rotation));
          forward.normalize();
          const right = B.Vector3.Cross(B.Axis.Y, forward).normalize(),
            v = right.scale(x).add(forward.scale(z));
          if (v.length() > 1) v.normalize();
          return S.plain(v);
        },
        setRotation(q) {
          guard();
          S.quat(q);
          rotation = new B.Quaternion(q.x, q.y, q.z, q.w);
        },
        setMode(next) {
          guard();
          if (!modes.includes(next)) throw Error("Invalid rig mode");
          if (next === "observer" && !config.viewpoint)
            throw Error("Observer camera needs viewpoint");
          mode = next;
        },
        update() {
          guard();
          r.update();
        },
        destroy: r.destroy,
      };
      try {
        r.update();
        return Object.freeze(result);
      } catch (error) {
        r.destroy();
        throw error;
      }
    }
    return {
      forOwner(owner) {
        const guard = () => {
          check();
          if (!owner.record.active) throw Error("Camera owner expired");
        };
        return Object.freeze({
          create: (options) => {
            guard();
            return createCamera(options || {}, owner);
          },
          get(id) {
            guard();
            const cam = resource(id);
            return cam ? handle(cam, id, owner) : null;
          },
          active() {
            guard();
            const cam = scene.activeCamera;
            return cam
              ? handle(
                  cam,
                  [...records].find(([, r]) => r.camera === cam)?.[0] || cam.id,
                  owner,
                )
              : null;
          },
          setActive(id) {
            guard();
            const cam = resource(typeof id === "string" ? id : id.id);
            if (!cam || cam.isDisposed()) throw Error("Camera absent");
            scene.activeCamera = cam;
          },
          createRig: (config) => {
            guard();
            const before = new Set(records.keys());
            try {
              return createRig(config, owner);
            } catch (error) {
              for (const [id, r] of records) if (!before.has(id)) r.destroy();
              throw error;
            }
          },
        });
      },
      update(dt = 0) {
        for (const r of [...rigs]) r.update(dt);
      },
      warp(entity, matrix) {
        for (const r of rigs) if (r.target === entity) r.warp(matrix);
      },
      stats: () => ({ runtimeCameras: records.size, cameraRigs: rigs.size }),
      dispose() {
        if (disposed) return;
        for (const r of [...rigs]) r.destroy();
        for (const r of [...records.values()]) r.destroy();
        disposed = true;
      },
    };
  }
  root.ArkGlideCameras = { create };
})(globalThis);
