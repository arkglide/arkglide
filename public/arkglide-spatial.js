// World-space helpers shared by engine systems; no renderer handles escape APIs.
(function (root) {
  "use strict";
  function vec(p) {
    if (!p || ![p.x, p.y, p.z].every(Number.isFinite))
      throw TypeError("Expected finite Vec3");
    return p;
  }
  function quat(q) {
    if (
      !q ||
      ![q.x, q.y, q.z, q.w].every(Number.isFinite) ||
      Math.abs(Math.hypot(q.x, q.y, q.z, q.w) - 1) > 0.001
    )
      throw TypeError("Expected unit quaternion");
    return q;
  }
  const plain = (v) => ({ x: v.x, y: v.y, z: v.z }),
    plainQ = (q) => ({ ...plain(q), w: q.w });
  function pose(B, o) {
    o.computeWorldMatrix(true);
    const scale = new B.Vector3(),
      rotation = new B.Quaternion(),
      position = new B.Vector3();
    if (!o.getWorldMatrix().decompose(scale, rotation, position))
      throw Error("Invalid world transform");
    return { scale, rotation, position };
  }
  function write(B, o, p, q) {
    vec(p);
    if (q) quat(q);
    let v = new B.Vector3(p.x, p.y, p.z),
      r = q && new B.Quaternion(q.x, q.y, q.z, q.w);
    if (o.parent) {
      const pp = pose(B, o.parent);
      v = B.Vector3.TransformCoordinates(
        v,
        B.Matrix.Invert(o.parent.getWorldMatrix()),
      );
      if (r) r = pp.rotation.conjugate().multiply(r);
    }
    o.position.copyFrom(v);
    if (r) o.rotationQuaternion = r;
    o.computeWorldMatrix(true);
  }
  function number(x, min, max, label) {
    if (!Number.isFinite(x) || x < min || x > max) throw RangeError(label);
    return x;
  }
  function look(B, d, u) {
    if (!d.lengthSquared()) throw Error("Look direction cannot be zero");
    d = d.normalize();
    u = B.Vector3.Cross(d, B.Vector3.Cross(u, d)).normalize();
    if (!u.lengthSquared()) {
      const fallback = Math.abs(d.y) < Math.abs(d.x) ? B.Axis.Y : B.Axis.X;
      u = B.Vector3.Cross(d, B.Vector3.Cross(fallback, d)).normalize();
    }
    return B.Quaternion.FromLookDirectionRH(d, u).normalize();
  }
  function horizontalForward(B, rotation) {
    const matrix = B.Matrix.Compose(B.Vector3.One(), rotation, B.Vector3.Zero());
    const forward = B.Vector3.TransformNormal(B.Axis.Z, matrix);
    forward.y = 0;
    if (forward.lengthSquared() < 1e-8) {
      const right = B.Vector3.TransformNormal(B.Axis.X, matrix);
      forward.copyFrom(B.Vector3.Cross(right, B.Axis.Y));
      forward.y = 0;
    }
    return forward.normalize();
  }
  root.ArkGlideSpatial = {
    look,
    vec,
    quat,
    plain,
    plainQ,
    pose,
    write,
    number,
    horizontalForward,
  };
})(globalThis);
