import nodePath from 'path';
import { dialog } from 'electron';

function createDialogService() {
  return {
    selectDirectory: function() {
      var result = dialog.showOpenDialogSync({
        title: '选择工作目录',
        properties: ['openDirectory'],
      });
      if (!result || !result[0]) return { valid: false, nodePath: null, error: '已取消选择' };
      return { valid: true, nodePath: nodePath.resolve(result[0]) };
    },
  };
}

const dialogService = createDialogService();

export { createDialogService, dialogService };
export default dialogService;
