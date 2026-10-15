/** @param {ScriptContext} context */
export default function ({
  entity,
  scene,
  input,
  cameras,
  portals,
  physics,
  interaction,
  events,
  ui,
  time,
}) {
  let rig,
    controller,
    blue,
    orange,
    grab = null,
    mode = 0,
    traversals = 0;
  const findRequired = (id) => {
    const result = scene.find(id);
    if (!result) throw Error("Missing demo entity: " + id);
    return result;
  };
  const modes = ["firstPerson", "thirdPerson", "observer"];
  function pair(floor = false) {
    blue.unlink();
    blue.place(
      floor ? { x: 4, y: 5, z: 4 } : { x: 0, y: 1.6, z: 0 },
      floor ? { x: 0, y: -20, z: 0 } : { x: 0, y: 0, z: 20 },
    );
    orange.place({ x: 0, y: 1.6, z: 4 }, { x: 20, y: 0, z: 0 });
    blue.link(orange);
  }
  function reset() {
    physics.setState(entity, {
      position: { x: 0, y: 2, z: -6 },
      velocity: { x: 0, y: 0, z: 0 },
    });
    rig.setRotation({ x: 0, y: 0, z: 0, w: 1 });
  }
  return {
    onStart() {
      controller = physics.character(entity);
      for (const id of ["Floor", "Front", "Back", "Left", "Right", "MovingPanel"])
        portals.addSurface(findRequired(id));
      blue = portals.create({
        id: "blue",
        width: 2.2,
        height: 3,
        color: "#2377FF",
      });
      orange = portals.create({
        id: "orange",
        width: 2.2,
        height: 3,
        color: "#FF8423",
      });
      portals.watch(entity);
      for (const id of ["Crate1", "Crate2"]) portals.watch(findRequired(id));
      physics.createJoint(findRequired("Twin1"), findRequired("Twin2"), { kind: "fixed" });
      portals.watchAssembly(findRequired("Twin1"));
      portals.onBlocked((event) => ui.get("status")?.setText("穿越受阻：" + event.reason));
      rig = cameras.createRig({
        id: "player-view",
        target: entity,
        viewpoint: findRequired("Observer"),
        mode: "firstPerson",
        fov: 75,
        near: 0.02,
        far: 200,
        sensitivity: 0.002,
        uprightSpeed: 4,
        offset: { x: 0, y: 0.7, z: 0 },
      });
      pair();
      const canvas = document.getElementById("renderCanvas");
      if (!canvas) throw Error("Runtime canvas absent");
      events.listen(canvas, "pointerdown", () => {
        if (!input.isPointerLocked()) input.requestPointerLock();
      });
      input.onPointerLockChange((locked) =>
        ui
          .get("lock")
          ?.setText(locked ? "鼠标已锁定 · Esc 释放" : "点击画面锁定鼠标"),
      );
      portals.onTraverse((event) => {
        traversals++;
        ui.get("status")?.setText("穿越次数：" + traversals);
      });
      ui.get("wallPair")?.on("click", () => pair(false));
      ui.get("floorPair")?.on("click", () => pair(true));
      ui.get("movingPair")?.on("click", () => {
        blue.unlink();
        const panel = findRequired("MovingPanel").getWorldPosition();
        blue.place({ x: panel.x, y: panel.y, z: panel.z - 4 }, { x: 0, y: 0, z: 8 });
        orange.place({ x: 0, y: 1.6, z: 4 }, { x: 20, y: 0, z: 0 });
        blue.link(orange);
      });
      ui.get("assembly")?.on("click", () => {
        pair(false);
        for (const [index, id] of ["Twin1", "Twin2"].entries()) {
          physics.setState(findRequired(id), {
            position: { x: 0, y: 1.6, z: 8.7 - index * 0.8 },
            rotation: { x: 0, y: 0, z: 0, w: 1 },
            velocity: { x: 0, y: 0, z: 6 },
            angularVelocity: { x: 0, y: 0, z: 0 },
          });
        }
      });
      ui.get("launch")?.on("click", () => {
        pair(true);
        physics.setState(entity, {
          position: { x: 4, y: 12, z: 4 },
          velocity: { x: 0, y: 0, z: 0 },
        });
      });
      // The verification harness calls these game-owned helpers; engine code has no demo dependency.
      globalThis.portalDemo = {
        blue,
        orange,
        player: entity,
        rig,
        physics,
        portals,
        pair,
        reset,
        get traversals() {
          return traversals;
        },
      };
    },
    onFixedUpdate() {
      findRequired("MovingPanel").position.y = 2 + Math.sin(time.fixedTotalTime) * 0.6;
      controller.move(
        rig.direction(input.getAction("moveX"), input.getAction("moveZ")),
      );
      if (input.wasActionPressed("jump")) controller.jump();
      if (entity.getWorldPosition().y < -20) reset();
    },
    onUpdate() {
      const delta = input.getMouseDelta();
      if (input.isPointerLocked()) rig.look(delta.x, delta.y);
      rig.update();
      const ray = rig.camera.ray(0.5, 0.5, 100);
      if (input.isPointerLocked()) {
        if (input.wasMouseButtonPressed(0))
          blue.place(ray.origin, ray.direction);
        if (input.wasMouseButtonPressed(2))
          orange.place(ray.origin, ray.direction);
      }
      if (input.wasActionPressed("interact")) {
        if (grab) {
          grab.release();
          grab = null;
        } else {
          const trace = portals.raycast(ray.origin, ray.direction, {
            ignore: [entity],
            sensors: false,
          });
          if (
            trace.hit &&
            physics.getState(trace.hit.entity).kind === "dynamic"
          )
            grab = interaction.grab(trace.hit.entity, {
              position: trace.hit.point,
              maxDistance: 15,
            });
        }
      }
      if (grab?.active) grab.setRay(ray.origin, ray.direction, 2.8);
      if (input.wasActionPressed("camera")) {
        mode = (mode + 1) % modes.length;
        rig.setMode(modes[mode]);
        ui.get("mode")?.setText("视角：" + modes[mode]);
      }
      if (input.wasActionPressed("reset")) reset();
    },
    onDestroy() {
      grab?.release();
      delete globalThis.portalDemo;
    },
  };
}
