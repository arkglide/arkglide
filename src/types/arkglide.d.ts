// ArkGlide 引擎 API 声明（供 Monaco 智能提示使用）
// 这些 API 通过 new Function('entity', 'input', 'scene', 'time', 'console', code) 注入用户脚本

// 三维向量
interface Vec3 {
  x: number;
  y: number;
  z: number;
}

// 二维向量（鼠标位置/增量）
interface Vec2 {
  x: number;
  y: number;
}

// ArkGlide Entity 抽象类
// 注意：不暴露底层渲染引擎对象（Babylon Mesh 等），确保未来可替换为 WASM 内核
declare class Entity {
  /** 获取实体唯一标识 */
  getId(): string;
  /** 获取实体名称 */
  getName(): string;
  /** 设置实体名称 */
  setName(name: string): void;
  /** 获取位置坐标 */
  getPosition(): Vec3;
  /** 设置位置坐标 */
  setPosition(x: number, y: number, z: number): void;
  /** 获取旋转角度（弧度） */
  getRotation(): Vec3;
  /** 设置旋转角度（弧度） */
  setRotation(x: number, y: number, z: number): void;
  /** 获取缩放比例 */
  getScale(): Vec3;
  /** 设置缩放比例 */
  setScale(x: number, y: number, z: number): void;
  /** 是否可见 */
  isVisible(): boolean;
  /** 设置可见性 */
  setVisible(visible: boolean): void;
  /** 销毁实体（从场景中移除并释放资源） */
  destroy(): void;
}

// ArkGlide Input API —— 键盘/鼠标输入
declare const input: {
  /** 检测按键是否持续按下 */
  isKeyDown(key: string): boolean;
  /** 检测按键是否在本帧新按下（边沿检测，只触发一次） */
  wasKeyPressed(key: string): boolean;
  /** 检测按键是否在本帧释放（边沿检测，只触发一次） */
  wasKeyReleased(key: string): boolean;
  /** 获取鼠标当前位置（屏幕坐标，无 z 分量） */
  getMousePosition(): Vec2;
  /** 获取鼠标移动增量（仅鼠标按下时累积，无 z 分量） */
  getMouseDelta(): Vec2;
  /** 检测鼠标按键是否持续按下 */
  isMouseDown(): boolean;
  /** 检测鼠标按键是否在本帧新按下 */
  wasMousePressed(): boolean;
  /** 检测鼠标按键是否在本帧释放 */
  wasMouseReleased(): boolean;
};

// ArkGlide Scene API —— 场景/实体管理
declare const scene: {
  /** 按 ID 查找实体 */
  find(id: string): Entity | null;
  /** 创建新实体。type: 'box' | 'sphere' | 'plane' | 'cylinder' | 'capsule' | 'torus' */
  create(type: string, id?: string): Entity;
  /** 获取所有实体 */
  findAll(): Entity[];
  /** 按 ID 销毁实体 */
  destroy(id: string): void;
  /** 销毁所有实体 */
  destroyAll(): void;
  /** 获取实体数量 */
  getEntityCount(): number;
};

// ArkGlide Time API —— 时间信息
declare const time: {
  /** 上一帧到当前帧的时间间隔（秒） */
  deltaTime: number;
  /** 脚本启动以来的总时间（秒） */
  totalTime: number;
  /** 帧计数 */
  frameCount: number;
};

// 脚本生命周期约定：return { onStart, onUpdate }
// onStart(): 启动时调用一次，用于初始化
// onUpdate(): 每帧调用，用于更新逻辑
/**
 * 脚本生命周期 this 上下文
 * 在 onStart/onUpdate 中，this.entity 指向挂载此脚本的实体
 * 运行时 this.entity 由 runtime.html 注入，包含 name/transform 等可直接读写的属性
 * （Entity 类的方法 getName/getPosition 等同样可用）
 */
declare interface ScriptThis {
  entity: Entity;
}