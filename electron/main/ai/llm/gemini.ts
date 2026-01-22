/**
 * Google Gemini LLM Provider
 * 使用 Gemini REST API 格式，支持 Function Calling
 */

import type {
  ILLMService,
  LLMProvider,
  ChatMessage,
  ChatOptions,
  ChatResponse,
  ChatStreamChunk,
  ProviderInfo,
  ToolCall,
  ToolDefinition,
} from './types'
import { aiLogger } from '../logger'

const DEFAULT_BASE_URL = 'https://generativelanguage.googleapis.com'

const MODELS = [
  { id: 'gemini-3-flash-preview', name: 'Gemini 3 Flash Preview', description: '高速预览版' },
  { id: 'gemini-3-pro-preview', name: 'Gemini 3 Pro Preview', description: '专业预览版' },
]

export const GEMINI_INFO: ProviderInfo = {
  id: 'gemini',
  name: 'Gemini',
  description: 'Google Gemini 大语言模型',
  defaultBaseUrl: DEFAULT_BASE_URL,
  models: MODELS,
}

// ==================== Gemini API 类型定义 ====================

/** Gemini 消息 part（支持多种类型） */
interface GeminiPart {
  text?: string
  functionCall?: {
    name: string
    args: Record<string, unknown>
  }
  functionResponse?: {
    name: string
    response: unknown
  }
  /** Gemini 3+ 模型的思考签名 */
  thoughtSignature?: string
}

/** Gemini 消息内容 */
interface GeminiContent {
  role: 'user' | 'model'
  parts: GeminiPart[]
}

/** Gemini 函数声明（对应 OpenAI 的 ToolDefinition） */
interface GeminiFunctionDeclaration {
  name: string
  description: string
  parameters: {
    type: string
    properties: Record<string, unknown>
    required?: string[]
  }
}

/** Gemini 请求体 */
interface GeminiRequest {
  contents: GeminiContent[]
  generationConfig?: {
    temperature?: number
    maxOutputTokens?: number
  }
  systemInstruction?: {
    parts: Array<{ text: string }>
  }
  tools?: Array<{
    functionDeclarations: GeminiFunctionDeclaration[]
  }>
}

/** Gemini 响应候选项 */
interface GeminiCandidate {
  content?: {
    parts?: GeminiPart[]
    role?: string
  }
  finishReason?: string
}

/** Gemini API 响应 */
interface GeminiResponse {
  candidates?: GeminiCandidate[]
  usageMetadata?: {
    promptTokenCount?: number
    candidatesTokenCount?: number
    totalTokenCount?: number
  }
}

// ==================== GeminiService 类 ====================

export class GeminiService implements ILLMService {
  private apiKey: string
  private baseUrl: string
  private model: string

  constructor(apiKey: string, model?: string, baseUrl?: string) {
    this.apiKey = apiKey
    this.baseUrl = baseUrl || DEFAULT_BASE_URL
    this.model = model || 'gemini-3-flash-preview'
  }

  getProvider(): LLMProvider {
    return 'gemini'
  }

  getModels(): string[] {
    return MODELS.map((m) => m.id)
  }

  getDefaultModel(): string {
    return 'gemini-3-flash-preview'
  }

  /**
   * 将 OpenAI 格式的 tools 转换为 Gemini 格式
   */
  private convertTools(tools?: ToolDefinition[]): Array<{ functionDeclarations: GeminiFunctionDeclaration[] }> | undefined {
    if (!tools || tools.length === 0) return undefined

    const functionDeclarations: GeminiFunctionDeclaration[] = tools.map((tool) => ({
      name: tool.function.name,
      description: tool.function.description,
      parameters: tool.function.parameters,
    }))

    return [{ functionDeclarations }]
  }

  /**
   * 将 OpenAI 格式消息转换为 Gemini 格式
   */
  private convertMessages(messages: ChatMessage[]): {
    contents: GeminiContent[]
    systemInstruction?: { parts: Array<{ text: string }> }
  } {
    const contents: GeminiContent[] = []
    let systemInstruction: { parts: Array<{ text: string }> } | undefined

    for (const msg of messages) {
      if (msg.role === 'system') {
        // Gemini 使用 systemInstruction 处理系统提示
        systemInstruction = {
          parts: [{ text: msg.content }],
        }
      } else if (msg.role === 'user') {
        contents.push({
          role: 'user',
          parts: [{ text: msg.content }],
        })
      } else if (msg.role === 'assistant') {
        // 处理 assistant 消息（可能包含 tool_calls）
        if (msg.tool_calls && msg.tool_calls.length > 0) {
          // 有工具调用的 assistant 消息
          const parts: GeminiPart[] = []
          if (msg.content) {
            parts.push({ text: msg.content })
          }
          for (const tc of msg.tool_calls) {
            const part: GeminiPart = {
              functionCall: {
                name: tc.function.name,
                args: JSON.parse(tc.function.arguments),
              },
            }
            // Gemini 3+ 需要包含 thoughtSignature
            if (tc.thoughtSignature) {
              part.thoughtSignature = tc.thoughtSignature
            }
            parts.push(part)
          }
          contents.push({ role: 'model', parts })
        } else {
          // 普通文本消息
          contents.push({
            role: 'model',
            parts: [{ text: msg.content }],
          })
        }
      } else if (msg.role === 'tool') {
        // 工具结果消息 - 在 Gemini 中作为 user 角色的 functionResponse
        // 注意：需要从消息内容解析工具名称和结果
        // tool_call_id 格式通常是 "call_xxx"，我们需要从上下文获取工具名
        // 这里简化处理：假设内容是 JSON 格式的结果
        try {
          const result = JSON.parse(msg.content)
          // 尝试从上一条 assistant 消息中找到对应的 tool_call
          // 由于 Gemini 需要 name，我们从 tool_call_id 推断或使用默认值
          contents.push({
            role: 'user',
            parts: [
              {
                functionResponse: {
                  name: msg.tool_call_id?.replace('call_', '') || 'unknown',
                  response: result,
                },
              },
            ],
          })
        } catch {
          // 如果不是 JSON，直接作为文本结果
          contents.push({
            role: 'user',
            parts: [
              {
                functionResponse: {
                  name: msg.tool_call_id?.replace('call_', '') || 'unknown',
                  response: { result: msg.content },
                },
              },
            ],
          })
        }
      }
    }

    return { contents, systemInstruction }
  }

