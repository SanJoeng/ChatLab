/**
 * AI Agent 执行器
 * 处理 Function Calling 循环，支持多轮工具调用
 */

import type { ChatMessage, ChatOptions, ToolCall } from './llm/types'
import { chatStream, chat, getActiveConfig } from './llm'
import { getAllToolDefinitions, executeToolCalls } from './tools'
import type { ToolContext, OwnerInfo } from './tools/types'
import { aiLogger } from './logger'
import { randomUUID } from 'crypto'

// ==================== Fallback 解析器 ====================

/**
 * 从文本内容中提取 <think> 标签内容
 */
function extractThinkingContent(content: string): { thinking: string; cleanContent: string } {
  const thinkRegex = /<think>([\s\S]*?)<\/think>/gi
  let thinking = ''
  let cleanContent = content

  const matches = content.matchAll(thinkRegex)
  for (const match of matches) {
    thinking += match[1].trim() + '\n'
    cleanContent = cleanContent.replace(match[0], '')
  }

  return { thinking: thinking.trim(), cleanContent: cleanContent.trim() }
}

/**
 * 从文本内容中解析 <tool_call> 标签并转换为标准 ToolCall 格式
 */
function parseToolCallTags(content: string): ToolCall[] | null {
  const toolCallRegex = /<tool_call>\s*([\s\S]*?)\s*<\/tool_call>/gi
  const toolCalls: ToolCall[] = []

  const matches = content.matchAll(toolCallRegex)
  for (const match of matches) {
    try {
      const jsonStr = match[1].trim()
      const parsed = JSON.parse(jsonStr)

      if (parsed.name && parsed.arguments) {
        toolCalls.push({
          id: `fallback-${randomUUID()}`,
          type: 'function',
          function: {
            name: parsed.name,
            arguments: typeof parsed.arguments === 'string' ? parsed.arguments : JSON.stringify(parsed.arguments),
          },
        })
      }
    } catch (e) {
      aiLogger.warn('Agent', 'Failed to parse tool_call tag', { content: match[1], error: String(e) })
    }
  }

  return toolCalls.length > 0 ? toolCalls : null
}

/**
 * 检测内容是否包含工具调用标签（用于判断是否需要 fallback 解析）
 */
function hasToolCallTags(content: string): boolean {
  return /<tool_call>/i.test(content)
}

/**
 * Agent 配置
 */
export interface AgentConfig {
  /** 最大工具调用轮数（防止无限循环） */
  maxToolRounds?: number
  /** LLM 选项 */
  llmOptions?: ChatOptions
  /** 中止信号，用于取消执行 */
  abortSignal?: AbortSignal
}

/**
 * Token 使用量
 */
export interface TokenUsage {
  promptTokens: number
  completionTokens: number
  totalTokens: number
}

/**
 * Agent 流式响应 chunk
 */
export interface AgentStreamChunk {
  /** chunk 类型 */
  type: 'content' | 'tool_start' | 'tool_result' | 'done' | 'error'
  /** 文本内容（type=content 时） */
  content?: string
  /** 工具名称（type=tool_start/tool_result 时） */
  toolName?: string
  /** 工具调用参数（type=tool_start 时） */
  toolParams?: Record<string, unknown>
  /** 工具执行结果（type=tool_result 时） */
  toolResult?: unknown
  /** 错误信息（type=error 时） */
  error?: string
  /** 是否完成 */
  isFinished?: boolean
  /** Token 使用量（type=done 时返回累计值） */
  usage?: TokenUsage
}

/**
 * Agent 执行结果
 */
export interface AgentResult {
  /** 最终文本响应 */
  content: string
  /** 使用的工具列表 */
  toolsUsed: string[]
  /** 工具调用轮数 */
  toolRounds: number
  /** 总 Token 使用量（累计所有 LLM 调用） */
  totalUsage?: TokenUsage
}

// ==================== 提示词配置类型 ====================

/**
 * 用户自定义提示词配置
 */
export interface PromptConfig {
  /** 角色定义（可编辑区） */
  roleDefinition: string
  /** 回答要求（可编辑区） */
  responseRules: string
}

