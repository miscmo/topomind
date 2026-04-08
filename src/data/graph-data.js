/**
 * 知识图谱节点和边定义
 * 使用 Cytoscape compound graph 模型（parent 字段实现嵌套）
 */

var graphNodes = [
  // 顶层 8 大域
  { data: { id: 'ai-base', label: 'AI 基础',      level: 1 }, classes: 'card' },
  { data: { id: 'ml-base', label: '机器学习',     level: 1 }, classes: 'card' },
  { data: { id: 'dl-core', label: '深度学习',     level: 1 }, classes: 'card' },
  { data: { id: 'nlp',     label: '自然语言处理', level: 1 }, classes: 'card' },
  { data: { id: 'cv',      label: '计算机视觉',   level: 1 }, classes: 'card' },
  { data: { id: 'speech',  label: '语音音频',     level: 1 }, classes: 'card' },
  { data: { id: 'llm',     label: '大模型 LLM',   level: 1 }, classes: 'card' },
  { data: { id: 'ai-eng',  label: 'AI 工程部署',  level: 1 }, classes: 'card' },

  // ML 子节点
  { data: { id: 'supervised',   label: '监督学习',   level: 2, parent: 'ml-base' }, classes: 'card' },
  { data: { id: 'unsupervised', label: '无监督学习', level: 2, parent: 'ml-base' }, classes: 'card' },

  // DL 子节点
  { data: { id: 'cnn',       label: 'CNN',        level: 2, parent: 'dl-core' }, classes: 'card' },
  { data: { id: 'rnn',       label: 'RNN/LSTM',   level: 2, parent: 'dl-core' }, classes: 'card' },
  { data: { id: 'attention', label: '注意力机制', level: 2, parent: 'dl-core' }, classes: 'card' },

  // NLP 子节点
  { data: { id: 'bert', label: 'BERT', level: 2, parent: 'nlp' }, classes: 'card' },
  { data: { id: 'gpt',  label: 'GPT',  level: 2, parent: 'nlp' }, classes: 'card' },

  // CV 子节点
  { data: { id: 'detection',    label: '目标检测', level: 2, parent: 'cv' }, classes: 'card' },
  { data: { id: 'segmentation', label: '图像分割', level: 2, parent: 'cv' }, classes: 'card' },

  // Speech 子节点
  { data: { id: 'asr', label: 'ASR', level: 2, parent: 'speech' }, classes: 'card' },
  { data: { id: 'tts', label: 'TTS', level: 2, parent: 'speech' }, classes: 'card' },

  // LLM 子节点
  { data: { id: 'transformer',  label: 'Transformer', level: 2, parent: 'llm' }, classes: 'card' },
  { data: { id: 'rag',          label: 'RAG',         level: 2, parent: 'llm' }, classes: 'card' },
  { data: { id: 'agent',        label: 'Agent',       level: 2, parent: 'llm' }, classes: 'card' },
  { data: { id: 'sft',          label: 'SFT 微调',   level: 2, parent: 'llm' }, classes: 'card' },
  { data: { id: 'ppo',          label: 'PPO/RLHF',   level: 2, parent: 'llm' }, classes: 'card' },
  { data: { id: 'moe',          label: 'MoE',         level: 2, parent: 'llm' }, classes: 'card' },
  { data: { id: 'quantization', label: '量化',        level: 2, parent: 'llm' }, classes: 'card' },
  { data: { id: 'prompt',       label: 'Prompt',      level: 2, parent: 'llm' }, classes: 'card' },

  // AI 工程子节点
  { data: { id: 'mlops',     label: 'MLOps',    level: 2, parent: 'ai-eng' }, classes: 'card' },
  { data: { id: 'inference',  label: '推理优化', level: 2, parent: 'ai-eng' }, classes: 'card' },

  // Transformer 子节点（第 3 层）
  { data: { id: 'self-attn',  label: 'Self-Attention', level: 3, parent: 'transformer' }, classes: 'card' },
  { data: { id: 'multi-head', label: 'Multi-Head',     level: 3, parent: 'transformer' }, classes: 'card' },
  { data: { id: 'ffn',        label: 'FFN',            level: 3, parent: 'transformer' }, classes: 'card' },
  { data: { id: 'pos-enc',    label: '位置编码',       level: 3, parent: 'transformer' }, classes: 'card' },
];

var graphEdges = [
  // 顶层主线
  { data: { id: 'e1', source: 'ai-base', target: 'ml-base',  relation: '演进', weight: 'main' } },
  { data: { id: 'e2', source: 'ml-base', target: 'dl-core',  relation: '演进', weight: 'main' } },
  { data: { id: 'e3', source: 'dl-core', target: 'nlp',      relation: '依赖', weight: 'main' } },
  { data: { id: 'e4', source: 'dl-core', target: 'cv',       relation: '依赖', weight: 'main' } },
  { data: { id: 'e5', source: 'dl-core', target: 'speech',   relation: '依赖', weight: 'main' } },
  { data: { id: 'e6', source: 'dl-core', target: 'llm',      relation: '演进', weight: 'main' } },
  { data: { id: 'e7', source: 'llm',     target: 'ai-eng',   relation: '依赖', weight: 'main' } },
  { data: { id: 'e8', source: 'nlp',     target: 'llm',      relation: '演进', weight: 'main' } },
  { data: { id: 'e9',  source: 'cv',     target: 'llm',      relation: '相关', weight: 'minor' } },
  { data: { id: 'e10', source: 'speech', target: 'llm',      relation: '相关', weight: 'minor' } },
  // DL 内部
  { data: { id: 'e15', source: 'rnn',       target: 'attention', relation: '演进', weight: 'main' } },
  { data: { id: 'e16', source: 'attention', target: 'transformer', relation: '演进', weight: 'main' } },
  // LLM 内部
  { data: { id: 'e30', source: 'transformer', target: 'sft',  relation: '依赖', weight: 'main' } },
  { data: { id: 'e31', source: 'sft',  target: 'ppo',         relation: '演进', weight: 'main' } },
  { data: { id: 'e36', source: 'transformer', target: 'moe',  relation: '依赖', weight: 'main' } },
  { data: { id: 'e32', source: 'rag',    target: 'agent',     relation: '相关', weight: 'minor' } },
  { data: { id: 'e33', source: 'prompt', target: 'rag',       relation: '相关', weight: 'minor' } },
  { data: { id: 'e34', source: 'prompt', target: 'agent',     relation: '相关', weight: 'minor' } },
  { data: { id: 'e35', source: 'moe',    target: 'quantization', relation: '相关', weight: 'minor' } },
  { data: { id: 'e37', source: 'quantization', target: 'inference', relation: '相关', weight: 'minor' } },
  // Transformer 内部
  { data: { id: 'e40', source: 'self-attn', target: 'multi-head', relation: '演进', weight: 'main' } },
  { data: { id: 'e41', source: 'multi-head', target: 'ffn',       relation: '依赖', weight: 'main' } },
  { data: { id: 'e42', source: 'pos-enc',    target: 'self-attn', relation: '依赖', weight: 'main' } },
  // NLP 内部
  { data: { id: 'e50', source: 'bert', target: 'gpt', relation: '演进', weight: 'main' } },
];
