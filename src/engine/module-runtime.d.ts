export {};
declare global {
  var ArkGlideModules: {
    rewriteRename(
      sources: Record<string, string>,
      oldName: string,
      newName: string,
    ): Record<string, string>;
  };
}
