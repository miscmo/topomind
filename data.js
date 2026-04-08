// ===================== Markdown 知识内容 =====================
const MD = {};

MD['ai-base'] = `# AI 基础（Artificial Intelligence）

## 定义
人工智能是计算机科学的核心分支，致力于创建能模拟人类智能行为的系统——包括学习、推理、感知、决策和语言理解。

## 核心思想
- **符号主义**：用逻辑规则表达知识（专家系统）
- **连接主义**：用神经网络模拟大脑（深度学习）
- **行为主义**：通过与环境交互学习策略（强化学习）

## 关键领域

| 领域 | 描述 | 代表技术 |
|------|------|----------|
| 机器学习 | 从数据中学习规律 | SVM, 决策树, 神经网络 |
| 自然语言处理 | 理解和生成文本 | Transformer, BERT, GPT |
| 计算机视觉 | 理解图像和视频 | CNN, YOLO, ViT |
| 语音处理 | 语音识别与合成 | Whisper, TTS |
| 强化学习 | 基于奖励的学习 | DQN, PPO, RLHF |

## 应用场景
- 智能助手（ChatGPT、Siri、Alexa）
- 自动驾驶（Tesla FSD、Waymo）
- 医疗诊断（影像识别、药物发现）
- 推荐系统（抖音、Netflix、Spotify）
- 代码生成（Copilot、Cursor）

## 代码示例

\`\`\`python
# 简单感知机示例
import numpy as np

class Perceptron:
    def __init__(self, lr=0.01, epochs=100):
        self.lr = lr
        self.epochs = epochs

    def fit(self, X, y):
        self.weights = np.zeros(X.shape[1])
        self.bias = 0
        for _ in range(self.epochs):
            for xi, yi in zip(X, y):
                update = self.lr * (yi - self.predict(xi))
                self.weights += update * xi
                self.bias += update

    def predict(self, x):
        return 1 if np.dot(x, self.weights) + self.bias >= 0 else 0
\`\`\`

## 关联知识点
> AI 基础是所有子领域的根基，包含机器学习、深度学习、NLP、CV 等方向。理解 AI 全貌是深入各子领域的前提。
`;

MD['ml-base'] = `# 机器学习（Machine Learning）

## 定义
机器学习是 AI 的核心子领域，通过算法让计算机从数据中自动学习规律并做出预测或决策，无需显式编程。

## 核心思想
- **监督学习**：有标签数据 → 分类 / 回归
- **无监督学习**：无标签数据 → 聚类 / 降维
- **半监督学习**：少量标签 + 大量无标签
- **强化学习**：通过试错与奖励学习策略

## 关键算法

| 类别 | 算法 | 用途 |
|------|------|------|
| 线性模型 | 线性回归、逻辑回归 | 回归、二分类 |
| 树模型 | 决策树、随机森林、XGBoost | 分类、回归 |
| 核方法 | SVM | 分类、回归 |
| 聚类 | K-Means、DBSCAN | 数据分组 |
| 降维 | PCA、t-SNE、UMAP | 特征压缩可视化 |
| 集成 | Bagging、Boosting、Stacking | 提升模型性能 |

## 评估指标
- **分类**：Accuracy、Precision、Recall、F1、AUC-ROC
- **回归**：MSE、RMSE、MAE、R²
- **聚类**：轮廓系数、CH 指数

## 应用场景
- 信用评分与欺诈检测
- 推荐系统
- 图像分类（传统特征工程 + SVM）
- 时间序列预测

## 代码示例

\`\`\`python
from sklearn.ensemble import RandomForestClassifier
from sklearn.model_selection import train_test_split
from sklearn.metrics import classification_report

X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.2)
clf = RandomForestClassifier(n_estimators=100, max_depth=10)
clf.fit(X_train, y_train)
print(classification_report(y_test, clf.predict(X_test)))
\`\`\`

## 关联知识点
> 机器学习是深度学习的基础；深度学习是 ML 的子集。传统 ML 需手动特征工程，DL 可自动学习特征表示。
`;

