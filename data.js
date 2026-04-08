// ===================== 域颜色方案 =====================
const DOMAIN_COLORS = {
  'ai-base':  { bg: '#4a6fa5', border: '#3d5d8a', light: '#e8eef6' },
  'ml-base':  { bg: '#5a8f7b', border: '#4a7a68', light: '#e8f4ef' },
  'dl-core':  { bg: '#7b68ae', border: '#6555a0', light: '#f0ecf8' },
  'nlp':      { bg: '#c0723a', border: '#a5612f', light: '#faf0e6' },
  'cv':       { bg: '#2e86ab', border: '#24708f', light: '#e5f2f8' },
  'speech':   { bg: '#a23b72', border: '#8b3062', light: '#f6e8f0' },
  'llm':      { bg: '#d64045', border: '#b5353a', light: '#fce8e8' },
  'ai-eng':   { bg: '#5b7065', border: '#4a5d54', light: '#eaf0ec' },
  // 子域继承父域色系，稍微偏移
  'supervised':   { bg: '#6aab8d', border: '#5a9a7d', light: '#ecf7f1' },
  'unsupervised': { bg: '#7bbfa0', border: '#5a8f7b', light: '#ecf7f1' },
  'cnn':       { bg: '#8e7bc4', border: '#7b68ae', light: '#f3eff9' },
  'rnn':       { bg: '#9d8ad0', border: '#7b68ae', light: '#f3eff9' },
  'attention': { bg: '#6d5ca0', border: '#5a4b90', light: '#eee9f5' },
  'bert':      { bg: '#d48a4f', border: '#c0723a', light: '#fdf3e8' },
  'gpt':       { bg: '#e09050', border: '#c0723a', light: '#fdf3e8' },
  'detection': { bg: '#3a9bc0', border: '#2e86ab', light: '#e8f4fa' },
  'segmentation': { bg: '#4aafcc', border: '#2e86ab', light: '#e8f4fa' },
  'asr':       { bg: '#b84d80', border: '#a23b72', light: '#f8ebf2' },
  'tts':       { bg: '#c55f90', border: '#a23b72', light: '#f8ebf2' },
  'transformer':  { bg: '#e05558', border: '#d64045', light: '#fdeaea' },
  'rag':          { bg: '#e56568', border: '#d64045', light: '#fdeaea' },
  'agent':        { bg: '#da4a4e', border: '#b5353a', light: '#fdeaea' },
  'sft':          { bg: '#e87578', border: '#d64045', light: '#fdeaea' },
  'ppo':          { bg: '#c83a3e', border: '#b5353a', light: '#fdeaea' },
  'moe':          { bg: '#eb8585', border: '#d64045', light: '#fdeaea' },
  'quantization': { bg: '#cf5558', border: '#b5353a', light: '#fdeaea' },
  'prompt':       { bg: '#e09898', border: '#d64045', light: '#fdeaea' },
  'mlops':     { bg: '#6d8578', border: '#5b7065', light: '#edf2ee' },
  'inference':  { bg: '#7a9588', border: '#5b7065', light: '#edf2ee' },
  // Transformer 子概念
  'self-attn':  { bg: '#e87070', border: '#d64045', light: '#fdeaea' },
  'multi-head': { bg: '#ec8080', border: '#d64045', light: '#fdeaea' },
  'ffn':        { bg: '#d05558', border: '#b5353a', light: '#fdeaea' },
  'pos-enc':    { bg: '#e56060', border: '#d64045', light: '#fdeaea' },
};

// ===================== Markdown 知识内容 =====================
const MD = {};

MD['ai-base'] = `# AI 基础
## 定义
人工智能是计算机科学的核心分支，致力于创建能模拟人类智能行为的系统。
## 核心范式
- **符号主义**：逻辑规则（专家系统）
- **连接主义**：神经网络（深度学习）
- **行为主义**：强化学习
## 应用
智能助手、自动驾驶、医疗诊断、推荐系统、代码生成
`;