  /**
   * 构建 API URL
   */
  private buildUrl(stream: boolean): string {
    const action = stream ? 'streamGenerateContent' : 'generateContent'
    const base = this.baseUrl.replace(/\/$/, '')
    return `${base}/v1beta/models/${this.model}:${action}?key=${this.apiKey}`
  }

  /**
   * 从 Gemini parts 中提取工具调用
   */
  private extractToolCalls(parts?: GeminiPart[]): ToolCall[] | undefined {
    if (!parts) return undefined

    const toolCalls: ToolCall[] = []
    for (const part of parts) {
      if (part.functionCall) {
        toolCalls.push({
          id: `call_${part.functionCall.name}_${Date.now()}`,
          type: 'function',
          function: {
            name: part.functionCall.name,
            arguments: JSON.stringify(part.functionCall.args),
          },
          // 保存 Gemini 3+ 的思考签名
          thoughtSignature: part.thoughtSignature,
        })
      }
    }

    return toolCalls.length > 0 ? toolCalls : undefined
  }

  /**
   * 从 Gemini parts 中提取文本内容
   */
  private extractText(parts?: GeminiPart[]): string {
    if (!parts) return ''
    return parts
      .filter((p) => p.text)
      .map((p) => p.text)
      .join('')
  }

  async chat(messages: ChatMessage[], options?: ChatOptions): Promise<ChatResponse> {
    const { contents, systemInstruction } = this.convertMessages(messages)

    const requestBody: GeminiRequest = {
      contents,
      generationConfig: {
        temperature: options?.temperature ?? 0.7,
        maxOutputTokens: options?.maxTokens ?? 2048,
      },
    }

    if (systemInstruction) {
      requestBody.systemInstruction = systemInstruction
    }

    // 添加工具定义
    const geminiTools = this.convertTools(options?.tools)
    if (geminiTools) {
      requestBody.tools = geminiTools
    }

    const response = await fetch(this.buildUrl(false), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
      signal: options?.abortSignal,
    })

    if (!response.ok) {
      const error = await response.text()
      throw new Error(`Gemini API error: ${response.status} - ${error}`)
    }

    const data: GeminiResponse = await response.json()
    const candidate = data.candidates?.[0]
    const parts = candidate?.content?.parts
    const content = this.extractText(parts)
    const toolCalls = this.extractToolCalls(parts)

    // 解析 finish_reason
    let finishReason: ChatResponse['finishReason'] = 'error'
    const reason = candidate?.finishReason
    if (reason === 'STOP') {
      finishReason = toolCalls ? 'tool_calls' : 'stop'
    } else if (reason === 'MAX_TOKENS') {
      finishReason = 'length'
    }

