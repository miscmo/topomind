export function createTrashService(deps) {
  const {
    clearTrashItems,
    deleteTrashItem,
    listTrashItems,
    moveToTrash,
    restoreTrashItem,
  } = deps;

  return {
    moveToTrash(rootDir, sourcePath, category, extraMetadata) {
      return moveToTrash(rootDir, sourcePath, category, extraMetadata);
    },

    listTrashItems(rootDir, category) {
      return listTrashItems(rootDir, category);
    },

    restoreTrashItem(rootDir, category, trashName, destinationParentDir) {
      return restoreTrashItem(rootDir, category, trashName, destinationParentDir);
    },

    clearTrashItems(rootDir, category) {
      return clearTrashItems(rootDir, category);
    },

    deleteTrashItem(rootDir, category, trashName) {
      return deleteTrashItem(rootDir, category, trashName);
    },
  };
}
