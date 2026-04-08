/**
 * 知识节点的 Markdown 文档内容
 */
var MD = {};

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