    return {
      content,
      finishReason,
      tool_calls: toolCalls,
      usage: data.usageMetadata
        ? {
            promptTokens: data.usageMetadata.promptTokenCount || 0,
            completionTokens: data.usageMetadata.candidatesTokenCount || 0,
            totalTokens: data.usageMetadata.totalTokenCount || 0,
          }
        : undefined,
    }
  }

  async *chatStream(messages: ChatMessage[], options?: ChatOptions): AsyncGenerator<ChatStreamChunk> {
    const { contents, systemInstruction } = this.convertMessages(messages)

    const requestBody: GeminiRequest = {
      contents,
      generationConfig: {
        temperature: options?.temperature ?? 0.7,
        maxOutputTokens: options?.maxTokens ?? 2048,
      },
    }

    if (systemInstruction) {
      requestBody.systemInstruction = systemInstruction
    }

    // 添加工具定义
    const geminiTools = this.convertTools(options?.tools)
    if (geminiTools) {
      requestBody.tools = geminiTools
    }

    // Gemini 流式需要添加 alt=sse 参数
    const url = this.buildUrl(true) + '&alt=sse'

    aiLogger.info('Gemini', '开始流式请求', {
      url: url.replace(/key=[^&]+/, 'key=***'),
      model: this.model,
      messagesCount: contents.length,
      hasSystemInstruction: !!systemInstruction,
      hasTools: !!geminiTools,
    })

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
      signal: options?.abortSignal,
    })

    if (!response.ok) {
      const error = await response.text()
      aiLogger.error('Gemini', 'API 请求失败', { status: response.status, error: error.slice(0, 500) })
      throw new Error(`Gemini API error: ${response.status} - ${error}`)
    }

    aiLogger.info('Gemini', 'API 响应成功，开始读取流')

    const reader = response.body?.getReader()
    if (!reader) {
      throw new Error('Failed to get response reader')
    }

    const decoder = new TextDecoder()
    let buffer = ''
    // 用于累积工具调用（可能跨多个 chunk）
    const toolCallsAccumulator: ToolCall[] = []
    // 用于追踪最新的 usage 信息
    let latestUsage: { promptTokens: number; completionTokens: number; totalTokens: number } | undefined

    try {
      while (true) {
        // 检查是否已中止
        if (options?.abortSignal?.aborted) {
          yield { content: '', isFinished: true, finishReason: 'stop' }
          return
        }

        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() || ''

        for (const line of lines) {
          const trimmed = line.trim()

          if (!trimmed || !trimmed.startsWith('data: ')) continue

          const data = trimmed.slice(6)
          if (data === '[DONE]') {
            if (toolCallsAccumulator.length > 0) {
              yield { content: '', isFinished: true, finishReason: 'tool_calls', tool_calls: toolCallsAccumulator }
            } else {
              yield { content: '', isFinished: true, finishReason: 'stop' }
            }
            return
          }

          try {
            const parsed: GeminiResponse = JSON.parse(data)
            const candidate = parsed.candidates?.[0]
            const parts = candidate?.content?.parts

            // 处理文本内容
            const text = this.extractText(parts)
            if (text) {
              yield { content: text, isFinished: false }
            }

            // 处理工具调用
            const toolCalls = this.extractToolCalls(parts)
            if (toolCalls) {
              aiLogger.info('Gemini', '检测到工具调用', { toolCalls: toolCalls.map((tc) => tc.function.name) })
              toolCallsAccumulator.push(...toolCalls)
            }

            // 更新 usage 信息
            if (parsed.usageMetadata) {
              latestUsage = {
                promptTokens: parsed.usageMetadata.promptTokenCount || 0,
                completionTokens: parsed.usageMetadata.candidatesTokenCount || 0,
                totalTokens: parsed.usageMetadata.totalTokenCount || 0,
              }
            }

            // 检查是否完成
            const finishReason = candidate?.finishReason
            if (finishReason) {
              aiLogger.info('Gemini', '流式响应完成', { finishReason, toolCallsCount: toolCallsAccumulator.length, usage: latestUsage })

              if (toolCallsAccumulator.length > 0) {
                yield { content: '', isFinished: true, finishReason: 'tool_calls', tool_calls: toolCallsAccumulator, usage: latestUsage }
              } else {
                let reason: ChatStreamChunk['finishReason'] = 'stop'
                if (finishReason === 'MAX_TOKENS') {
                  reason = 'length'
                }
                yield { content: '', isFinished: true, finishReason: reason, usage: latestUsage }
              }
              return
            }
          } catch (e) {
            // 记录解析错误
            aiLogger.warn('Gemini', 'SSE 数据解析失败', { data: data.slice(0, 200), error: String(e) })
          }
        }
      }

      // 如果循环正常结束，发送完成信号
      if (toolCallsAccumulator.length > 0) {
        yield { content: '', isFinished: true, finishReason: 'tool_calls', tool_calls: toolCallsAccumulator, usage: latestUsage }
      } else {
        yield { content: '', isFinished: true, finishReason: 'stop', usage: latestUsage }
      }
    } catch (error) {
      // 如果是中止错误，正常返回
      if (error instanceof Error && error.name === 'AbortError') {
        yield { content: '', isFinished: true, finishReason: 'stop' }
        return
      }
      throw error
    } finally {
      reader.releaseLock()
    }
  }

  async validateApiKey(): Promise<{ success: boolean; error?: string }> {
    try {
      // 使用 models.list API 验证 API Key
      const url = `${this.baseUrl.replace(/\/$/, '')}/v1beta/models?key=${this.apiKey}`

      const response = await fetch(url, {
        method: 'GET',
      })

      if (response.ok) {
        return { success: true }
      }

      // 尝试获取错误详情
      const errorText = await response.text()
      let errorMessage = `HTTP ${response.status}`
      try {
        const errorJson = JSON.parse(errorText)
        errorMessage = errorJson.error?.message || errorJson.message || errorMessage
      } catch {
        if (errorText) {
          errorMessage = errorText.slice(0, 200)
        }
      }
      return { success: false, error: errorMessage }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      return { success: false, error: errorMessage }
    }
  }
}
