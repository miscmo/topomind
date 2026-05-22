const fs = require('fs');
const path = require('path');

function walk(dir) {
  let results = [];
  const list = fs.readdirSync(dir);
  list.forEach(function(file) {
    file = path.join(dir, file);
    const stat = fs.statSync(file);
    if (stat && stat.isDirectory()) { 
      results = results.concat(walk(file));
    } else if (file.endsWith('.tsx') || file.endsWith('.ts')) {
      results.push(file);
    }
  });
  return results;
}

const dirs = [
  'src/components/GraphCanvas',
  'src/components/RightPanel',
  'src/components/MarkdownWorkspace'
];

let replacedFiles = 0;

dirs.forEach(d => {
  const fullDir = path.join('D:/Code/topomind_cc', d);
  if (!fs.existsSync(fullDir)) return;
  const files = walk(fullDir);
  
  files.forEach(file => {
    let content = fs.readFileSync(file, 'utf8');
    let original = content;
    
    // Globally replace common slow durations with duration-75 to make UI snappier
    content = content.replace(/\bduration-150\b/g, 'duration-75');
    content = content.replace(/\bduration-160\b/g, 'duration-75');
    content = content.replace(/\bduration-180\b/g, 'duration-75');
    content = content.replace(/\bduration-200\b/g, 'duration-75');
    content = content.replace(/\bduration-300\b/g, 'duration-75');

    if (content !== original) {
      fs.writeFileSync(file, content, 'utf8');
      replacedFiles++;
      console.log('Updated', file);
    }
  });
});
console.log('Done. Files updated:', replacedFiles);