MD['dl-core'] = `# 深度学习（Deep Learning）

## 定义
深度学习是机器学习的子集，使用多层神经网络自动学习数据的层次化特征表示，是现代 AI 的核心引擎。

## 核心思想
- **表示学习**：自动从原始数据学习有用特征
- **端到端学习**：输入→输出，无需手动特征工程
- **反向传播**：通过梯度下降优化网络参数
- **通用近似定理**：足够宽/深的网络可近似任意函数

## 关键架构

| 架构 | 特点 | 应用 |
|------|------|------|
| MLP | 全连接，基础架构 | 表格数据 |
| CNN | 卷积核提取空间特征 | 图像、视频 |
| RNN/LSTM | 序列建模，时间依赖 | 文本、时序 |
| Transformer | 自注意力机制，并行化 | NLP、CV、多模态 |
| GAN | 生成对抗网络 | 图像生成 |
| Diffusion | 去噪扩散 | 图像/视频生成 |

## 优化技术
- **优化器**：SGD、Adam、AdamW、LAMB
- **正则化**：Dropout、BatchNorm、LayerNorm
- **学习率调度**：Cosine Annealing、Warmup
- **数据增强**：随机裁剪、MixUp、CutMix

## 代码示例

\`\`\`python
import torch
import torch.nn as nn

class SimpleNet(nn.Module):
    def __init__(self, input_dim, hidden_dim, output_dim):
        super().__init__()
        self.net = nn.Sequential(
            nn.Linear(input_dim, hidden_dim),
            nn.ReLU(),
            nn.Dropout(0.3),
            nn.Linear(hidden_dim, hidden_dim),
            nn.ReLU(),
            nn.Linear(hidden_dim, output_dim)
        )
    def forward(self, x):
        return self.net(x)

model = SimpleNet(784, 256, 10)
optimizer = torch.optim.Adam(model.parameters(), lr=1e-3)
\`\`\`

## 关联知识点
> 深度学习支撑了 NLP、CV、语音、大模型等所有现代 AI 领域。Transformer 是当前最核心的架构。
`;

MD['nlp'] = `# 自然语言处理（NLP）

## 定义
NLP（Natural Language Processing）是让计算机理解、生成和处理人类语言的技术领域。

## 核心思想
- **语言理解**：分词、词性标注、句法分析、语义分析
- **语言生成**：文本续写、摘要、翻译、对话
- **表示学习**：将文本转化为向量（Embedding）

## 发展历程

| 时代 | 方法 | 代表 |
|------|------|------|
| 规则时代 | 手工语法规则 | ELIZA |
| 统计时代 | HMM、CRF、N-gram | 统计机器翻译 |
| 神经网络 | Word2Vec、RNN、Seq2Seq | Google NMT |
| 预训练时代 | Transformer、BERT、GPT | ChatGPT |

## 核心任务
- **文本分类**：情感分析、垃圾邮件过滤
- **命名实体识别（NER）**：提取人名、地名、机构名
- **机器翻译**：中→英、英→法
- **文本摘要**：抽取式 / 生成式
- **问答系统**：阅读理解、开放域问答
- **对话系统**：任务型 / 闲聊

## 关键技术
- **Tokenizer**：BPE、WordPiece、SentencePiece
- **Embedding**：Word2Vec、GloVe、Contextual Embedding
- **注意力机制**：Self-Attention、Cross-Attention

## 代码示例

\`\`\`python
from transformers import pipeline

# 情感分析
classifier = pipeline("sentiment-analysis")
result = classifier("This movie is absolutely amazing!")
print(result)  # [{'label': 'POSITIVE', 'score': 0.9998}]

# 文本生成
generator = pipeline("text-generation", model="gpt2")
text = generator("AI will change the world by", max_length=50)
print(text[0]['generated_text'])
\`\`\`

## 关联知识点
> NLP 的核心架构是 Transformer，当前最强的 NLP 系统是大语言模型（LLM）。RAG 和 Prompt Engineering 是 LLM 时代的重要应用技术。
`;

MD['cv'] = `# 计算机视觉（Computer Vision）

## 定义
计算机视觉是让计算机"看懂"图像和视频的技术领域，从像素中提取高层语义信息。

## 核心思想
- 建立从低级特征（边缘、纹理）到高级概念（物体、场景）的映射
- 理解图像的空间结构和语义内容

## 关键任务

| 任务 | 描述 | 代表模型 |
|------|------|----------|
| 图像分类 | 识别图像类别 | ResNet, ViT, EfficientNet |
| 目标检测 | 定位并分类物体 | YOLO, DETR, Faster R-CNN |
| 语义分割 | 像素级分类 | U-Net, DeepLab, SAM |
| 实例分割 | 区分同类不同实例 | Mask R-CNN |
| 图像生成 | 生成逼真图像 | GAN, Diffusion, DALL·E |
| 3D 视觉 | 深度估计、点云 | NeRF, 3D Gaussian Splatting |

## 核心架构演进
1. **CNN 时代**：AlexNet → VGG → ResNet → EfficientNet
2. **Transformer 时代**：ViT、DeiT、Swin Transformer
3. **多模态时代**：CLIP（图文对齐）、Stable Diffusion（文生图）

## 代码示例

\`\`\`python
import torchvision.models as models
import torchvision.transforms as transforms
from PIL import Image

model = models.resnet50(pretrained=True)
model.eval()
transform = transforms.Compose([
    transforms.Resize(256),
    transforms.CenterCrop(224),
    transforms.ToTensor(),
    transforms.Normalize(mean=[0.485,0.456,0.406], std=[0.229,0.224,0.225]),
])
img = Image.open("example.jpg")
output = model(transform(img).unsqueeze(0))
\`\`\`

## 关联知识点
> 现代 CV 深度依赖深度学习，ViT 引入了 Transformer 架构。多模态模型连接了 CV 和 NLP。
`;