// 国际化内容
const i18nContent = {
  'zh-CN': {
    currentDateIs: '当前日期是',
    chatTypeDesc: { private: '私聊记录', group: '群聊记录' },
    chatContext: { private: '对话', group: '群聊' },
    ownerNote: (displayName: string, platformId: string, chatContext: string) => `当前用户身份：
- 用户在${chatContext}中的身份是「${displayName}」（platformId: ${platformId}）
- 当用户提到"我"、"我的"时，指的就是「${displayName}」
- 查询"我"的发言时，使用 sender_id 参数筛选该成员
`,
    memberNotePrivate: `成员查询策略：
- 私聊只有两个人，可以直接获取成员列表
- 当用户提到"对方"、"他/她"时，通过 get_group_members 获取另一方信息
`,
    memberNoteGroup: `成员查询策略：
- 当用户提到特定群成员（如"张三说过什么"、"小明的发言"等）时，应先调用 get_group_members 获取成员列表
- 群成员有三种名称：accountName（原始昵称）、groupNickname（群昵称）、aliases（用户自定义别名）
- 通过 get_group_members 的 search 参数可以模糊搜索这三种名称
- 找到成员后，使用其 id 字段作为 search_messages 的 sender_id 参数来获取该成员的发言
`,
    timeParamsIntro: '时间参数：按用户提到的精度组合 year/month/day/hour',
    timeParamExample1: (year: number) => `"10月" → year: ${year}, month: 10`,
    timeParamExample2: (year: number) => `"10月1号" → year: ${year}, month: 10, day: 1`,
    timeParamExample3: (year: number) => `"10月1号下午3点" → year: ${year}, month: 10, day: 1, hour: 15`,
    defaultYearNote: (year: number, prevYear: number) => `未指定年份默认${year}年，若该月份未到则用${prevYear}年`,
    responseInstruction: '根据用户的问题，选择合适的工具获取数据，然后基于数据给出回答。',
    responseRulesTitle: '回答要求：',
    fallbackRoleDefinition: (chatType: string) => `你是一个专业的${chatType}记录分析助手。
你的任务是帮助用户理解和分析他们的${chatType}记录数据。`,
    fallbackResponseRules: `1. 基于工具返回的数据回答，不要编造信息
2. 如果数据不足以回答问题，请说明
3. 回答要简洁明了，使用 Markdown 格式`,
  },
  'en-US': {
    currentDateIs: 'Current date is',
    chatTypeDesc: { private: 'private chat records', group: 'group chat records' },
    chatContext: { private: 'conversation', group: 'group chat' },
    ownerNote: (displayName: string, platformId: string, chatContext: string) => `Current user identity:
- The user's identity in this ${chatContext} is "${displayName}" (platformId: ${platformId})
- When the user refers to "I" or "my", it refers to "${displayName}"
- When querying "my" messages, use the sender_id parameter to filter for this member
`,
    memberNotePrivate: `Member query strategy:
- Private chats only have two participants, so the member list can be directly obtained
- When the user refers to "the other party" or "he/she", get the other participant's information via get_group_members
`,
    memberNoteGroup: `Member query strategy:
- When the user refers to specific group members (e.g., "what did John say", "Mary's messages"), first call get_group_members to get the member list
- Group members have three names: accountName (original nickname), groupNickname (group nickname), aliases (user-defined aliases)
- The search parameter of get_group_members can be used for fuzzy searching these three names
- Once a member is found, use their id field as the sender_id parameter for search_messages to retrieve their messages
`,
    timeParamsIntro: 'Time parameters: combine year/month/day/hour based on user mention',
    timeParamExample1: (year: number) => `"October" → year: ${year}, month: 10`,
    timeParamExample2: (year: number) => `"October 1st" → year: ${year}, month: 10, day: 1`,
    timeParamExample3: (year: number) => `"October 1st 3 PM" → year: ${year}, month: 10, day: 1, hour: 15`,
    defaultYearNote: (year: number, prevYear: number) =>
      `If year is not specified, defaults to ${year}. If the month has not yet occurred, ${prevYear} is used.`,
    responseInstruction:
      "Based on the user's question, select appropriate tools to retrieve data, then provide an answer based on the data.",
    responseRulesTitle: 'Response requirements:',
    fallbackRoleDefinition: (chatType: string) => `You are a professional ${chatType} analysis assistant.
Your task is to help users understand and analyze their ${chatType} data.`,
    fallbackResponseRules: `1. Answer based on data returned by tools, do not fabricate information
2. If data is insufficient to answer, please state so
3. Keep answers concise and clear, use Markdown format`,
  },
}

