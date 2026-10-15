import { tuning as c } from './config.js';

/** @param {ScriptContext} context */
export default function ({ entity, scene, input, physics, cameras, portals, interaction, visuals,
  triggers, signals, motion, optics, fields, saves, ui }) {
  const identity = { x: 0, y: 0, z: 0, w: 1 };
  let ready = false, busy = false, completed = false, error = '', mirrorTurned = false;
  let rig, controller, door, plate, receiver, unlocked, entry, exit, grab, laserBeam, field;
  let effects = [], effectMaterial = null, effectActive = false, lastPortalPose = '', crossings = 0, forceVolumes = [];
  let bridgeSegments = 0, fieldSegments = 0, lastTrace = null;
  const required = id => { const e = scene.find(id); if (!e) throw Error('Missing composition entity: ' + id); return e; };
  function rotationY(angle) { return { x: 0, y: Math.sin(angle / 2), z: 0, w: Math.cos(angle / 2) }; }
  /** @returns {PhysicsOptions} */
  function body() { return { motion: 'static', shape: 'convex', size: { x: 1, y: 1, z: 1 }, mass: 1,
    friction: c.bridge.friction, restitution: 0, sensor: false, lockRotation: false }; }
  function releaseEffects() {
    field?.destroy(); field = null;
    for (const mesh of effects) { if (physics.has(mesh.entity)) physics.remove(mesh.entity); mesh.destroy(); }
    effectMaterial?.destroy(); effectMaterial = null;
    effects = []; forceVolumes = []; bridgeSegments = fieldSegments = 0;
  }
  function portalPose() { return JSON.stringify([entry.getPose(), exit.getPose(), entry.linked, exit.linked]); }
  function rebuildEffects(active, force = false) {
    if (effectActive === active && !force) return;
    releaseEffects(); effectActive = active; lastPortalPose = portalPose();
    if (!active) return;
    try {
      const bridge = portals.projectVolume({ ...c.bridge, maxHops: c.portal.maxHops });
      const funnel = portals.projectVolume({ ...c.funnel, maxHops: c.portal.maxHops });
      if (bridge.truncated || funnel.truncated) throw Error('Projection exhausted configured path budget');
      effectMaterial = visuals.createMaterial({ color: c.bridge.color, emissive: c.bridge.color, alpha: .75 });
      for (const segment of bridge.segments) {
        const mesh = visuals.createMesh(segment.geometry, { material: effectMaterial }); effects.push(mesh); physics.add(mesh.entity, body());
      }
      bridgeSegments = bridge.segments.length;
      forceVolumes = funnel.segments.map(segment => {
        const points = [];
        for (let i = 0; i < segment.geometry.positions.length; i += 3)
          points.push({ x: segment.geometry.positions[i], y: segment.geometry.positions[i + 1], z: segment.geometry.positions[i + 2] });
        return /** @type {FieldVolume} */ ({ shape: { kind: 'convex', points }, position: { x: 0, y: 0, z: 0 },
          vector: { x: segment.direction.x * c.funnel.acceleration, y: segment.direction.y * c.funnel.acceleration, z: segment.direction.z * c.funnel.acceleration } });
      });
      if (forceVolumes.length) field = fields.create({ mode: 'acceleration', vector: { x: 0, y: 0, z: 0 }, volumes: forceVolumes });
      fieldSegments = forceVolumes.length;
      const beam = visuals.createBeam({ segments: funnel.segments.map(segment => ({ origin: segment.origin, end: segment.end })), radius: c.funnel.radius, color: c.funnel.color });
      effects.push(beam);
    } catch (failure) { releaseEffects(); effectActive = false; throw failure; }
  }
  function turnMirror() {
    mirrorTurned = !mirrorTurned;
    physics.setState(required('Mirror'), { rotation: rotationY(c.laser.mirrorYaw[mirrorTurned ? 1 : 0]) });
  }
  function updateLaser() {
    lastTrace = optics.trace({ ...c.laser, filter: { ignore: [entity], sensors: false }, maxPortalHops: c.portal.maxHops });
    receiver.set(!lastTrace.truncated && lastTrace.hit?.entity === required('Receiver') && lastTrace.energy >= c.laser.minEnergy);
    if (lastTrace.segments.length) {
      if (!laserBeam) laserBeam = visuals.createBeam({ segments: lastTrace.segments, radius: c.laser.radius, color: c.laser.color });
      else laserBeam.update({ segments: lastTrace.segments });
    }
  }
  function status() {
    return { ready, busy, error, completed, mirrorTurned, plate: plate?.value ?? false,
      receiver: receiver?.value ?? false, unlocked: unlocked?.value ?? false, door: door?.getState(), crossings,
      bridgeSegments, fieldSegments, forceVolumes: structuredClone(forceVolumes),
      laserReflections: lastTrace?.reflections.length ?? 0, laserHit: lastTrace?.hit?.entity.id ?? null,
      projectionPath: entry?.linked ? ['bridge-entry'] : [] };
  }
  async function save() {
    if (busy || !ready) return false;
    busy = true;
    try { await saves.save(c.slot); error = ''; return true; }
    catch (failure) { error = failure.message; throw failure; }
    finally { busy = false; }
  }
  async function retry() {
    if (busy || !ready) return false;
    busy = true; grab?.release(); grab = null; controller.clearInput();
    try { const loaded = await saves.load(c.slot); if (!loaded) throw Error('Checkpoint is missing'); error = ''; return true; }
    catch (failure) { error = failure.message; throw failure; }
    finally { busy = false; }
  }
  function command(fn) { void fn().catch(failure => { error = failure.message; }); }
  return {
    onStart() {
      controller = physics.character(entity);
      rig = cameras.createRig({ target: entity, ...c.camera });
      plate = signals.create(); receiver = signals.create(); unlocked = signals.gate('and', [plate, receiver]);
      door = motion.create(required('Door'), { to: { position: c.door.open, rotation: identity }, duration: c.door.duration, easing: 'smoothstep' });
      signals.onChange(unlocked, event => door.setTarget(event.value ? 1 : 0));
      signals.onChange(plate, event => rebuildEffects(event.value));
      portals.addSurface(required('PortalPanelA')); portals.addSurface(required('PortalPanelB'));
      entry = portals.create({ id: 'bridge-entry', width: c.portal.width, height: c.portal.height });
      exit = portals.create({ id: 'bridge-exit', width: c.portal.width, height: c.portal.height });
      const first = entry.place(c.portal.entryOrigin, c.portal.entryRay), second = exit.place(c.portal.exitOrigin, c.portal.exitRay);
      if (!first.placed || !second.placed) throw Error('Composition portal placement failed: ' + (first.reason || second.reason));
      entry.link(exit); portals.watch(entity); portals.watch(required('Crate'));
      portals.onTraverse(event => { if (event.entity === entity || event.entity === required('Crate')) crossings++; });
      optics.addReflector(required('Mirror'), { reflectivity: c.laser.reflectivity });
      const plateRegion = triggers.create({ volumes: [{ shape: { kind: 'box', size: c.plate.size }, position: c.plate.position }],
        filterEntity: e => e === entity || e === required('Crate'), onEnter: () => plate.set(true), onExit: () => plate.set(plateRegion.getEntities().length > 0) });
      triggers.create({ volumes: [{ shape: { kind: 'box', size: c.goal.size }, position: c.goal.position }], filterEntity: e => e === entity,
        onEnter: () => { if (unlocked.value) completed = true; } });
      saves.register('composition', { version: 1,
        capture: () => ({ plate: plate.value, receiver: receiver.value, completed, mirrorTurned, door: door.getState(), view: rig.camera.getPose().rotation }),
        validate: state => typeof state.plate === 'boolean' && typeof state.receiver === 'boolean' && typeof state.completed === 'boolean' && typeof state.mirrorTurned === 'boolean',
        restore(state) {
          completed = state.completed; mirrorTurned = state.mirrorTurned; door.restore(state.door); rig.setRotation(state.view);
          controller.clearInput(); plate.set(state.plate); receiver.set(state.receiver); signals.flush(); rebuildEffects(state.plate, true);
        } });
      ui.get('saveCheckpoint')?.on('click', () => command(save));
      ui.get('retryCheckpoint')?.on('click', () => command(retry));
      ui.get('turnMirror')?.on('click', turnMirror);
      globalThis.compositionLab = { status, save, retry, turnMirror, rig, entry, exit, player: entity };
      updateLaser(); signals.flush();
      void saves.save(c.slot).then(() => { ready = true; }).catch(failure => { error = failure.message; });
    },
    onFixedUpdate() {
      if (!ready || busy) return;
      controller.move(rig.direction(input.getAction('moveX'), input.getAction('moveZ')));
      if (input.wasActionPressed('jump')) controller.jump();
      updateLaser();
      if (effectActive && lastPortalPose !== portalPose()) rebuildEffects(true, true);
      if (entity.getWorldPosition().y < c.deathHeight) command(retry);
    },
    onUpdate() {
      if (!rig) return;
      const delta = input.getMouseDelta();
      if (input.wasMouseButtonPressed(0) && !input.isPointerLocked()) void input.requestPointerLock();
      if (input.isPointerLocked()) rig.look(delta.x, delta.y);
      rig.update();
      const ray = rig.camera.ray(.5, .5, c.rayRange);
      if (ready && !busy) {
        if (input.wasActionPressed('interact')) {
          if (grab?.active) { grab.release(); grab = null; }
          else {
            const trace = portals.raycast(ray.origin, ray.direction, { ignore: [entity], sensors: false }), hit = trace.hit;
            if (hit && physics.getState(hit.entity).kind === 'dynamic') grab = interaction.grab(hit.entity, { position: hit.point, maxDistance: c.maxHoldDistance, path: trace.path });
          }
        }
        if (grab?.active) grab.setRay(ray.origin, ray.direction, c.holdDistance, { ignore: [entity] });
        if (input.wasActionPressed('mirror')) turnMirror();
        if (input.wasActionPressed('save')) command(save);
        if (input.wasActionPressed('retry')) command(retry);
      }
      ui.get('status')?.setText(error || (completed ? '验证关卡完成' : `压力区 ${plate.value ? '开启' : '关闭'} · 光接收器 ${receiver.value ? '开启' : '关闭'} · 门 ${Math.round(door.getState().progress * 100)}%`));
    },
    onDestroy() { grab?.release(); releaseEffects(); laserBeam?.destroy(); delete globalThis.compositionLab; },
  };
}