MD['speech'] = `# 语音与音频处理

## 定义
语音音频处理涵盖语音识别（ASR）、语音合成（TTS）、声纹识别、音乐生成等技术。

## 核心思想
- 将声学信号转化为语言信息，或从文本生成自然语音
- 核心是序列到序列的映射问题

## 关键任务

| 任务 | 描述 | 代表模型 |
|------|------|----------|
| ASR（语音识别） | 语音→文字 | Whisper, Conformer |
| TTS（语音合成） | 文字→语音 | VITS, CosyVoice, Bark |
| 语音分离 | 多人语音分离 | DPRNN |
| 声纹识别 | 说话人身份识别 | ECAPA-TDNN |
| 音乐生成 | 生成音乐 | MusicGen, Suno |

## 技术演进
1. **传统**：GMM-HMM、DNN-HMM
2. **端到端**：CTC、Attention-based Seq2Seq
3. **自监督预训练**：wav2vec 2.0、HuBERT
4. **大模型时代**：Whisper、GPT-4o（语音多模态）

## 代码示例

\`\`\`python
import whisper

model = whisper.load_model("base")
result = model.transcribe("audio.mp3")
print(result["text"])
\`\`\`

## 关联知识点
> 语音处理依赖深度学习，现代 ASR/TTS 大量使用 Transformer。GPT-4o 将语音纳入大模型多模态能力。
`;

MD['llm'] = `# 大语言模型（LLM）

## 定义
大语言模型（Large Language Model）是基于 Transformer 架构，在海量文本上预训练的超大规模神经网络，具备强大的语言理解和生成能力。

## 核心思想
- **Scaling Law**：模型规模↑ + 数据量↑ + 计算量↑ → 能力↑
- **涌现能力**：当模型超过阈值，出现推理、上下文学习等能力
- **预训练 + 微调 + 对齐**：三阶段训练范式

## 关键里程碑

| 年份 | 模型 | 参数量 | 亮点 |
|------|------|--------|------|
| 2018 | GPT-1 | 117M | 首个 GPT |
| 2020 | GPT-3 | 175B | In-context Learning |
| 2022 | ChatGPT | — | RLHF 对齐，全球爆火 |
| 2023 | GPT-4 | ~1.8T MoE | 多模态、强推理 |
| 2024 | Llama 3.1 | 405B | 开源最强 |
| 2025 | DeepSeek-R1 | — | 推理模型 |

## 核心技术栈
- **架构**：Decoder-only Transformer
- **训练**：预训练(CLM) → SFT → RLHF/DPO
- **推理**：KV Cache、Speculative Decoding、vLLM
- **部署**：量化(GPTQ/AWQ)、蒸馏、MoE

## 应用场景
- 对话助手（ChatGPT、Claude）
- 代码生成（Copilot、Cursor）
- 知识问答（RAG 增强）
- AI Agent（自主任务完成）

## 代码示例

\`\`\`python
from openai import OpenAI
client = OpenAI(api_key="your-key")

response = client.chat.completions.create(
    model="gpt-4",
    messages=[
        {"role": "system", "content": "你是一位 AI 专家。"},
        {"role": "user", "content": "解释 Transformer 的注意力机制"}
    ],
    temperature=0.7
)
print(response.choices[0].message.content)
\`\`\`

## 关联知识点
> LLM 基于 Transformer，通过 SFT 和 PPO/RLHF 对齐。RAG 增强知识，Agent 赋予行动力。MoE 和量化是关键优化。
`;

