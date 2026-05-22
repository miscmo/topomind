import { unified } from 'unified'; import remarkParse from 'remark-parse'; import remarkGfm from 'remark-gfm'; import { visit } from 'unist-util-visit';
const remarkTest = () => (tree) => {
  visit(tree, (node) => {
    if (node.type === 'image') {
      node.data = node.data || {};
      node.data.hProperties = node.data.hProperties || {};
      node.data.hProperties['data-image-index'] = 42;
    }
    if (node.type === 'code') {
      node.data = node.data || {};
      node.data.hProperties = node.data.hProperties || {};
      node.data.hProperties['data-code-index'] = 100;
    }
    if (node.type === 'listItem') {
      node.data = node.data || {};
      node.data.hProperties = node.data.hProperties || {};
      node.data.hProperties['data-task-index'] = 7;
    }
  });
};
const processor = unified().use(remarkParse).use(remarkGfm).use(remarkTest);
const tree = processor.parse('- [x] task\n\n\\\js\ncode\n\\\\n\n![alt](src)');
const tree2 = processor.runSync(tree);
console.log(JSON.stringify(tree2, null, 2));