MD['ml-base'] = `# 机器学习
## 定义
通过算法从数据中自动学习规律并做出预测。
## 核心范式
| 范式 | 描述 | 算法 |
|------|------|------|
| 监督学习 | 有标签→分类/回归 | SVM, XGBoost |
| 无监督学习 | 无标签→聚类/降维 | K-Means, PCA |
| 强化学习 | 奖励→策略 | DQN, PPO |
`;
MD['supervised'] = `# 监督学习
有标签训练数据学习 f: X→y，包含分类和回归。
## 关键算法
线性回归、逻辑回归、SVM、决策树、随机森林、XGBoost
`;
MD['unsupervised'] = `# 无监督学习
无标签数据中发现隐藏结构。
## 关键任务
聚类（K-Means）、降维（PCA, t-SNE）、异常检测
`;

MD['dl-core'] = `# 深度学习
## 定义
多层神经网络自动学习层次化特征表示。
## 核心思想
端到端学习、反向传播、通用近似
## 架构
CNN（图像）→ RNN（序列）→ Transformer（全领域）→ Diffusion（生成）
`;
MD['cnn'] = `# CNN 卷积神经网络
卷积核提取空间特征，图像处理基础架构。
## 经典模型
AlexNet → VGG → ResNet → EfficientNet
`;
MD['rnn'] = `# RNN / LSTM
循环网络建模序列依赖，LSTM 通过门控解决长期记忆。
## 应用
文本分类、时间序列、Seq2Seq 翻译
`;
MD['attention'] = `# 注意力机制
动态聚焦于输入中最相关的部分。
## 公式
Attention(Q,K,V) = softmax(QK^T/√d_k)·V
## 类型
Self-Attention、Cross-Attention、Multi-Head、Flash Attention
`;

MD['nlp'] = `# 自然语言处理
让计算机理解和生成人类语言。
## 演进
规则 → 统计(HMM) → 神经(RNN) → 预训练(Transformer)
## 核心任务
文本分类、NER、翻译、摘要、问答、对话
`;
MD['bert'] = `# BERT
双向 Transformer Encoder，MLM + NSP 预训练。
适合理解类任务：分类、NER、问答。
`;
MD['gpt'] = `# GPT 系列
Decoder-only Transformer，因果语言模型。
GPT-1 → GPT-2 → GPT-3 → GPT-4，生成能力不断增强。
`;

MD['cv'] = `# 计算机视觉
让计算机"看懂"图像和视频。
## 演进
CNN → Vision Transformer → 多模态(CLIP)
## 任务
分类、检测、分割、生成、3D视觉
`;
MD['detection'] = `# 目标检测
同时定位和识别图像中的物体。
## 方法
两阶段(Faster R-CNN) → 单阶段(YOLO) → Transformer(DETR)
`;
MD['segmentation'] = `# 图像分割
像素级分类。语义分割(U-Net)、实例分割(Mask R-CNN)、通用分割(SAM)。
`;

MD['speech'] = `# 语音与音频
ASR（语音识别）、TTS（语音合成）、声纹识别、音乐生成。
## 演进
GMM-HMM → 端到端 → 自监督(wav2vec) → Whisper/GPT-4o
`;
MD['asr'] = `# 语音识别 ASR
语音→文字。代表：Whisper, Conformer。
`;
MD['tts'] = `# 语音合成 TTS
文字→语音。代表：VITS, CosyVoice, Bark。
`;

MD['llm'] = `# 大语言模型
基于 Transformer 的超大规模神经网络。
## 核心
Scaling Law + 涌现能力 + 预训练→SFT→RLHF
## 里程碑
GPT-3(2020) → ChatGPT(2022) → GPT-4(2023) → DeepSeek-R1(2025)
`;
MD['transformer'] = `# Transformer
2017 "Attention is All You Need"，自注意力机制。
## 组件
Self-Attention + Multi-Head + FFN + Residual + LayerNorm
## 变体
Encoder-only(BERT) / Decoder-only(GPT) / Enc-Dec(T5)
`;
MD['self-attn'] = `# Self-Attention
每个位置可直接关注序列中所有位置，并行计算。
Attention(Q,K,V) = softmax(QK^T/√d_k)·V
`;
MD['multi-head'] = `# Multi-Head Attention
多组独立注意力头，从不同子空间捕获信息，最后拼接输出。
`;
MD['ffn'] = `# Feed-Forward Network
逐位置的两层全连接 + 激活函数（ReLU/GELU）。
`;
MD['pos-enc'] = `# 位置编码
为 Transformer 注入序列位置信息。
## 方法
正弦编码 → 可学习编码 → RoPE → ALiBi
`;