MD['ai-eng'] = `# AI 工程与部署

## 定义
AI 工程部署覆盖从模型训练完成到上线服务的全流程，包括模型优化、服务化、监控和 MLOps。

## 核心思想
- 将实验室模型转化为生产级服务
- 关注性能、成本、可靠性和可维护性

## 关键环节

| 环节 | 内容 | 工具 |
|------|------|------|
| 模型优化 | 量化、剪枝、蒸馏 | TensorRT, ONNX, llama.cpp |
| 推理服务 | 高吞吐推理 | vLLM, TGI, Triton |
| API 服务 | RESTful / gRPC | FastAPI, Ray Serve |
| 容器化 | Docker 打包 | Docker, K8s |
| 监控 | 性能与质量 | Prometheus, Grafana |
| MLOps | 训练→部署流水线 | MLflow, Kubeflow, W&B |
| 向量库 | Embedding 检索 | Milvus, Qdrant, Pinecone |

## 推理优化
- **量化**：FP16→INT8→INT4，降低显存和延迟
- **KV Cache**：缓存注意力矩阵，加速自回归
- **Continuous Batching**：动态批处理提升吞吐
- **PagedAttention**：vLLM 高效显存管理

## 代码示例

\`\`\`python
from fastapi import FastAPI
from vllm import LLM, SamplingParams

app = FastAPI()
llm = LLM(model="meta-llama/Llama-3.1-8B-Instruct")

@app.post("/generate")
async def generate(prompt: str, max_tokens: int = 256):
    params = SamplingParams(temperature=0.7, max_tokens=max_tokens)
    outputs = llm.generate([prompt], params)
    return {"text": outputs[0].outputs[0].text}
\`\`\`

## 关联知识点
> AI 工程是所有 AI 技术的落地环节。量化是关键优化手段，RAG 系统需要完整的工程架构。
`;

MD['transformer'] = `# Transformer 架构

## 定义
Transformer 是 2017 年由 Google 提出的神经网络架构（"Attention is All You Need"），完全基于自注意力机制，是现代 AI 的基石。

## 核心思想
- **自注意力**：每个位置可直接关注序列中所有位置
- **并行计算**：摆脱 RNN 的逐步计算限制
- **位置编码**：通过 Positional Encoding 注入序列位置信息

## 架构详解

\`\`\`
输入 → [Encoder × N] → 编码表示
                           ↓
目标 → [Decoder × N] → 输出序列
\`\`\`

### 核心组件
1. **Multi-Head Attention**：多头注意力
2. **Feed-Forward Network**：逐位置全连接
3. **Layer Normalization**：层归一化
4. **Residual Connection**：残差连接

### 注意力公式
Attention(Q, K, V) = softmax(QK^T / sqrt(d_k)) · V

## 变体

| 变体 | 架构 | 代表 |
|------|------|------|
| Encoder-only | 双向注意力 | BERT |
| Decoder-only | 因果注意力 | GPT 系列 |
| Encoder-Decoder | 完整结构 | T5, BART |

## 关键优化
- **Flash Attention**：IO 感知精确注意力，大幅加速
- **RoPE**：旋转位置编码
- **GQA**：减少 KV 头数量
- **Sliding Window**：局部注意力降低复杂度

## 代码示例

\`\`\`python
import torch, torch.nn as nn, math

class MultiHeadAttention(nn.Module):
    def __init__(self, d_model, n_heads):
        super().__init__()
        self.d_k = d_model // n_heads
        self.n_heads = n_heads
        self.W_q = nn.Linear(d_model, d_model)
        self.W_k = nn.Linear(d_model, d_model)
        self.W_v = nn.Linear(d_model, d_model)
        self.W_o = nn.Linear(d_model, d_model)

    def forward(self, Q, K, V, mask=None):
        B = Q.size(0)
        Q = self.W_q(Q).view(B,-1,self.n_heads,self.d_k).transpose(1,2)
        K = self.W_k(K).view(B,-1,self.n_heads,self.d_k).transpose(1,2)
        V = self.W_v(V).view(B,-1,self.n_heads,self.d_k).transpose(1,2)
        scores = torch.matmul(Q, K.transpose(-2,-1)) / math.sqrt(self.d_k)
        if mask is not None: scores = scores.masked_fill(mask==0, -1e9)
        attn = torch.softmax(scores, dim=-1)
        out = torch.matmul(attn, V)
        return self.W_o(out.transpose(1,2).contiguous().view(B,-1,self.n_heads*self.d_k))
\`\`\`

## 关联知识点
> Transformer 是 LLM 的基础架构，也广泛用于 NLP、CV（ViT）和语音（Whisper）。
`;