/**
 * 获取系统锁定部分的提示词（策略说明、时间处理等）
 *
 * 注意：工具定义通过 Function Calling 的 tools 参数传递给 LLM，
 * 无需在 System Prompt 中重复描述，以节省 Token。
 *
 * @param chatType 聊天类型 ('group' | 'private')
 * @param ownerInfo Owner 信息（当前用户在对话中的身份）
 * @param locale 语言设置
 */
function getLockedPromptSection(
  chatType: 'group' | 'private',
  ownerInfo?: OwnerInfo,
  locale: string = 'zh-CN'
): string {
  const content = i18nContent[locale as keyof typeof i18nContent] || i18nContent['zh-CN']
  const now = new Date()
  const dateLocale = locale === 'zh-CN' ? 'zh-CN' : 'en-US'
  const currentDate = now.toLocaleDateString(dateLocale, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    weekday: 'long',
  })

  const isPrivate = chatType === 'private'
  const chatContext = content.chatContext[chatType]

  // Owner 说明（当用户设置了"我是谁"时）
  const ownerNote = ownerInfo ? content.ownerNote(ownerInfo.displayName, ownerInfo.platformId, chatContext) : ''

  // 成员说明（私聊只有2人）
  const memberNote = isPrivate ? content.memberNotePrivate : content.memberNoteGroup

  const year = now.getFullYear()
  const prevYear = year - 1

  return `${content.currentDateIs} ${currentDate}。
${ownerNote}
${memberNote}
${content.timeParamsIntro}
- ${content.timeParamExample1(year)}
- ${content.timeParamExample2(year)}
- ${content.timeParamExample3(year)}
${content.defaultYearNote(year, prevYear)}

${content.responseInstruction}`
}

/**
 * 获取 Fallback 角色定义（主要配置来自前端 src/config/prompts.ts）
 * 仅在前端未传递 promptConfig 时使用
 */
function getFallbackRoleDefinition(chatType: 'group' | 'private', locale: string = 'zh-CN'): string {
  const content = i18nContent[locale as keyof typeof i18nContent] || i18nContent['zh-CN']
  const chatTypeDesc =
    chatType === 'private'
      ? locale === 'zh-CN'
        ? '私聊'
        : 'private chat'
      : locale === 'zh-CN'
        ? '群聊'
        : 'group chat'
  return content.fallbackRoleDefinition(chatTypeDesc)
}

/**
 * 获取 Fallback 回答要求（主要配置来自前端 src/config/prompts.ts）
 * 仅在前端未传递 promptConfig 时使用
 */
function getFallbackResponseRules(locale: string = 'zh-CN'): string {
  const content = i18nContent[locale as keyof typeof i18nContent] || i18nContent['zh-CN']
  return content.fallbackResponseRules
}

/**
 * 构建完整的系统提示词
 */
function buildSystemPrompt(
  chatType: 'group' | 'private' = 'group',
  promptConfig?: PromptConfig,
  ownerInfo?: OwnerInfo,
  locale: string = 'zh-CN'
): string {
  const content = i18nContent[locale as keyof typeof i18nContent] || i18nContent['zh-CN']

  const roleDefinition = promptConfig?.roleDefinition || getFallbackRoleDefinition(chatType, locale)
  const responseRules = promptConfig?.responseRules || getFallbackResponseRules(locale)

  const lockedSection = getLockedPromptSection(chatType, ownerInfo, locale)

  return `${roleDefinition}

${lockedSection}

${content.responseRulesTitle}
${responseRules}`
}

/**
 * Agent 执行器类
 * 处理带 Function Calling 的对话流程
 */
