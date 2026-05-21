const fs = require('fs');
const content = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" width="1024" height="1024">
  <defs>
    <!-- 背景：单层蓝紫科技风渐变 -->
    <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#4f46e5" />    <!-- Indigo 600 -->
      <stop offset="100%" stop-color="#7c3aed" />  <!-- Violet 600 -->
    </linearGradient>

    <!-- 节点渐变：配合深色背景，使用高明度/高纯度的亮色渐变，让图谱发光 -->
    <linearGradient id="gradMain" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#f8fafc" />  <!-- 几乎纯白 -->
      <stop offset="100%" stop-color="#e2e8f0" /> <!-- 浅灰白 -->
    </linearGradient>
    <linearGradient id="gradTR" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#f472b6" />  <!-- Pink 400 -->
      <stop offset="100%" stop-color="#ec4899" /> <!-- Pink 600 -->
    </linearGradient>
    <linearGradient id="gradBL" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#38bdf8" />  <!-- Sky 400 -->
      <stop offset="100%" stop-color="#0284c7" /> <!-- Sky 600 -->
    </linearGradient>
    <linearGradient id="gradBR" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#fde047" />  <!-- Amber 300 -->
      <stop offset="100%" stop-color="#f59e0b" /> <!-- Amber 500 -->
    </linearGradient>

    <!-- 连线：半透明的白色/浅蓝色，在深色背景上形成发光的神经元网络感 -->
    <linearGradient id="lineGrad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#ffffff" stop-opacity="0.6" />
      <stop offset="100%" stop-color="#e0e7ff" stop-opacity="0.3" />
    </linearGradient>

    <!-- 统一的高级悬浮阴影 -->
    <filter id="nodeShadow" x="-30%" y="-30%" width="160%" height="160%">
      <feDropShadow dx="0" dy="16" stdDeviation="20" flood-color="#000000" flood-opacity="0.25" />
      <feDropShadow dx="0" dy="4" stdDeviation="8" flood-color="#000000" flood-opacity="0.15" />
    </filter>
  </defs>

  <!-- 单层背景 (蓝紫科技风) -->
  <rect width="1024" height="1024" rx="224" fill="url(#bg)" />
  
  <!-- 边缘高光和描边，增加立体质感 -->
  <rect x="2" y="2" width="1020" height="1020" rx="222" fill="none" stroke="#ffffff" stroke-opacity="0.15" stroke-width="4" />
  <rect x="0" y="0" width="1024" height="1024" rx="224" fill="none" stroke="#000000" stroke-opacity="0.1" stroke-width="2" />

  <!-- 抽象的文档文本线 (改为半透明白色，适应深色背景) -->
  <g fill="#ffffff" opacity="0.25">
    <rect x="220" y="240" width="280" height="24" rx="12" />
    <rect x="220" y="300" width="180" height="24" rx="12" />
    <rect x="220" y="360" width="340" height="24" rx="12" opacity="0.6" />
  </g>

  <!-- 图谱连线 (置于节点底层) -->
  <g fill="none" stroke="url(#lineGrad)" stroke-width="18" stroke-linecap="round">
    <!-- 连接主节点与右上节点 (优美的S型曲线) -->
    <path d="M 560 560 C 560 400 780 460 780 300" />
    <!-- 连接主节点与左下节点 -->
    <path d="M 560 560 C 400 560 320 640 320 780" />
    <!-- 连接主节点与右下节点 (直线) -->
    <path d="M 560 560 L 780 760" />
    <!-- 连接主节点与左侧节点 (直线) -->
    <path d="M 560 560 L 240 520" />
  </g>

  <!-- 知识节点 (带悬浮阴影，在深色背景上发光) -->
  <g filter="url(#nodeShadow)">
    <!-- 核心大脑/主节点 (改为明亮的白灰色，形成强烈的中心视觉焦点) -->
    <circle cx="560" cy="560" r="88" fill="url(#gradMain)" />
    <!-- 核心节点内部的彩色点缀，呼应背景色 -->
    <circle cx="560" cy="560" r="28" fill="#6366f1" opacity="0.95" />

    <!-- 右上灵感节点 (粉色) -->
    <circle cx="780" cy="300" r="64" fill="url(#gradTR)" />
    <circle cx="780" cy="300" r="20" fill="#ffffff" opacity="0.95" />

    <!-- 左下延展节点 (天蓝色) -->
    <circle cx="320" cy="780" r="72" fill="url(#gradBL)" />
    <circle cx="320" cy="780" r="24" fill="#ffffff" opacity="0.95" />

    <!-- 右下小节点 (明黄色) -->
    <circle cx="780" cy="760" r="44" fill="url(#gradBR)" />

    <!-- 左侧小节点 (白灰色) -->
    <circle cx="240" cy="520" r="36" fill="#f1f5f9" />
  </g>
</svg>`;

fs.writeFileSync('public/icon.svg', Buffer.from(content, 'utf8'));
fs.writeFileSync('build/icon.svg', Buffer.from(content, 'utf8'));
console.log('Done');