MD['rag'] = `# RAG（检索增强生成）

## 定义
RAG（Retrieval-Augmented Generation）将外部知识检索与 LLM 生成结合，解决知识截止和幻觉问题。

## 核心思想
- **检索**：从知识库找到相关文档片段
- **增强**：将检索上下文注入 Prompt
- **生成**：LLM 基于真实文档生成有据可查的回答

## 工作流程

\`\`\`
用户提问 → Embedding → 向量检索 → Top-K 文档
                                      ↓
                       Prompt = 问题 + 上下文
                                      ↓
                            LLM 生成回答
\`\`\`

## 核心组件

| 组件 | 功能 | 工具 |
|------|------|------|
| 文档加载 | 解析 PDF/HTML/MD | LangChain, LlamaIndex |
| 文本分块 | 切分为 Chunk | RecursiveCharacterSplitter |
| Embedding | 文本向量化 | OpenAI Ada, BGE, E5 |
| 向量数据库 | 存储和检索 | Milvus, Qdrant, Chroma |
| 重排序 | 精排检索结果 | Cohere Rerank, BGE Reranker |

## 高级技术
- **Hybrid Search**：向量 + 关键词混合检索
- **Multi-Query RAG**：多角度改写查询
- **Graph RAG**：基于知识图谱的检索增强
- **Agentic RAG**：Agent 驱动的多步检索

## 代码示例

\`\`\`python
from langchain_community.vectorstores import Chroma
from langchain_openai import OpenAIEmbeddings, ChatOpenAI
from langchain.chains import RetrievalQA

vectorstore = Chroma.from_documents(chunks, OpenAIEmbeddings())
qa = RetrievalQA.from_chain_type(
    llm=ChatOpenAI(model="gpt-4"),
    retriever=vectorstore.as_retriever(search_kwargs={"k": 5}),
)
result = qa.invoke({"query": "什么是 Transformer？"})
\`\`\`

## 关联知识点
> RAG 是 LLM 最重要的应用模式之一，结合 Agent 可构建强大知识助手。Prompt 设计直接影响 RAG 质量。
`;

MD['agent'] = `# AI Agent（智能体）

## 定义
AI Agent 是以 LLM 为核心推理引擎，能够感知环境、自主规划和执行行动的智能系统。

## 核心思想
- **LLM as Brain**：大模型作为推理决策中心
- **工具使用**：调用外部 API 和工具
- **规划与反思**：分解任务、执行、评估、迭代

## 架构模式

\`\`\`
用户输入 → LLM 推理 → 选择工具 → 执行动作
              ↑                        ↓
              ← ← ← 观察结果 ← ← ← ←
\`\`\`

### ReAct 模式
\`\`\`
Thought: 我需要搜索最新的 AI 新闻
Action: search("latest AI news")
Observation: 搜索结果...
Thought: 整理回答
Action: respond("根据最新信息...")
\`\`\`

## 核心组件

| 组件 | 功能 | 示例 |
|------|------|------|
| 规划 | 任务分解 | CoT, ToT, Plan-and-Execute |
| 记忆 | 短期+长期记忆 | Buffer, VectorStore |
| 工具 | 外部能力 | 搜索、代码执行、API |
| 反思 | 自我评估 | Reflexion, Self-Refine |

## Agent 框架
- **LangChain Agents** / **LangGraph**
- **AutoGPT** / **CrewAI**
- **MetaGPT**（软件开发 Agent）
- **OpenAI Assistants API**

## 代码示例

\`\`\`python
from langchain.agents import create_react_agent, AgentExecutor
from langchain_openai import ChatOpenAI
from langchain.tools import Tool

tools = [
    Tool(name="Search", func=search_fn, description="搜索互联网"),
    Tool(name="Calculator", func=calc_fn, description="数学计算"),
]
llm = ChatOpenAI(model="gpt-4", temperature=0)
agent = create_react_agent(llm, tools, prompt_template)
executor = AgentExecutor(agent=agent, tools=tools, verbose=True)
result = executor.invoke({"input": "分析最近的 AI 论文趋势"})
\`\`\`

## 关联知识点
> Agent 的核心是 LLM 推理能力，常与 RAG 结合实现知识增强。Prompt 是设计 Agent 行为的关键。
`;