export class Agent {
  private context: ToolContext
  private config: AgentConfig
  private messages: ChatMessage[] = []
  private toolsUsed: string[] = []
  private toolRounds: number = 0
  private abortSignal?: AbortSignal
  private historyMessages: ChatMessage[] = []
  private chatType: 'group' | 'private' = 'group'
  private promptConfig?: PromptConfig
  private locale: string = 'zh-CN'
  /** 累计 Token 使用量 */
  private totalUsage: TokenUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 }

  constructor(
    context: ToolContext,
    config: AgentConfig = {},
    historyMessages: ChatMessage[] = [],
    chatType: 'group' | 'private' = 'group',
    promptConfig?: PromptConfig,
    locale: string = 'zh-CN'
  ) {
    this.context = context
    this.abortSignal = config.abortSignal
    this.historyMessages = historyMessages
    this.chatType = chatType
    this.promptConfig = promptConfig
    this.locale = locale
    this.config = {
      maxToolRounds: config.maxToolRounds ?? 5,
      llmOptions: config.llmOptions ?? { temperature: 0.7, maxTokens: 2048 },
    }
  }

  private isAborted(): boolean {
    return this.abortSignal?.aborted ?? false
  }

  private addUsage(usage?: { promptTokens: number; completionTokens: number; totalTokens: number }): void {
    if (usage) {
      this.totalUsage.promptTokens += usage.promptTokens
      this.totalUsage.completionTokens += usage.completionTokens
      this.totalUsage.totalTokens += usage.totalTokens
    }
  }

  /** 当前是否启用 semantic pipeline（只要配置了 embeddingModel 就启用） */
  private getEmbeddingModel(): string | null {
    try {
      const cfg = getActiveConfig()
      const m = cfg?.embeddingModel?.trim()
      return m ? m : null
    } catch {
      return null
    }
  }

  /**
   * ===== Semantic Pipeline =====
   * 目标：自然语言 -> LLM改写检索query -> 强制semantic_search_messages -> 注入证据 -> 再让LLM回答
   *
   * 返回：是否执行了 pipeline
   */
  private async runSemanticPipeline(
    userMessage: string,
    tools: any[],
    onChunk?: (chunk: AgentStreamChunk) => void
  ): Promise<boolean> {
    const embeddingModel = this.getEmbeddingModel()
    const enabled = !!embeddingModel

    aiLogger.info('Agent', 'SemanticPipeline: check', { enabled, embeddingModel: embeddingModel || '' })
    if (!enabled) return false

    // 1) 让 LLM 改写 query（不传 tools，避免乱调用）
    const rewriteSystem = `你是一个“检索查询改写器”。只输出 JSON，不要输出任何额外文字。
输出格式：
{"query": string, "top_k": number, "candidate_limit": number}
要求：
- query 要尽量覆盖用户意图：关键词 + 同义词 + 可能出现的聊天原话片段（短语）
- top_k 默认 5（可根据问题复杂度 5-20）
- candidate_limit 默认 200（可根据问题复杂度 100-500）
- 如果用户问题很短/含糊，也要把 query 写具体（例如补上“进展/情况/有没有/是否/能恢复”等）
`
    const rewriteUser = `用户问题：${userMessage}\n请生成用于语义检索的 JSON：`

    let query = userMessage
    let top_k = 5
    let candidate_limit = 200

    try {
      const rewriteResp = await chat(
        [
          { role: 'system', content: rewriteSystem },
          { role: 'user', content: rewriteUser },
        ],
        {
          temperature: 0.2,
          maxTokens: 200,
          abortSignal: this.abortSignal,
        }
      )

      this.addUsage((rewriteResp as any).usage)

      const raw = (rewriteResp.content || '').trim()
      const jsonMatch = raw.match(/\{[\s\S]*\}/)
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0])
        if (typeof parsed.query === 'string' && parsed.query.trim()) query = parsed.query.trim()
        if (typeof parsed.top_k === 'number') top_k = parsed.top_k
        if (typeof parsed.candidate_limit === 'number') candidate_limit = parsed.candidate_limit
      }
    } catch (e) {
      aiLogger.warn('Agent', 'SemanticPipeline: rewrite failed, fallback to userMessage', { error: String(e) })
    }

    // clamp
    top_k = Math.max(1, Math.min(50, Number.isFinite(top_k) ? top_k : 5))
    candidate_limit = Math.max(20, Math.min(500, Number.isFinite(candidate_limit) ? candidate_limit : 200))
    if (this.context.maxMessagesLimit) {
      candidate_limit = Math.min(candidate_limit, this.context.maxMessagesLimit)
    }

    aiLogger.info('Agent', 'SemanticPipeline: plan', { query, top_k, candidate_limit })

    // 2) 强制调用 semantic_search_messages
    const toolDef = tools.find((t) => t.function?.name === 'semantic_search_messages')
    if (!toolDef) {
      aiLogger.warn('Agent', 'SemanticPipeline: tool not found: semantic_search_messages')
      return false
    }

    if (onChunk) {
      onChunk({
        type: 'tool_start',
        toolName: 'semantic_search_messages',
        toolParams: { query, top_k, candidate_limit },
      })
    }

    const forcedToolCalls: ToolCall[] = [
      {
        id: `semantic-${randomUUID()}`,
        type: 'function',
        function: {
          name: 'semantic_search_messages',
          arguments: JSON.stringify({ query, top_k, candidate_limit }),
        },
      },
    ]

    const results = await executeToolCalls(forcedToolCalls, { ...this.context, locale: this.locale })
    const first = results?.[0]

    if (onChunk) {
      onChunk({
        type: 'tool_result',
        toolName: 'semantic_search_messages',
        toolResult: first?.success ? first.result : first?.error,
      })
    }

    // 把这次“强制工具调用”写进 messages（assistant(tool_calls) + tool(result)）
    this.messages.push({
      role: 'assistant',
      content: '',
      tool_calls: forcedToolCalls,
    })
    this.messages.push({
      role: 'tool',
      content: first?.success ? JSON.stringify(first.result) : `错误: ${first?.error}`,
      tool_call_id: forcedToolCalls[0].id,
    })
    this.toolsUsed.push('semantic_search_messages')

    // 3) 注入证据块（system，放在 user 之前，强约束模型必须用证据回答）
    if (first?.success && first.result) {
      const evidenceBlock = `【语义检索证据（semantic_search_messages）】
检索query：${query}
top_k：${top_k}，candidate_limit：${candidate_limit}

检索结果（按相关度）：
${JSON.stringify(first.result, null, 2)}

回答要求：
- 必须优先依据上述证据回答
- 如果证据不足，说明“不足”并给出下一步应检索什么
`
      // user 消息永远是最后一条“用户”，我们把证据插到 user 之前
      // （注意：此时 messages 末尾是 tool 结果，所以插在最开头的 user 之前更稳妥）
      const lastUserIdx = [...this.messages].reverse().findIndex((m) => m.role === 'user')
      const insertIdx = lastUserIdx === -1 ? this.messages.length : this.messages.length - 1 - lastUserIdx
      this.messages.splice(insertIdx, 0, { role: 'system', content: evidenceBlock })

      aiLogger.info('Agent', 'SemanticPipeline: injected', { messagesCount: this.messages.length })
    }

    return true
  }

  /**
   * 是否应该自动触发语义检索（旧方案 A：无 embeddingModel 时的兜底）
   */
  private shouldAutoSemanticSearch(userMessage: string): boolean {
    const text = userMessage.trim()
    if (!text) return false

    // 如果用户已经显式点名某个工具，就不要“抢跑”
    if (/get_recent_messages|search_messages|get_conversation_between|semantic_search_messages/i.test(text)) {
      return false
    }

    const triggers = [
      '关系',
      '相处',
      '进展',
      '总结',
      '分析',
      '洞察',
      '怎么',
      '为什么',
      '发生了什么',
      '线索',
      '类似',
      '有没有聊过',
      '提到过',
    ]
    if (triggers.some((k) => text.includes(k))) return true
    if (text.length >= 15) return true
    return false
  }

  /**
   * 旧方案 A：强制执行一次 semantic_search_messages，并把结果格式化成“证据块”注入上下文（仅在未配置 embeddingModel 时使用）
   */
  private async runAutoSemanticSearch(userMessage: string): Promise<string | null> {
    try {
      const tools = await getAllToolDefinitions()
      const toolDef = tools.find((t) => t.function?.name === 'semantic_search_messages')
      if (!toolDef) return null

      const toolCalls: ToolCall[] = [
        {
          id: `auto-${randomUUID()}`,
          type: 'function',
          function: {
            name: 'semantic_search_messages',
            arguments: JSON.stringify({
              query: userMessage,
              top_k: 8,
              candidate_limit: 200,
            }),
          },
        },
      ]

      const results = await executeToolCalls(toolCalls, { ...this.context, locale: this.locale })
      const r0 = results?.[0]
      if (!r0 || !r0.success) return null

      const data = r0.result as any
      const items: Array<{ score?: number; message?: string }> = data?.results || []
      if (!Array.isArray(items) || items.length === 0) return null

      const lines = items.slice(0, 8).map((x, i) => {
        const s = typeof x.score === 'number' ? (x.score * 100).toFixed(1) + '%' : ''
        return `${i + 1}. ${s} ${x.message || ''}`.trim()
      })

      return `【语义检索结果】\n查询：${data?.query || userMessage}\n${lines.join('\n')}\n（以上为系统自动从聊天记录中检索到的高相关消息，请基于这些证据回答。）`
    } catch (e) {
      aiLogger.warn('Agent', 'auto semantic search failed', { error: String(e) })
      return null
    }
  }

  /**
   * 执行对话（非流式）
   */
  async execute(userMessage: string): Promise<AgentResult> {
    aiLogger.info('Agent', '用户问题', userMessage)

    if (this.isAborted()) {
      return { content: '', toolsUsed: [], toolRounds: 0, totalUsage: this.totalUsage }
    }

    const systemPrompt = buildSystemPrompt(this.chatType, this.promptConfig, this.context.ownerInfo, this.locale)
    this.messages = [
      { role: 'system', content: systemPrompt },
      ...this.historyMessages,
      { role: 'user', content: userMessage },
    ]
    this.toolsUsed = []
    this.toolRounds = 0

    const tools = await getAllToolDefinitions()

    // 优先：Semantic Pipeline（只要填了 embeddingModel 就一定走）
    const ranPipeline = await this.runSemanticPipeline(userMessage, tools)

    // 如果没启用 pipeline（没填 embeddingModel），才走旧方案 A
    if (!ranPipeline && this.shouldAutoSemanticSearch(userMessage)) {
      const evidence = await this.runAutoSemanticSearch(userMessage)
      if (evidence) {
        this.messages.splice(this.messages.length - 1, 0, { role: 'system', content: evidence })
      }
    }

    while (this.toolRounds < (this.config.maxToolRounds ?? 5)) {
      if (this.isAborted()) {
        return {
          content: '',
          toolsUsed: this.toolsUsed,
          toolRounds: this.toolRounds,
          totalUsage: this.totalUsage,
        }
      }

      const response = await chat(this.messages, {
        ...this.config.llmOptions,
        tools,
        abortSignal: this.abortSignal,
      })

      this.addUsage((response as any).usage)

      let toolCallsToProcess = response.tool_calls

      if (response.finishReason !== 'tool_calls' || !response.tool_calls) {
        if (hasToolCallTags(response.content)) {
          const { cleanContent } = extractThinkingContent(response.content)
          const fallbackToolCalls = parseToolCallTags(response.content)
          if (fallbackToolCalls && fallbackToolCalls.length > 0) {
            toolCallsToProcess = fallbackToolCalls
          } else {
            aiLogger.info('Agent', 'AI 回复', cleanContent)
            return {
              content: cleanContent,
              toolsUsed: this.toolsUsed,
              toolRounds: this.toolRounds,
              totalUsage: this.totalUsage,
            }
          }
        } else {
          aiLogger.info('Agent', 'AI 回复', response.content)
          return {
            content: response.content,
            toolsUsed: this.toolsUsed,
            toolRounds: this.toolRounds,
            totalUsage: this.totalUsage,
          }
        }
      }

      await this.handleToolCalls(toolCallsToProcess!)
      this.toolRounds++
    }

    aiLogger.warn('Agent', '达到最大工具调用轮数', { maxRounds: this.config.maxToolRounds })
    this.messages.push({ role: 'user', content: '请根据已获取的信息给出回答，不要再调用工具。' })

    const finalResponse = await chat(this.messages, this.config.llmOptions)
    this.addUsage((finalResponse as any).usage)

    return {
      content: finalResponse.content,
      toolsUsed: this.toolsUsed,
      toolRounds: this.toolRounds,
      totalUsage: this.totalUsage,
    }
  }

  /**
   * 执行对话（流式）
   */
  async executeStream(userMessage: string, onChunk: (chunk: AgentStreamChunk) => void): Promise<AgentResult> {
    aiLogger.info('Agent', '用户问题', userMessage)

    if (this.isAborted()) {
      onChunk({ type: 'done', isFinished: true, usage: this.totalUsage })
      return { content: '', toolsUsed: [], toolRounds: 0, totalUsage: this.totalUsage }
    }

    const systemPrompt = buildSystemPrompt(this.chatType, this.promptConfig, this.context.ownerInfo, this.locale)
    this.messages = [
      { role: 'system', content: systemPrompt },
      ...this.historyMessages,
      { role: 'user', content: userMessage },
    ]
    this.toolsUsed = []
    this.toolRounds = 0

    const tools = await getAllToolDefinitions()
    let finalContent = ''

    // 优先：Semantic Pipeline（只要填了 embeddingModel 就一定走）
    const ranPipeline = await this.runSemanticPipeline(userMessage, tools, onChunk)

    // 如果没启用 pipeline（没填 embeddingModel），才走旧方案 A
    if (!ranPipeline && this.shouldAutoSemanticSearch(userMessage)) {
      const evidence = await this.runAutoSemanticSearch(userMessage)
      if (evidence) {
        this.messages.splice(this.messages.length - 1, 0, { role: 'system', content: evidence })
      }
    }

    // 执行循环
    while (this.toolRounds < (this.config.maxToolRounds ?? 5)) {
      if (this.isAborted()) {
        onChunk({ type: 'done', isFinished: true, usage: this.totalUsage })
        return {
          content: finalContent,
          toolsUsed: this.toolsUsed,
          toolRounds: this.toolRounds,
          totalUsage: this.totalUsage,
        }
      }

      let accumulatedContent = ''
      let displayedContent = ''
      let toolCalls: ToolCall[] | undefined
      let isBufferingToolCall = false
      let isBufferingThink = false

      for await (const chunk of chatStream(this.messages, {
        ...this.config.llmOptions,
        tools,
        abortSignal: this.abortSignal,
      })) {
        if (this.isAborted()) {
          onChunk({ type: 'done', isFinished: true, usage: this.totalUsage })
          return {
            content: finalContent + accumulatedContent,
            toolsUsed: this.toolsUsed,
            toolRounds: this.toolRounds,
            totalUsage: this.totalUsage,
          }
        }

        if (chunk.content) {
          accumulatedContent += chunk.content

          if (!isBufferingThink && /<think>/i.test(accumulatedContent)) {
            isBufferingThink = true
            const thinkStart = accumulatedContent.toLowerCase().indexOf('<think>')
            if (thinkStart > displayedContent.length) {
              const newContent = accumulatedContent.slice(displayedContent.length, thinkStart)
              if (newContent) {
                onChunk({ type: 'content', content: newContent })
                displayedContent = accumulatedContent.slice(0, thinkStart)
              }
            }
          }

          if (isBufferingThink && /<\/think>/i.test(accumulatedContent)) {
            isBufferingThink = false
            const thinkEnd = accumulatedContent.toLowerCase().indexOf('</think>') + '</think>'.length
            displayedContent = accumulatedContent.slice(0, thinkEnd)
          }

          if (isBufferingThink) continue

          if (!isBufferingToolCall) {
            if (/<tool_call>/i.test(accumulatedContent)) {
              isBufferingToolCall = true
              const tagStart = accumulatedContent.indexOf('<tool_call>')
              if (tagStart > displayedContent.length) {
                const newContent = accumulatedContent.slice(displayedContent.length, tagStart)
                if (newContent) {
                  onChunk({ type: 'content', content: newContent })
                  displayedContent = accumulatedContent.slice(0, tagStart)
                }
              }
            } else {
              const newContent = accumulatedContent.slice(displayedContent.length)
              if (newContent) {
                onChunk({ type: 'content', content: newContent })
                displayedContent = accumulatedContent
              }
            }
          }
        }

        if (chunk.tool_calls) {
          toolCalls = chunk.tool_calls
        }

        if (chunk.usage) {
          this.addUsage(chunk.usage)
        }

        if (chunk.isFinished) {
          if (chunk.finishReason !== 'tool_calls' || !toolCalls) {
            if (hasToolCallTags(accumulatedContent)) {
              const { cleanContent } = extractThinkingContent(accumulatedContent)
              const fallbackToolCalls = parseToolCallTags(accumulatedContent)
              if (fallbackToolCalls && fallbackToolCalls.length > 0) {
                toolCalls = fallbackToolCalls
                accumulatedContent = cleanContent.replace(/<tool_call>[\s\S]*?<\/tool_call>/gi, '').trim()
              } else {
                const remainingContent = cleanContent.slice(displayedContent.length)
                if (remainingContent) onChunk({ type: 'content', content: remainingContent })
                finalContent = cleanContent
                aiLogger.info('Agent', 'AI 回复', finalContent)
                onChunk({ type: 'done', isFinished: true, usage: this.totalUsage })
                return {
                  content: finalContent,
                  toolsUsed: this.toolsUsed,
                  toolRounds: this.toolRounds,
                  totalUsage: this.totalUsage,
                }
              }
            } else {
              finalContent = extractThinkingContent(accumulatedContent).cleanContent
              aiLogger.info('Agent', 'AI 回复', finalContent)
              onChunk({ type: 'done', isFinished: true, usage: this.totalUsage })
              return {
                content: finalContent,
                toolsUsed: this.toolsUsed,
                toolRounds: this.toolRounds,
                totalUsage: this.totalUsage,
              }
            }
          }
        }
      }

      if (toolCalls && toolCalls.length > 0) {
        for (const tc of toolCalls) {
          let toolParams: Record<string, unknown> | undefined
          try {
            toolParams = JSON.parse(tc.function.arguments || '{}')

            const toolsWithLimit = ['search_messages', 'get_recent_messages', 'get_conversation_between']
            if (this.context.maxMessagesLimit && toolsWithLimit.includes(tc.function.name)) {
              toolParams = { ...toolParams, limit: this.context.maxMessagesLimit }
            }

            if (
              this.context.timeFilter &&
              (tc.function.name === 'search_messages' || tc.function.name === 'get_recent_messages')
            ) {
              toolParams = { ...toolParams, _timeFilter: this.context.timeFilter }
            }
          } catch {
            toolParams = undefined
          }
          onChunk({ type: 'tool_start', toolName: tc.function.name, toolParams })
        }

        await this.handleToolCalls(toolCalls, onChunk)
        this.toolRounds++
      }
    }

    aiLogger.warn('Agent', '达到最大工具调用轮数', { maxRounds: this.config.maxToolRounds })

    if (this.isAborted()) {
      onChunk({ type: 'done', isFinished: true, usage: this.totalUsage })
      return {
        content: finalContent,
        toolsUsed: this.toolsUsed,
        toolRounds: this.toolRounds,
        totalUsage: this.totalUsage,
      }
    }

    this.messages.push({ role: 'user', content: '请根据已获取的信息给出回答，不要再调用工具。' })

    for await (const chunk of chatStream(this.messages, {
      ...this.config.llmOptions,
      abortSignal: this.abortSignal,
    })) {
      if (this.isAborted()) {
        onChunk({ type: 'done', isFinished: true, usage: this.totalUsage })
        break
      }
      if (chunk.content) {
        finalContent += chunk.content
        onChunk({ type: 'content', content: chunk.content })
      }
      if (chunk.usage) this.addUsage(chunk.usage)
      if (chunk.isFinished) onChunk({ type: 'done', isFinished: true, usage: this.totalUsage })
    }

    return {
      content: finalContent,
      toolsUsed: this.toolsUsed,
      toolRounds: this.toolRounds,
      totalUsage: this.totalUsage,
    }
  }

  /**
   * 处理工具调用
   */
  private async handleToolCalls(toolCalls: ToolCall[], onChunk?: (chunk: AgentStreamChunk) => void): Promise<void> {
    for (const tc of toolCalls) {
      aiLogger.info('Agent', `工具调用: ${tc.function.name}`, tc.function.arguments)
    }

    this.messages.push({
      role: 'assistant',
      content: '',
      tool_calls: toolCalls,
    })

    const results = await executeToolCalls(toolCalls, { ...this.context, locale: this.locale })

    for (let i = 0; i < toolCalls.length; i++) {
      const tc = toolCalls[i]
      const result = results[i]

      this.toolsUsed.push(tc.function.name)

      if (onChunk) {
        onChunk({
          type: 'tool_result',
          toolName: tc.function.name,
          toolResult: result.success ? result.result : result.error,
        })
      }

      if (result.success) {
        aiLogger.info('Agent', `工具结果: ${tc.function.name}`, result.result)
      } else {
        aiLogger.warn('Agent', `工具失败: ${tc.function.name}`, result.error)
      }

      this.messages.push({
        role: 'tool',
        content: result.success ? JSON.stringify(result.result) : `错误: ${result.error}`,
        tool_call_id: tc.id,
      })
    }
  }
}

/**
 * 创建 Agent 并执行对话（便捷函数）
 */
export async function runAgent(
  userMessage: string,
  context: ToolContext,
  config?: AgentConfig,
  historyMessages?: ChatMessage[],
  chatType?: 'group' | 'private'
): Promise<AgentResult> {
  const agent = new Agent(context, config, historyMessages, chatType)
  return agent.execute(userMessage)
}

/**
 * 创建 Agent 并流式执行对话（便捷函数）
 */
export async function runAgentStream(
  userMessage: string,
  context: ToolContext,
  onChunk: (chunk: AgentStreamChunk) => void,
  config?: AgentConfig,
  historyMessages?: ChatMessage[],
  chatType?: 'group' | 'private'
): Promise<AgentResult> {
  const agent = new Agent(context, config, historyMessages, chatType)
  return agent.executeStream(userMessage, onChunk)
}