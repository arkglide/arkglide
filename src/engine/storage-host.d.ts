export {};
declare global {
  var ArkGlideStorageHost: {
    create(options: { namespace: string; getStorage(): Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>; limits?: { maxBytes?: number; maxDepth?: number } }): {
      receive(message: unknown, reply: (message: unknown) => void): boolean;
      dispose(): void;
    };
  };
}