MD['sft'] = `# SFT（监督微调）

## 定义
SFT（Supervised Fine-Tuning）在预训练模型基础上，使用高质量指令-回复数据进行监督学习，让模型学会"回答问题"。

## 核心思想
- 预训练模型只会"续写"，SFT 让模型学会"回答"
- 通过高质量对话数据对齐模型行为与人类期望
- 是 RLHF/DPO 之前的必要步骤

## 训练流程

\`\`\`
预训练模型 (base) → SFT 数据集 → 微调训练 → Chat 模型
\`\`\`

## 关键技术

| 技术 | 描述 | 特点 |
|------|------|------|
| Full Fine-tuning | 更新所有参数 | 效果好，成本高 |
| LoRA | 低秩适配 | 只训练少量参数 |
| QLoRA | 4-bit 量化+LoRA | 极低显存 |
| Adapter | 层间插入小模块 | 模块化 |
| Prefix Tuning | 可学习前缀 | 轻量级 |

## 高质量数据集
- **Alpaca**：52K 条指令数据
- **ShareGPT**：真实 ChatGPT 对话
- **LIMA**：1000 条精选高质量数据

## 代码示例

\`\`\`python
from peft import get_peft_model, LoraConfig
from trl import SFTTrainer

lora_config = LoraConfig(r=16, lora_alpha=32, target_modules=["q_proj","v_proj"])
model = get_peft_model(base_model, lora_config)

trainer = SFTTrainer(
    model=model, train_dataset=dataset,
    args=TrainingArguments(output_dir="./sft", num_train_epochs=3, lr=2e-5)
)
trainer.train()
\`\`\`

## 关联知识点
> SFT 是 LLM 训练的第二阶段，之后接 PPO/RLHF 进行偏好对齐。LoRA 是最流行的参数高效微调方法。
`;

MD['ppo'] = `# PPO 与 RLHF

## 定义
PPO（Proximal Policy Optimization）配合 RLHF（Reinforcement Learning from Human Feedback）实现模型与人类偏好对齐。

## 核心思想
- 人类难以写出完美回答，但容易判断哪个更好
- 训练 Reward Model 模拟人类偏好
- 用 RL 优化 LLM 使其生成高奖励回答

## RLHF 完整流程

\`\`\`
1. SFT：预训练模型 → 指令微调 → SFT 模型
2. RM：多个回答 → 人工排序 → 训练 Reward Model
3. PPO：SFT 模型 → PPO 训练（最大化奖励） → 对齐模型
\`\`\`

## 关键概念

| 概念 | 描述 |
|------|------|
| Policy | 当前 LLM（策略模型） |
| Reference | 冻结的 SFT 模型 |
| Reward Model | 奖励打分模型 |
| KL Penalty | 防止偏离参考太远 |
| Clip Ratio | PPO 裁剪范围（~0.2） |

## 替代方案：DPO
DPO（Direct Preference Optimization）跳过 RM 训练，直接用偏好数据优化，更简单稳定。Llama 3 和 Claude 均使用 DPO 变体。

## 代码示例

\`\`\`python
from trl import PPOTrainer, PPOConfig, AutoModelForCausalLMWithValueHead

model = AutoModelForCausalLMWithValueHead.from_pretrained("sft-model")
ref_model = AutoModelForCausalLMWithValueHead.from_pretrained("sft-model")

ppo_trainer = PPOTrainer(
    config=PPOConfig(learning_rate=1e-5, batch_size=16),
    model=model, ref_model=ref_model, tokenizer=tokenizer,
)

for batch in dataloader:
    responses = model.generate(batch["input_ids"])
    rewards = reward_model(batch["input_ids"], responses)
    ppo_trainer.step(batch["input_ids"], responses, rewards)
\`\`\`

## 关联知识点
> PPO/RLHF 是 LLM 对齐的核心技术，接在 SFT 之后。ChatGPT 的成功很大程度归功于 RLHF。
`;

MD['moe'] = `# MoE（混合专家模型）

## 定义
MoE（Mixture of Experts）通过门控网络动态选择部分专家网络处理输入，增加总参数同时保持计算成本可控。

## 核心思想
- **稀疏激活**：每次只激活部分专家（如 8 选 2）
- **条件计算**：不同输入由不同专家处理
- **效率**：总参数量大，实际计算量等同小模型

## 架构

\`\`\`
Token → Gate Network → Top-K 专家选择
                         ↓
         Expert 1 × w1 + Expert 2 × w2 → 输出
\`\`\`

## 代表模型

| 模型 | 总参数 | 激活参数 | 专家数 |
|------|--------|----------|--------|
| GPT-4(推测) | ~1.8T | ~280B | 16×110B |
| Mixtral 8x7B | 47B | 13B | 8×7B |
| DeepSeek-V2 | 236B | 21B | 160 |

## 优势与挑战
- **优势**：更大容量 + 更低推理成本 + 可扩展
- **挑战**：训练不稳定（专家坍塌）、显存高、负载均衡难

## 代码示例

\`\`\`python
class MoELayer(nn.Module):
    def __init__(self, d_model, num_experts, top_k=2):
        super().__init__()
        self.gate = nn.Linear(d_model, num_experts)
        self.experts = nn.ModuleList([
            nn.Sequential(nn.Linear(d_model, d_model*4), nn.GELU(), nn.Linear(d_model*4, d_model))
            for _ in range(num_experts)
        ])
        self.top_k = top_k

    def forward(self, x):
        weights, indices = torch.topk(torch.softmax(self.gate(x), -1), self.top_k)
        weights = weights / weights.sum(-1, keepdim=True)
        # 加权组合 top-k 专家输出
        ...
\`\`\`

## 关联知识点
> MoE 是 LLM 扩展的关键技术，GPT-4 和 Mixtral 均采用。与量化结合可进一步降低部署成本。
`;

