/**
 * Electron 文件操作服务
 * 封装 Node.js fs 模块，提供 Markdown 和图片的读写能力
 */
const fs = require('fs');
const path = require('path');
const { app } = require('electron');

// 默认工作目录
let workDir = path.join(app.getPath('documents'), 'TopoMind');

function getWorkDir() { return workDir; }

function setWorkDir(dir) {
  workDir = dir;
  ensureDirs();
}

function ensureDirs() {
  const dirs = [workDir, path.join(workDir, 'docs'), path.join(workDir, 'images')];
  dirs.forEach(function(d) {
    if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
  });
}

// ===== Markdown =====

function readMarkdown(nodeId) {
  const filePath = path.join(workDir, 'docs', nodeId + '.md');
  if (fs.existsSync(filePath)) return fs.readFileSync(filePath, 'utf-8');
  return '';
}

function writeMarkdown(nodeId, content) {
  ensureDirs();
  const filePath = path.join(workDir, 'docs', nodeId + '.md');
  fs.writeFileSync(filePath, content, 'utf-8');
}

function deleteMarkdownFile(nodeId) {
  const filePath = path.join(workDir, 'docs', nodeId + '.md');
  if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
}

function listMarkdownFiles() {
  const docsDir = path.join(workDir, 'docs');
  if (!fs.existsSync(docsDir)) return [];
  return fs.readdirSync(docsDir)
    .filter(function(f) { return f.endsWith('.md'); })
    .map(function(f) {
      const nodeId = f.replace(/\.md$/, '');
      const content = fs.readFileSync(path.join(docsDir, f), 'utf-8');
      return { id: nodeId, content: content };
    });
}

// ===== 图片 =====

function writeImage(filename, buffer) {
  ensureDirs();
  const filePath = path.join(workDir, 'images', filename);
  fs.writeFileSync(filePath, Buffer.from(buffer));
  return filePath;
}

function readImage(filename) {
  const filePath = path.join(workDir, 'images', filename);
  if (!fs.existsSync(filePath)) return null;
  return fs.readFileSync(filePath);
}

function deleteImage(filename) {
  const filePath = path.join(workDir, 'images', filename);
  if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
}

function listImages() {
  const imgDir = path.join(workDir, 'images');
  if (!fs.existsSync(imgDir)) return [];
  return fs.readdirSync(imgDir).filter(function(f) {
    return /\.(png|jpg|jpeg|gif|webp|svg)$/i.test(f);
  });
}

// ===== 导出/导入 =====

function writeJsonFile(filename, data) {
  const filePath = path.join(workDir, filename);
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
  return filePath;
}

function readJsonFile(filePath) {
  if (!fs.existsSync(filePath)) return null;
  return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
}

// ===== 目录选择 =====

function selectDirectory(dialog) {
  const result = dialog.showOpenDialogSync({
    title: '选择 TopoMind 工作目录',
    properties: ['openDirectory', 'createDirectory']
  });
  if (result && result[0]) {
    setWorkDir(result[0]);
    return result[0];
  }
  return null;
}

module.exports = {
  getWorkDir, setWorkDir, ensureDirs,
  readMarkdown, writeMarkdown, deleteMarkdownFile, listMarkdownFiles,
  writeImage, readImage, deleteImage, listImages,
  writeJsonFile, readJsonFile, selectDirectory
};
