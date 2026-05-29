const fs = require('fs');
const path = require('path');

const directoryToSearch = path.join(__dirname, '..', 'src');

const replacements = [
  {
    regex: /(['"])(?:\.\.\/)+stores\/tabStore(['"])/g,
    replacer: (match, p1, p2, offset, str, filepath) => {
      let relativePath = path.relative(path.dirname(filepath), path.join(__dirname, '..', 'src/stores/tabs/tabStore')).replace(/\\/g, '/');
      if (!relativePath.startsWith('.')) relativePath = './' + relativePath;
      return `${p1}${relativePath}${p2}`;
    }
  },
  {
    regex: /(['"])\.\/stores\/tabStore(['"])/g,
    replacer: (match, p1, p2, offset, str, filepath) => {
      let relativePath = path.relative(path.dirname(filepath), path.join(__dirname, '..', 'src/stores/tabs/tabStore')).replace(/\\/g, '/');
      if (!relativePath.startsWith('.')) relativePath = './' + relativePath;
      return `${p1}${relativePath}${p2}`;
    }
  },
  {
    regex: /(['"])(?:\.\.\/)+stores\/confirmStore(['"])/g,
    replacer: (match, p1, p2, offset, str, filepath) => {
      let relativePath = path.relative(path.dirname(filepath), path.join(__dirname, '..', 'src/shared/ui/ConfirmModal/confirmStore')).replace(/\\/g, '/');
      if (!relativePath.startsWith('.')) relativePath = './' + relativePath;
      return `${p1}${relativePath}${p2}`;
    }
  },
  {
    regex: /(['"])\.\/stores\/confirmStore(['"])/g,
    replacer: (match, p1, p2, offset, str, filepath) => {
      let relativePath = path.relative(path.dirname(filepath), path.join(__dirname, '..', 'src/shared/ui/ConfirmModal/confirmStore')).replace(/\\/g, '/');
      if (!relativePath.startsWith('.')) relativePath = './' + relativePath;
      return `${p1}${relativePath}${p2}`;
    }
  },
  {
    regex: /(['"])(?:\.\.\/)+stores\/promptStore(['"])/g,
    replacer: (match, p1, p2, offset, str, filepath) => {
      let relativePath = path.relative(path.dirname(filepath), path.join(__dirname, '..', 'src/shared/ui/PromptModal/promptStore')).replace(/\\/g, '/');
      if (!relativePath.startsWith('.')) relativePath = './' + relativePath;
      return `${p1}${relativePath}${p2}`;
    }
  },
  {
    regex: /(['"])(?:\.\.\/)+stores\/monitorStore(['"])/g,
    replacer: (match, p1, p2, offset, str, filepath) => {
      let relativePath = path.relative(path.dirname(filepath), path.join(__dirname, '..', 'src/features/monitor/model/monitorStore')).replace(/\\/g, '/');
      if (!relativePath.startsWith('.')) relativePath = './' + relativePath;
      return `${p1}${relativePath}${p2}`;
    }
  },
  {
    regex: /(['"])(?:\.\.\/)+features\/monitor\/model\/monitorStore(['"])/g,
    replacer: (match, p1, p2, offset, str, filepath) => {
      let relativePath = path.relative(path.dirname(filepath), path.join(__dirname, '..', 'src/features/monitor/model/monitorStore')).replace(/\\/g, '/');
      if (!relativePath.startsWith('.')) relativePath = './' + relativePath;
      return `${p1}${relativePath}${p2}`;
    }
  },
  {
    regex: /(['"])\.\/model\/monitorStore(['"])/g,
    replacer: (match, p1, p2, offset, str, filepath) => {
      let relativePath = path.relative(path.dirname(filepath), path.join(__dirname, '..', 'src/features/monitor/model/monitorStore')).replace(/\\/g, '/');
      if (!relativePath.startsWith('.')) relativePath = './' + relativePath;
      return `${p1}${relativePath}${p2}`;
    }
  },
  {
    regex: /(['"])(?:\.\.\/)+stores\/rightPanelStore(['"])/g,
    replacer: (match, p1, p2, offset, str, filepath) => {
      let relativePath = path.relative(path.dirname(filepath), path.join(__dirname, '..', 'src/features/right-panel/model/rightPanelStore')).replace(/\\/g, '/');
      if (!relativePath.startsWith('.')) relativePath = './' + relativePath;
      return `${p1}${relativePath}${p2}`;
    }
  },
  {
    regex: /(['"])(?:\.\.\/)+stores\/cardContentStore(['"])/g,
    replacer: (match, p1, p2, offset, str, filepath) => {
      let relativePath = path.relative(path.dirname(filepath), path.join(__dirname, '..', 'src/features/right-panel/model/cardContentStore')).replace(/\\/g, '/');
      if (!relativePath.startsWith('.')) relativePath = './' + relativePath;
      return `${p1}${relativePath}${p2}`;
    }
  },
  {
    regex: /(['"])(?:\.\.\/)+stores\/draftStore(['"])/g,
    replacer: (match, p1, p2, offset, str, filepath) => {
      let relativePath = path.relative(path.dirname(filepath), path.join(__dirname, '..', 'src/features/right-panel/model/draftStore')).replace(/\\/g, '/');
      if (!relativePath.startsWith('.')) relativePath = './' + relativePath;
      return `${p1}${relativePath}${p2}`;
    }
  },
  {
    regex: /(['"])(?:\.\.\/)+stores\/uiStoreTypes(['"])/g,
    replacer: (match, p1, p2, offset, str, filepath) => {
      let relativePath = path.relative(path.dirname(filepath), path.join(__dirname, '..', 'src/types/uiStoreTypes')).replace(/\\/g, '/');
      if (!relativePath.startsWith('.')) relativePath = './' + relativePath;
      return `${p1}${relativePath}${p2}`;
    }
  },
  {
    regex: /(['"])\.\/uiStoreTypes(['"])/g,
    replacer: (match, p1, p2, offset, str, filepath) => {
      if(filepath.includes('src\\stores\\') || filepath.includes('src/stores/')) {
        let relativePath = path.relative(path.dirname(filepath), path.join(__dirname, '..', 'src/types/uiStoreTypes')).replace(/\\/g, '/');
        if (!relativePath.startsWith('.')) relativePath = './' + relativePath;
        return `${p1}${relativePath}${p2}`;
      }
      return match;
    }
  }
];

function processFile(filePath) {
  let content = fs.readFileSync(filePath, 'utf8');
  let modified = false;

  for (const { regex, replacer } of replacements) {
    const newContent = content.replace(regex, (match, p1, p2, offset, str) => {
      return replacer(match, p1, p2, offset, str, filePath);
    });
    if (newContent !== content) {
      content = newContent;
      modified = true;
    }
  }

  // specific fix for tabTypes.ts
  if (filePath.includes('src/stores/tabs/') || filePath.includes('src\\stores\\tabs\\')) {
      const newContent = content.replace(/(['"])\.\.\/types(['"])/g, '$1../../types$2')
                                .replace(/(['"])\.\.\/core\/([^'"]+)(['"])/g, '$1../../core/$2$3');
      if (newContent !== content) {
          content = newContent;
          modified = true;
      }
  }
  
  // fix for uiStoreTypes.ts importing from domain
  if (filePath.includes('uiStoreTypes.ts')) {
      const newContent = content.replace(/(['"])\.\.\/domain\/style\/styleTypes(['"])/g, '$1../domain/style/styleTypes$2');
      if (newContent !== content) {
          content = newContent;
          modified = true;
      }
  }

  if (modified) {
    fs.writeFileSync(filePath, content, 'utf8');
    console.log(`Updated: ${filePath}`);
  }
}

function walkDir(dir) {
  const files = fs.readdirSync(dir);
  for (const file of files) {
    const fullPath = path.join(dir, file);
    if (fs.statSync(fullPath).isDirectory()) {
      walkDir(fullPath);
    } else if (fullPath.endsWith('.ts') || fullPath.endsWith('.tsx')) {
      processFile(fullPath);
    }
  }
}

walkDir(directoryToSearch);

// Process App.tsx
processFile(path.join(__dirname, '..', 'src', 'App.tsx'));