MD['quantization'] = `# 模型量化（Quantization）

## 定义
量化将模型权重从高精度（FP32/FP16）转换为低精度（INT8/INT4），减少显存占用并加速推理。

## 核心思想
- 用更少比特数表示权重，牺牲少量精度换取效率
- 关键：精度损失最小化 + 压缩最大化

## 精度对比

| 精度 | 比特 | 7B 模型显存 | 质量 |
|------|------|-------------|------|
| FP32 | 32 | ~28 GB | 基准 |
| FP16 | 16 | ~14 GB | ≈基准 |
| INT8 | 8 | ~7 GB | 轻微下降 |
| INT4 | 4 | ~3.5 GB | 可接受 |

## 主流方法
- **GPTQ**：基于二阶信息 PTQ，适合 GPU
- **AWQ**：保护显著权重通道，质量好
- **GGUF**：llama.cpp 格式，适合 CPU
- **bitsandbytes**：HuggingFace NF4 量化

## 代码示例

\`\`\`python
from transformers import AutoModelForCausalLM, BitsAndBytesConfig

config = BitsAndBytesConfig(
    load_in_4bit=True, bnb_4bit_quant_type="nf4",
    bnb_4bit_compute_dtype=torch.float16, bnb_4bit_use_double_quant=True,
)
model = AutoModelForCausalLM.from_pretrained(
    "meta-llama/Llama-3.1-70B-Instruct",
    quantization_config=config, device_map="auto",
)
# 70B: ~140GB → ~35GB
\`\`\`

## 关联知识点
> 量化是 AI 工程部署的核心技术，让 LLM 在消费级硬件运行。QLoRA 将量化与 SFT 结合。MoE 模型特别需要量化。
`;

MD['prompt'] = `# Prompt Engineering（提示工程）

## 定义
Prompt Engineering 是设计和优化输入提示以引导 LLM 产生期望输出的系统化方法。

## 核心思想
- LLM 输出质量高度依赖 Prompt 设计
- 好的 Prompt = 清晰指令 + 充分上下文 + 格式约束
- Prompt 是与 LLM 交互的"编程语言"

## 核心技术

| 技巧 | 描述 | 效果 |
|------|------|------|
| Zero-Shot | 直接提问 | 基础能力 |
| Few-Shot | 提供示例 | 引导格式 |
| CoT | 逐步推理 | 提升推理 |
| Self-Consistency | 多次采样投票 | 提高准确率 |
| Tree of Thoughts | 树状搜索 | 复杂问题 |
| ReAct | 推理+行动交替 | Agent 场景 |

### Chain-of-Thought 示例
\`\`\`
让我们一步步思考：
1. 首先分析问题...
2. 然后计算...
3. 最终得出...
\`\`\`

## Prompt 模板

\`\`\`markdown
# System
你是一位 {domain} 专家，请按规则回答：
1. 先给结论 2. 再解释推理 3. 给出代码示例

# User
## 背景：{context}
## 问题：{question}
## 要求：中文、Markdown、专业级
\`\`\`

## 代码示例

\`\`\`python
from openai import OpenAI
client = OpenAI()

def ask(question, examples=None):
    messages = [{"role":"system","content":"你是 AI 专家，回答准确结构化。"}]
    if examples:
        for e in examples:
            messages += [{"role":"user","content":e["q"]},{"role":"assistant","content":e["a"]}]
    messages.append({"role":"user","content":question})
    return client.chat.completions.create(model="gpt-4", messages=messages, temperature=0.3)
\`\`\`

## 关联知识点
> Prompt 是使用 LLM 的核心技能，构建 RAG 和 Agent 的基础。CoT 能力与模型规模相关。
`;

