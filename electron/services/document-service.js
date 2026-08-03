export function createDocumentService(deps) {
  const {
    clearTrashTopoDocuments,
    createTopoDocument,
    deleteTopoDocument,
    exportTopoDocument,
    listTopoDocuments,
    listTrashTopoDocuments,
    moveTopoDocument,
    openTopoDocumentFolder,
    readTopoDocument,
    renameTopoDocument,
    updateTopoDocumentMeta,
    repairTopoDocuments,
    restoreTrashTopoDocument,
    writeTopoDocument,
  } = deps;

  return {
    listTopoDocuments(rootDir, cardPath) {
      return listTopoDocuments(rootDir, cardPath);
    },

    createTopoDocument(rootDir, cardPath, input) {
      return createTopoDocument(rootDir, cardPath, input);
    },

    readTopoDocument(rootDir, cardPath, documentId) {
      return readTopoDocument(rootDir, cardPath, documentId);
    },

    writeTopoDocument(rootDir, cardPath, documentId, content) {
      return writeTopoDocument(rootDir, cardPath, documentId, content);
    },

    renameTopoDocument(rootDir, cardPath, documentId, title) {
      return renameTopoDocument(rootDir, cardPath, documentId, title);
    },

    updateTopoDocumentMeta(rootDir, cardPath, documentId, patch) {
      return updateTopoDocumentMeta(rootDir, cardPath, documentId, patch);
    },

    deleteTopoDocument(rootDir, cardPath, documentId) {
      return deleteTopoDocument(rootDir, cardPath, documentId);
    },

    listTrashTopoDocuments(rootDir, cardPath) {
      return listTrashTopoDocuments(rootDir, cardPath);
    },

    restoreTrashTopoDocument(rootDir, cardPath, trashName) {
      return restoreTrashTopoDocument(rootDir, cardPath, trashName);
    },

    clearTrashTopoDocuments(rootDir, cardPath) {
      return clearTrashTopoDocuments(rootDir, cardPath);
    },

    moveTopoDocument(rootDir, cardPath, documentId, newParentId, newSortOrder) {
      return moveTopoDocument(rootDir, cardPath, documentId, newParentId, newSortOrder);
    },

    repairTopoDocuments(rootDir, cardPath) {
      return repairTopoDocuments(rootDir, cardPath);
    },

    exportTopoDocument(rootDir, cardPath, documentId) {
      return exportTopoDocument(rootDir, cardPath, documentId);
    },

    openTopoDocumentFolder(rootDir, cardPath, documentId) {
      return openTopoDocumentFolder(rootDir, cardPath, documentId);
    },
  };
}
