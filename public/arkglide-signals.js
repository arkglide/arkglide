// Boolean dependency graphs. Immutable edges make derived-node graphs acyclic.
(function (root) {
  "use strict";
  function create(o = {}) {
    const nodes = new Set(), handles = new WeakMap(), subscriptions = new Set(), pending = new Map();
    let dead = false, flushing = false, writer = null;
    let limits = { maxNodes: 1024, maxListeners: 4096, maxPasses: 64 };
    const guard = owner => {
      if (dead || !owner.record.active || owner.record.destroying) throw Error("Signal owner expired");
    };
    function node(handle) {
      const n = handles.get(handle);
      if (!n?.live) throw Error("Signal absent or belongs to another session");
      return n;
    }
    function write(n, value) {
      if (typeof value !== "boolean") throw TypeError("Signals require boolean values");
      if (n.value === value) return;
      if (!pending.has(n)) pending.set(n, n.value);
      n.value = value;
      if (writer) writers.add(writer);
    }
    const writers = new Set();
    const evaluate = n => {
      const values = n.inputs.map(input => input.value);
      if (n.operation === "and") return values.every(Boolean);
      if (n.operation === "or") return values.some(Boolean);
      if (n.operation === "not") return !values[0];
      return values.filter(Boolean).length % 2 === 1;
    };
    function settle() {
      for (const n of nodes) if (n.operation) write(n, evaluate(n));
    }
    function report(owner, error) { o.onError?.({ file: owner?.record.file, hook: "signals.flush", error }); }
    function flush() {
      if (dead) return;
      if (flushing) throw Error("Signal flush cannot be reentered");
      flushing = true;
      writers.clear();
      try {
        for (let pass = 0; ; pass++) {
          settle();
          if (!pending.size) break;
          if (pass >= limits.maxPasses) {
            // Feedback via callbacks is bounded, even though graph edges are acyclic.
            for (const sub of writers) sub.off();
            report(null, Error("Signal propagation budget exceeded; feedback writers disconnected"));
            settle(); pending.clear(); break;
          }
          const batch = [...pending].map(([n, previous]) => ({ n, previous, value: n.value }));
          pending.clear();
          for (const { n, previous, value } of batch) {
            if (!n.live || previous === value) continue;
            for (const sub of [...n.listeners]) {
              if (!sub.live || !n.live || !sub.owner.record.active || sub.owner.record.destroying) continue;
              writer = sub;
              try {
                const result = sub.callback({ signal: n.handle, value, previous });
                if (result && typeof result.then === "function") Promise.resolve(result).catch(error => {
                  if (sub.live && sub.owner.record.active) { sub.off(); report(sub.owner, error); }
                });
              } catch (error) { sub.off(); report(sub.owner, error); }
              finally { writer = null; }
            }
          }
        }
      } finally { writer = null; flushing = false; writers.clear(); }
    }
    function make(owner, value, operation, inputs = []) {
      guard(owner);
      if (nodes.size >= limits.maxNodes) throw RangeError("Signal node budget exceeded");
      if (typeof value !== "boolean") throw TypeError("Signals require boolean values");
      const n = { owner, value, operation, inputs, live: true, listeners: new Set(), dependents: new Set() };
      let off;
      function destroy() {
        if (!n.live) return;
        n.live = false;
        for (const dependent of [...n.dependents]) dependent.destroy();
        for (const sub of [...n.listeners]) sub.off();
        for (const input of inputs) input.dependents.delete(n);
        nodes.delete(n); pending.delete(n); off?.();
      }
      n.destroy = destroy;
      n.handle = Object.freeze({
        get active() { return n.live; },
        get value() { guard(owner); node(n.handle); return n.value; },
        ...(!operation ? { set(value) { guard(owner); node(n.handle); write(n, value); } } : {}),
        destroy,
      });
      handles.set(n.handle, n); nodes.add(n);
      for (const input of inputs) input.dependents.add(n);
      off = owner.track(destroy);
      return n.handle;
    }
    return {
      forOwner(owner) {
        guard(owner);
        return Object.freeze({
          create(value = false) { return make(owner, value); },
          gate(operation, inputHandles) {
            guard(owner);
            if (!["and", "or", "not", "xor"].includes(operation) || !Array.isArray(inputHandles) ||
                !inputHandles.length || inputHandles.length > limits.maxNodes || (operation === "not" && inputHandles.length !== 1))
              throw TypeError("Invalid signal gate or inputs");
            const inputs = inputHandles.map(node);
            return make(owner, evaluate({ operation, inputs }), operation, inputs);
          },
          onChange(handle, callback) {
            guard(owner); const n = node(handle);
            if (typeof callback !== "function") throw TypeError("Expected signal callback");
            if (subscriptions.size >= limits.maxListeners) throw RangeError("Signal listener budget exceeded");
            const sub = { owner, callback, live: true };
            sub.off = owner.track(() => { sub.live = false; n.listeners.delete(sub); subscriptions.delete(sub); });
            subscriptions.add(sub); n.listeners.add(sub);
            return sub.off;
          },
          flush() { guard(owner); flush(); },
          getLimits() { guard(owner); return { ...limits }; },
          setLimits(patch) {
            guard(owner);
            if (!patch || typeof patch !== "object" || Array.isArray(patch)) throw TypeError("Expected signal limits");
            for (const [key, value] of Object.entries(patch))
              if (!Object.hasOwn(limits, key) || !Number.isSafeInteger(value) || value < 1) throw RangeError("Invalid signal limit");
            const next = { ...limits, ...patch };
            if (next.maxNodes < nodes.size || next.maxListeners < subscriptions.size) throw RangeError("Signal limits below usage");
            limits = next;
          },
        });
      },
      flush,
      stats: () => ({ signalNodes: nodes.size, signalListeners: subscriptions.size }),
      dispose() { if (dead) return; for (const n of [...nodes]) n.destroy(); pending.clear(); dead = true; },
    };
  }
  root.ArkGlideSignals = { create };
})(globalThis);