// ===================== 节点定义 =====================
const graphNodes = [
  // 顶层 8 大领域 (level 1)
  { data: { id: 'ai-base',  label: 'AI 基础',       level: 1 } },
  { data: { id: 'ml-base',  label: '机器学习',      level: 1 } },
  { data: { id: 'dl-core',  label: '深度学习',      level: 1 } },
  { data: { id: 'nlp',      label: '自然语言处理',  level: 1 } },
  { data: { id: 'cv',       label: '计算机视觉',    level: 1 } },
  { data: { id: 'speech',   label: '语音音频',      level: 1 } },
  { data: { id: 'llm',      label: '大模型 LLM',    level: 1 } },
  { data: { id: 'ai-eng',   label: 'AI 工程部署',   level: 1 } },

  // LLM 子节点 (level 2) — 必须包含全部 8 个
  { data: { id: 'transformer',  label: 'Transformer',  level: 2, parentDomain: 'llm' } },
  { data: { id: 'rag',          label: 'RAG',          level: 2, parentDomain: 'llm' } },
  { data: { id: 'agent',        label: 'Agent',        level: 2, parentDomain: 'llm' } },
  { data: { id: 'sft',          label: 'SFT 微调',    level: 2, parentDomain: 'llm' } },
  { data: { id: 'ppo',          label: 'PPO / RLHF',  level: 2, parentDomain: 'llm' } },
  { data: { id: 'moe',          label: 'MoE',          level: 2, parentDomain: 'llm' } },
  { data: { id: 'quantization', label: '量化',         level: 2, parentDomain: 'llm' } },
  { data: { id: 'prompt',       label: 'Prompt',       level: 2, parentDomain: 'llm' } },
];

// ===================== 边定义 =====================
const graphEdges = [
  // 顶层关系
  { data: { source: 'ai-base', target: 'ml-base',  relation: '包含', id: 'e1'  } },
  { data: { source: 'ml-base', target: 'dl-core',  relation: '包含', id: 'e2'  } },
  { data: { source: 'dl-core', target: 'nlp',      relation: '依赖', id: 'e3'  } },
  { data: { source: 'dl-core', target: 'cv',       relation: '依赖', id: 'e4'  } },
  { data: { source: 'dl-core', target: 'speech',   relation: '依赖', id: 'e5'  } },
  { data: { source: 'dl-core', target: 'llm',      relation: '演进', id: 'e6'  } },
  { data: { source: 'llm',     target: 'ai-eng',   relation: '依赖', id: 'e7'  } },
  { data: { source: 'nlp',     target: 'llm',      relation: '演进', id: 'e8'  } },
  { data: { source: 'cv',      target: 'llm',      relation: '相关', id: 'e9'  } },
  { data: { source: 'speech',  target: 'llm',      relation: '相关', id: 'e10' } },
  { data: { source: 'ai-base', target: 'ai-eng',   relation: '相关', id: 'e11' } },

  // LLM → 子节点（包含关系）
  { data: { source: 'llm', target: 'transformer',  relation: '包含', id: 'e20' } },
  { data: { source: 'llm', target: 'rag',          relation: '包含', id: 'e21' } },
  { data: { source: 'llm', target: 'agent',        relation: '包含', id: 'e22' } },
  { data: { source: 'llm', target: 'sft',          relation: '包含', id: 'e23' } },
  { data: { source: 'llm', target: 'ppo',          relation: '包含', id: 'e24' } },
  { data: { source: 'llm', target: 'moe',          relation: '包含', id: 'e25' } },
  { data: { source: 'llm', target: 'quantization', relation: '包含', id: 'e26' } },
  { data: { source: 'llm', target: 'prompt',       relation: '包含', id: 'e27' } },

  // 子节点间关系
  { data: { source: 'transformer', target: 'sft',          relation: '依赖', id: 'e30' } },
  { data: { source: 'sft',         target: 'ppo',          relation: '演进', id: 'e31' } },
  { data: { source: 'rag',         target: 'agent',        relation: '相关', id: 'e32' } },
  { data: { source: 'prompt',      target: 'rag',          relation: '相关', id: 'e33' } },
  { data: { source: 'prompt',      target: 'agent',        relation: '相关', id: 'e34' } },
  { data: { source: 'moe',         target: 'quantization', relation: '相关', id: 'e35' } },
  { data: { source: 'transformer', target: 'moe',          relation: '依赖', id: 'e36' } },
  { data: { source: 'quantization',target: 'ai-eng',       relation: '相关', id: 'e37' } },
];
