// Bulk numeric animation work. Events, ownership and target objects stay in JS.
(function (root) {
  "use strict";
  const defaults = {
    enabled: true,
    minTracks: 32,
    maxTracks: 8192,
    maxKeys: 262144,
  };
  function settings(input = {}) {
    if (
      !input ||
      typeof input !== "object" ||
      Array.isArray(input) ||
      Object.keys(input).some((k) => !Object.hasOwn(defaults, k))
    )
      throw Error("Invalid animation compute settings");
    const result = { ...defaults, ...input };
    if (
      typeof result.enabled !== "boolean" ||
      !["minTracks", "maxTracks", "maxKeys"].every(
        (k) => Number.isSafeInteger(result[k]) && result[k] >= 0,
      ) ||
      result.maxTracks < 1 ||
      result.maxTracks > 65536 ||
      result.maxKeys < 1 ||
      result.maxKeys > 4194304
    )
      throw Error("Invalid animation compute budget");
    return result;
  }
  function create(B, module, options) {
    const config = settings(options),
      plans = new Set(),
      prototype = B.Animation.prototype;
    const counters = {
      animationNativeBatches: 0,
      animationNativeSamples: 0,
      animationNativeCompiles: 0,
      animationFallbackBatches: 0,
    };
    let dead = false;
    const methods = [
      "evaluate",
      "_interpolate",
      "_getKeyValue",
      "getKeys",
      "getEasingFunction",
      "floatInterpolateFunction",
      "floatInterpolateFunctionWithTangents",
      "vector2InterpolateFunction",
      "vector2InterpolateFunctionWithTangents",
      "vector3InterpolateFunction",
      "vector3InterpolateFunctionWithTangents",
      "quaternionInterpolateFunction",
      "quaternionInterpolateFunctionWithTangents",
      "color3InterpolateFunction",
      "color3InterpolateFunctionWithTangents",
      "color4InterpolateFunction",
      "color4InterpolateFunctionWithTangents",
    ];
    const canonical = methods.map((k) => prototype[k]);
    function standard(a) {
      return (
        a.constructor === B.Animation &&
        !a._coreAnimation &&
        methods.every((k, i) => a[k] === canonical[i]) &&
        !a.getEasingFunction()
      );
    }
    function shape(value) {
      if (typeof value === "number") return { kind: 1, names: [] };
      for (const [Class, kind, names] of [
        [B.Quaternion, 5, ["x", "y", "z", "w"]],
        [B.Vector3, 3, ["x", "y", "z"]],
        [B.Vector2, 2, ["x", "y"]],
        [B.Color3, 3, ["r", "g", "b"]],
        [B.Color4, 4, ["r", "g", "b", "a"]],
      ])
        if (Class && value?.constructor === Class) return { kind, names };
      return null;
    }
    function components(value, names) {
      const out = names.length ? names.map((k) => value?.[k]) : [value];
      return out.every((v) => typeof v === "number" && Number.isFinite(v))
        ? out
        : null;
    }
    function prepare(c) {
      if (dead || !config.enabled || !module?.AnimationBatch) return null;
      const bindings = [],
        lookup = new Map(),
        tracks = [],
        keyData = [],
        snapshots = [];
      for (const [target, paths] of c.bindPose) {
        const map = new Map();
        lookup.set(target, map);
        for (const [path, value] of paths) {
          const type = shape(value);
          if (!type || !components(value, type.names)) return null;
          // Existing controller semantics only slerp the canonical quaternion property.
          const kind =
            type.kind === 5 && path !== "rotationQuaternion" ? 4 : type.kind;
          map.set(path, bindings.length);
          const parts = path.split(".");
          bindings.push({
            target,
            parts,
            key: parts.at(-1),
            value,
            kind,
            names: type.names,
            copyFrom: value?.copyFrom,
            copyFromFloats: value?.copyFromFloats,
            scratch: value?.clone ? value.clone() : value,
          });
        }
      }
      const dataTypes = new Map([
        [B.Animation.ANIMATIONTYPE_FLOAT, 1],
        [B.Animation.ANIMATIONTYPE_VECTOR2, 2],
        [B.Animation.ANIMATIONTYPE_VECTOR3, 3],
        [B.Animation.ANIMATIONTYPE_QUATERNION, 5],
        [B.Animation.ANIMATIONTYPE_COLOR3, 3],
        [B.Animation.ANIMATIONTYPE_COLOR4, 4],
      ]);
      for (let groupIndex = 0; groupIndex < c.groups.length; groupIndex++) {
        const group = c.groups[groupIndex];
        for (
          let entryIndex = 0;
          entryIndex < group.targetedAnimations.length;
          entryIndex++
        ) {
          const entry = group.targetedAnimations[entryIndex];
          const a = entry.animation,
            pose = lookup.get(entry.target)?.get(a.targetProperty);
          // Root motion channels are evaluated by the collision-aware JS path.
          if (pose === undefined) continue;
          const kind = dataTypes.get(a.dataType),
            binding = bindings[pose];
          if (
            !kind ||
            (kind === 5 ? 4 : kind) !==
              (binding.kind === 5 ? 4 : binding.kind) ||
            !standard(a)
          )
            return null;
          const keys = a.getKeys();
          if (
            !keys?.length ||
            keyData.length / 14 + keys.length > config.maxKeys ||
            tracks.length / 5 >= config.maxTracks
          )
            return null;
          const first = keyData.length / 14;
          let previous = -Infinity;
          for (const key of keys) {
            if (
              !Number.isFinite(key.frame) ||
              key.frame < previous ||
              key.easingFunction ||
              (key.interpolation !== undefined &&
                key.interpolation !== 0 &&
                key.interpolation !== 1)
            )
              return null;
            const value = components(key.value, binding.names),
              incoming =
                key.inTangent === undefined
                  ? []
                  : components(key.inTangent, binding.names),
              outgoing =
                key.outTangent === undefined
                  ? []
                  : components(key.outTangent, binding.names);
            if (!value || !incoming || !outgoing) return null;
            const row = Array(14).fill(0);
            row[0] = key.frame;
            row.splice(1, value.length, ...value);
            row.splice(5, incoming.length, ...incoming);
            row.splice(9, outgoing.length, ...outgoing);
            row[13] =
              (key.interpolation === 1 ? 1 : 0) |
              (incoming.length ? 2 : 0) |
              (outgoing.length ? 4 : 0);
            keyData.push(...row);
            previous = key.frame;
          }
          tracks.push(groupIndex, pose, kind, first, keys.length);
          const prefix = {
              0: "float",
              1: "vector3",
              2: "quaternion",
              4: "color3",
              5: "vector2",
              7: "color4",
            }[a.dataType],
            linear = prefix + "InterpolateFunction",
            cubic = linear + "WithTangents";
          snapshots.push({
            group,
            entryIndex,
            entry,
            animation: a,
            keys,
            path: a.targetProperty,
            target: entry.target,
            kind: a.dataType,
            linear,
            cubic,
            linearFunction: a[linear],
            cubicFunction: a[cubic],
          });
        }
      }
      if (
        tracks.length / 5 < config.minTracks ||
        !tracks.length ||
        bindings.length > config.maxTracks
      )
        return null;
      const native = new module.AnimationBatch();
      let released = false,
        jobs,
        output,
        capacity = 0;
      try {
        if (
          !native.reserve(
            c.groups.length,
            bindings.length,
            tracks.length / 5,
            keyData.length / 14,
          )
        ) {
          native.delete();
          return null;
        }
        native.trackView().set(tracks);
        native.kindView().set(bindings.map((b) => b.kind));
        native.keyView().set(keyData);
        const base = native.baseView();
        bindings.forEach((b, i) =>
          base.set(components(b.value, b.names), i * 4),
        );
        if (!native.seal()) {
          native.delete();
          return null;
        }
      } catch (error) {
        native.delete();
        throw error;
      }
      const groupMap = new Map(c.groups.map((g, i) => [g, i])),
        groupSizes = c.groups.map((g) => g.targetedAnimations.length),
        groupTracks = c.groups.map((g, i) => {
          let n = 0;
          for (let j = 0; j < tracks.length; j += 5) if (tracks[j] === i) n++;
          return n;
        });
      const plan = {
        valid() {
          if (released || c.groups.length !== groupSizes.length) return false;
          for (let i = 0; i < c.groups.length; i++)
            if (
              groupMap.get(c.groups[i]) !== i ||
              c.groups[i].targetedAnimations.length !== groupSizes[i]
            )
              return false;
          for (const s of snapshots) {
            const a = s.animation;
            if (
              s.group.targetedAnimations[s.entryIndex] !== s.entry ||
              s.entry.animation !== a ||
              s.entry.target !== s.target ||
              a.targetProperty !== s.path ||
              a.dataType !== s.kind ||
              a._coreAnimation ||
              a.getKeys !== canonical[3] ||
              a.getKeys() !== s.keys ||
              a.getEasingFunction !== canonical[4] ||
              a.getEasingFunction() ||
              a.evaluate !== canonical[0] ||
              a._interpolate !== canonical[1] ||
              a._getKeyValue !== canonical[2] ||
              a[s.linear] !== s.linearFunction ||
              a[s.cubic] !== s.cubicFunction
            )
              return false;
          }
          return true;
        },
        evaluate(list) {
          if (released) return false;
          if (list.length > capacity) {
            if (!native.reserveJobs(list.length)) return false;
            capacity = list.length;
            jobs = output = null;
          }
          if (!jobs?.buffer.byteLength) jobs = native.jobView();
          for (let i = 0; i < list.length; i++) {
            const entry = list[i],
              group = groupMap.get(entry.g);
            if (group === undefined) return false;
            jobs[i * 3] = group;
            jobs[i * 3 + 1] = entry.frame;
            jobs[i * 3 + 2] = entry.weight;
          }
          if (!native.evaluate(list.length)) return false;
          if (!output?.buffer.byteLength) output = native.poseView();
          for (let i = 0; i < bindings.length; i++) {
            const b = bindings[i],
              offset = i * 4;
            let ref = b.target;
            for (let j = 0; j < b.parts.length - 1; j++) ref = ref[b.parts[j]];
            if (!b.names.length) ref[b.key] = output[offset];
            else {
              const current = ref[b.key],
                direct =
                  current?.copyFrom === b.copyFrom &&
                  current?.copyFromFloats === b.copyFromFloats,
                value = direct ? current : b.scratch;
              if (b.names.length === 4)
                value.copyFromFloats(
                  output[offset],
                  output[offset + 1],
                  output[offset + 2],
                  output[offset + 3],
                );
              else if (b.names.length === 3)
                value.copyFromFloats(
                  output[offset],
                  output[offset + 1],
                  output[offset + 2],
                );
              else value.copyFromFloats(output[offset], output[offset + 1]);
              if (value === b.scratch) {
                // Extension hooks may retain the supplied value as a snapshot.
                const snapshot = value.clone();
                if (ref[b.key]?.copyFrom) ref[b.key].copyFrom(snapshot);
                else ref[b.key] = snapshot;
              }
            }
          }
          counters.animationNativeBatches++;
          for (const job of list)
            if (job.weight > 0)
              counters.animationNativeSamples +=
                groupTracks[groupMap.get(job.g)];
          return true;
        },
        dispose() {
          if (released) return;
          released = true;
          plans.delete(plan);
          native.delete();
          jobs = output = null;
        },
      };
      counters.animationNativeCompiles++;
      plans.add(plan);
      return plan;
    }
    return {
      prepare,
      fallback() {
        counters.animationFallbackBatches++;
      },
      stats: () => ({ ...counters, animationNativeControllers: plans.size }),
      dispose() {
        if (dead) return;
        dead = true;
        for (const plan of plans) plan.dispose();
      },
    };
  }
  root.ArkGlideAnimationCompute = { settings, create };
})(globalThis);
