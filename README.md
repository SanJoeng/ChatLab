ChatLab (Embedding & Streaming Fork)

Original project by @hellodigua
原始仓库：[https://github.com/hellodigua/ChatLab](https://github.com/hellodigua/ChatLab)￼

本仓库是 ChatLab 的一个 技术实验 fork，用于探索：
	•	向量检索（Embedding-based Semantic Search）
	•	OpenAI-compatible 流式输出在部分模型下的兼容性问题修复

⚠️ 说明：该 fork 不作为主线功能直接合并目标，而是作为实现思路与代码参考。

⸻

✨ 本 Fork 做了什么

1️⃣ 引入 Embedding + 语义检索 Pipeline

在原有 ChatLab 基础上，补充了一套完整的 语义检索流程：

User Question
   ↓
Query Rewrite（由对话模型生成检索 JSON）
   ↓
Embedding 向量化（支持 Ollama / OpenAI-compatible）
   ↓
Semantic Search（Top-K 消息召回）
   ↓
Evidence 注入到上下文（System Message）
   ↓
最终回答

核心特性
	•	支持在配置中指定 embeddingModel
	•	Embedding 与对话模型 解耦
	•	检索结果以 证据块（evidence block） 形式注入上下文
	•	若证据不足，模型需明确说明“不足”

⸻

2️⃣ 修复 OpenAI-compatible 流式输出的 delta 问题

在部分模型 / 后端（如某些 OpenAI-compatible 实现）中：
	•	增量文本可能出现在：
	•	delta.content
	•	或 delta.reasoning
	•	原实现只消费了 delta.content，会导致：
	•	前端无输出
	•	模型“自言自语”或丢字

本 Fork 的处理方式
	•	在流式处理中：
	•	合并 delta.content + delta.reasoning
	•	统一向上层 emit
	•	不改变工具调用（tool_calls）逻辑
	•	不侵入模型侧行为，仅做兼容处理

⸻

🔌 Embedding 模型建议（当前测试）

本 fork 在本地测试中使用了：
	•	qwen3-embedding:0.6b/4b
  •	bge-base-zh-v1.5-f16
特性：
	•	中文语义表现稳定
	•	适合本地私有聊天记录检索
  • 不同embedding模型无显著差距	
  
⚠️ 模型仅作为测试示例，不绑定本项目

⸻

🛠️ 开发 & 运行

pnpm install
pnpm dev

⚠️ 本仓库不包含 node_modules、out、dist 等构建产物
请自行安装依赖

⸻

📄 License

本仓库遵循原项目 License（MIT）。

⸻

🙏 致谢
	•	原项目作者：@hellodigua￼
	•	ChatLab 项目提供的良好基础架构

⸻

📌 说明（给维护者）

如果你是原作者或维护者：
	•	该 fork 不假设合并
	•	仅作为：
	•	Embedding Pipeline 实现参考
	•	Streaming 兼容问题的实际修复样例
	•	欢迎按需参考、摘取或重构
