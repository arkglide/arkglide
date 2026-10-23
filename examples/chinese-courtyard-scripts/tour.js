// Positions are metres; all five views remain inside the editable scene.
export const views = [
  { name: '入园 · 竹影', position: [0, 1.85, -17.9], target: [0, 2.5, 6] },
  { name: '听雨 · 亭前', position: [-6, 2.1, 2], target: [0, 2.7, 10] },
  { name: '映池 · 水光', position: [11, 1.65, -1], target: [1, 2.7, 10] },
  { name: '寻竹 · 林径', position: [-12, 2.2, 5], target: [-9, 4.5, 15] },
  { name: '望园 · 高台', position: [-14, 12, -7], target: [1, 1.5, 6] },
];

export function angles(position, target) {
  const dx = target[0] - position[0], dy = target[1] - position[1], dz = target[2] - position[2];
  return { x: -Math.atan2(dy, Math.hypot(dx, dz)), y: Math.atan2(dx, dz), z: 0 };
}

// Follow the courtyard's open path, with a soft rise to the overview.
export const route = [views[0], views[1], views[2], views[4], views[3], views[0]];