MD['rag'] = `# RAG 检索增强生成
检索外部知识 + LLM 生成，解决幻觉问题。
## 流程
提问→Embedding→向量检索→Top-K→LLM生成
`;
MD['agent'] = `# AI Agent
LLM 为大脑，感知→规划→工具调用→执行→反思。
## 框架
LangGraph, CrewAI, OpenAI Assistants
`;
MD['sft'] = `# SFT 监督微调
用指令数据让模型学会"回答"。方法：Full FT / LoRA / QLoRA。
`;
MD['ppo'] = `# PPO / RLHF
人类偏好反馈对齐模型。SFT→Reward Model→PPO。替代：DPO。
`;
MD['moe'] = `# MoE 混合专家
门控网络选 Top-K 专家，稀疏激活。GPT-4/Mixtral 采用。
`;
MD['quantization'] = `# 量化
FP16→INT4 压缩模型。GPTQ/AWQ/GGUF/bitsandbytes。
`;
MD['prompt'] = `# Prompt Engineering
设计提示引导 LLM 输出。Zero-Shot / Few-Shot / CoT / ReAct。
`;

MD['ai-eng'] = `# AI 工程部署
模型→生产服务全流程。优化、推理、API、监控、MLOps。
`;
MD['mlops'] = `# MLOps
ML 全生命周期管理。MLflow, Kubeflow, W&B。
`;
MD['inference'] = `# 推理优化
量化 + KV Cache + PagedAttention + Continuous Batching + 推测解码。
`;

// ===================== 节点定义（多层嵌套卡片） =====================
const graphNodes = [
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

  // Transformer 子节点（第 3 层示例）
  { data: { id: 'self-attn',  label: 'Self-Attention', level: 3, parent: 'transformer' }, classes: 'card' },
  { data: { id: 'multi-head', label: 'Multi-Head',     level: 3, parent: 'transformer' }, classes: 'card' },
  { data: { id: 'ffn',        label: 'FFN',            level: 3, parent: 'transformer' }, classes: 'card' },
  { data: { id: 'pos-enc',    label: '位置编码',       level: 3, parent: 'transformer' }, classes: 'card' },
];

// ===================== 边定义 =====================
const graphEdges = [
  // 顶层主线
  { data: { id: 'e1', source: 'ai-base', target: 'ml-base',  relation: '演进', weight: 'main' } },
  { data: { id: 'e2', source: 'ml-base', target: 'dl-core',  relation: '演进', weight: 'main' } },
  { data: { id: 'e3', source: 'dl-core', target: 'nlp',      relation: '依赖', weight: 'main' } },
  { data: { id: 'e4', source: 'dl-core', target: 'cv',       relation: '依赖', weight: 'main' } },
  { data: { id: 'e5', source: 'dl-core', target: 'speech',   relation: '依赖', weight: 'main' } },
  { data: { id: 'e6', source: 'dl-core', target: 'llm',      relation: '演进', weight: 'main' } },
  { data: { id: 'e7', source: 'llm',     target: 'ai-eng',   relation: '依赖', weight: 'main' } },
  { data: { id: 'e8', source: 'nlp',     target: 'llm',      relation: '演进', weight: 'main' } },
  // 次线
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

  // Transformer 内部（第 3 层）
  { data: { id: 'e40', source: 'self-attn', target: 'multi-head', relation: '演进', weight: 'main' } },
  { data: { id: 'e41', source: 'multi-head', target: 'ffn',       relation: '依赖', weight: 'main' } },
  { data: { id: 'e42', source: 'pos-enc',    target: 'self-attn', relation: '依赖', weight: 'main' } },

  // NLP 内部
  { data: { id: 'e50', source: 'bert', target: 'gpt', relation: '演进', weight: 'main' } },
];
