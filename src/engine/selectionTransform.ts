import { Matrix, Quaternion, TransformNode, Vector3 } from '@babylonjs/core';

/** Selected descendants inherit their selected ancestor's motion exactly once. */
export function selectionRoots(nodes: TransformNode[]): TransformNode[] {
  const selected = new Set(nodes);
  return nodes.filter(node => {
    let parent = node.parent;
    while (parent) {
      if (selected.has(parent as TransformNode)) return false;
      parent = parent.parent;
    }
    return true;
  });
}
export function applySelectionDelta(initial: Map<TransformNode, Matrix>, initialPivot: Matrix, currentPivot: Matrix): void {
  const delta = initialPivot.clone().invert().multiply(currentPivot);
  initial.forEach((world, node) => {
    let local = world.multiply(delta);
    if (node.parent) local = local.multiply(node.parent.getWorldMatrix().clone().invert());
    const scale = Vector3.One(), rotation = Quaternion.Identity(), position = Vector3.Zero();
    local.decompose(scale, rotation, position);
    node.position.copyFrom(position);
    node.scaling.copyFrom(scale);
    node.rotationQuaternion = rotation;
    node.computeWorldMatrix(true);
  });
}
