const fs = require('fs');
const path = require('path');

function replaceImports(dir) {
  const files = fs.readdirSync(dir);
  for (const file of files) {
    const fullPath = path.join(dir, file);
    if (fs.statSync(fullPath).isDirectory()) {
      replaceImports(fullPath);
    } else if (fullPath.endsWith('.ts') || fullPath.endsWith('.tsx')) {
      let content = fs.readFileSync(fullPath, 'utf8');
      
      // Fix imports from 'src/components/' to 'src/features/'
      // Since it was 'src/components/GraphCanvas/nodes/KnowledgeCard.tsx',
      // going to `../../../types` meant `src/types`
      // Now it's `src/features/graph/GraphCanvas/nodes/KnowledgeCard.tsx`
      // so it needs to be `../../../../types`.
      // The depth increased by 1 for all cross-feature imports outside the feature itself.
      
      // We can regex replace import paths starting with '.' or '..'
      const lines = content.split('\n');
      const newLines = lines.map(line => {
        if (line.trim().startsWith('import ') || line.trim().startsWith('export ')) {
          return line.replace(/from\s+['"]([^'"]+)['"]/, (match, p1) => {
            if (p1.startsWith('..')) {
              // Check if it's pointing to something outside the current folder structure.
              // A simple heuristic: if it goes up to `src`, it needs one more `..`
              // Let's just blindly add one `../` to all `../` paths that point outside the module.
              // Wait, it's safer to resolve the original path and re-relativize.
              
              const oldRelativeDir = path.dirname(fullPath).replace('features\\graph', 'components').replace('features\\kb', 'components').replace('features\\monitor', 'components').replace('features\\documents', 'components');
              const targetPath = path.resolve(oldRelativeDir, p1);
              
              // New relative dir
              const newRelativeDir = path.dirname(fullPath);
              let newImport = path.relative(newRelativeDir, targetPath).replace(/\\/g, '/');
              if (!newImport.startsWith('.')) {
                newImport = './' + newImport;
              }
              
              // We also need to rewrite 'components/X' to 'features/x/X' if the target path was moved!
              // e.g. targetPath ends with 'src/components/Toolbar/Toolbar' -> we leave it for now
              return `from '${newImport}'`;
            }
            return match;
          });
        }
        return line;
      });
      
      fs.writeFileSync(fullPath, newLines.join('\n'));
    }
  }
}

replaceImports(path.join(__dirname, 'src/features/graph'));
replaceImports(path.join(__dirname, 'src/features/kb'));
