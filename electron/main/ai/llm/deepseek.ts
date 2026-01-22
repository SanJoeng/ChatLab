/**
 * DeepSeek LLM Provider
 * 使用 OpenAI 兼容的 API 格式，支持 Function Calling
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
} from './types'

const DEFAULT_BASE_URL = 'https://api.deepseek.com'

const MODELS = [
  { id: 'deepseek-chat', name: 'DeepSeek Chat', description: '通用对话模型' },
  { id: 'deepseek-coder', name: 'DeepSeek Coder', description: '代码生成模型' },
]

export const DEEPSEEK_INFO: ProviderInfo = {
  id: 'deepseek',
  name: 'DeepSeek',
  description: 'DeepSeek AI 大语言模型',
  defaultBaseUrl: DEFAULT_BASE_URL,
  models: MODELS,
}

export class DeepSeekService implements ILLMService {
  private apiKey: string
  private baseUrl: string
  private model: string

  constructor(apiKey: string, model?: string, baseUrl?: string) {
    this.apiKey = apiKey
    this.baseUrl = baseUrl || DEFAULT_BASE_URL
    this.model = model || 'deepseek-chat'
  }

  getProvider(): LLMProvider {
    return 'deepseek'
  }

  getModels(): string[] {
    return MODELS.map((m) => m.id)
  }

  getDefaultModel(): string {
    return 'deepseek-chat'
  }

  async chat(messages: ChatMessage[], options?: ChatOptions): Promise<ChatResponse> {
    // 构建请求体
    const requestBody: Record<string, unknown> = {
      model: this.model,
      messages: messages.map((m) => {
        const msg: Record<string, unknown> = { role: m.role, content: m.content }
        // 处理 tool 消息
        if (m.role === 'tool' && m.tool_call_id) {
          msg.tool_call_id = m.tool_call_id
        }
        // 处理 assistant 消息中的 tool_calls
        if (m.role === 'assistant' && m.tool_calls) {
          msg.tool_calls = m.tool_calls
        }
        return msg
      }),
      temperature: options?.temperature ?? 0.7,
      max_tokens: options?.maxTokens ?? 2048,
      stream: false,
    }

    // 如果有 tools，添加到请求体
    if (options?.tools && options.tools.length > 0) {
      requestBody.tools = options.tools
    }

    const response = await fetch(`${this.baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(requestBody),
      signal: options?.abortSignal,
    })

    if (!response.ok) {
      const error = await response.text()
      throw new Error(`DeepSeek API error: ${response.status} - ${error}`)
    }

    const data = await response.json()
    const choice = data.choices?.[0]
    const message = choice?.message

    // 解析 finish_reason
    let finishReason: ChatResponse['finishReason'] = 'error'
    if (choice?.finish_reason === 'stop') {
      finishReason = 'stop'
    } else if (choice?.finish_reason === 'length') {
      finishReason = 'length'
    } else if (choice?.finish_reason === 'tool_calls') {
      finishReason = 'tool_calls'
    }

    // 解析 tool_calls
    let toolCalls: ToolCall[] | undefined
    if (message?.tool_calls && Array.isArray(message.tool_calls)) {
      toolCalls = message.tool_calls.map((tc: Record<string, unknown>) => ({
        id: tc.id as string,
        type: 'function' as const,
        function: {
          name: (tc.function as Record<string, unknown>)?.name as string,
          arguments: (tc.function as Record<string, unknown>)?.arguments as string,
        },
      }))
    }

    return {
      content: message?.content || '',
      finishReason,
      tool_calls: toolCalls,
      usage: data.usage
        ? {
            promptTokens: data.usage.prompt_tokens,
            completionTokens: data.usage.completion_tokens,
            totalTokens: data.usage.total_tokens,
          }
        : undefined,
    }
  }

  async *chatStream(messages: ChatMessage[], options?: ChatOptions): AsyncGenerator<ChatStreamChunk> {
    // 构建请求体
    const requestBody: Record<string, unknown> = {
      model: this.model,
      messages: messages.map((m) => {
        const msg: Record<string, unknown> = { role: m.role, content: m.content }
        if (m.role === 'tool' && m.tool_call_id) {
          msg.tool_call_id = m.tool_call_id
        }
        if (m.role === 'assistant' && m.tool_calls) {
          msg.tool_calls = m.tool_calls
        }
        return msg
      }),
      temperature: options?.temperature ?? 0.7,
      max_tokens: options?.maxTokens ?? 2048,
      stream: true,
      // 启用流式响应中的 usage 统计
      stream_options: { include_usage: true },
    }

    if (options?.tools && options.tools.length > 0) {
      requestBody.tools = options.tools
    }

    const response = await fetch(`${this.baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(requestBody),
      signal: options?.abortSignal,
    })

    if (!response.ok) {
      const error = await response.text()
      throw new Error(`DeepSeek API error: ${response.status} - ${error}`)
    }

    const reader = response.body?.getReader()
    if (!reader) {
      throw new Error('Failed to get response reader')
    }

    const decoder = new TextDecoder()
    let buffer = ''

    // 用于收集流式 tool_calls
    const toolCallsAccumulator: Map<number, { id: string; name: string; arguments: string }> = new Map()

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
            // 如果有累积的 tool_calls，返回它们
            if (toolCallsAccumulator.size > 0) {
              const toolCalls: ToolCall[] = Array.from(toolCallsAccumulator.values()).map((tc) => ({
                id: tc.id,
                type: 'function' as const,
                function: {
                  name: tc.name,
                  arguments: tc.arguments,
                },
              }))
              yield { content: '', isFinished: true, finishReason: 'tool_calls', tool_calls: toolCalls }
            } else {
              yield { content: '', isFinished: true, finishReason: 'stop' }
            }
            return
          }

          try {
            const parsed = JSON.parse(data)
            const delta = parsed.choices?.[0]?.delta
            const finishReason = parsed.choices?.[0]?.finish_reason

            // 处理文本内容
            if (delta?.content) {
              yield {
                content: delta.content,
                isFinished: false,
              }
            }

            // 处理流式 tool_calls（增量累积）
            if (delta?.tool_calls && Array.isArray(delta.tool_calls)) {
              for (const tc of delta.tool_calls) {
                const index = tc.index ?? 0
                const existing = toolCallsAccumulator.get(index)
                if (existing) {
                  // 累积 arguments
                  if (tc.function?.arguments) {
                    existing.arguments += tc.function.arguments
                  }
                } else {
                  // 新的 tool_call
                  toolCallsAccumulator.set(index, {
                    id: tc.id || '',
                    name: tc.function?.name || '',
                    arguments: tc.function?.arguments || '',
                  })
                }
              }
            }

            if (finishReason) {
              let reason: ChatStreamChunk['finishReason'] = 'error'
              if (finishReason === 'stop') {
                reason = 'stop'
              } else if (finishReason === 'length') {
                reason = 'length'
              } else if (finishReason === 'tool_calls') {
                reason = 'tool_calls'
              }

              // 解析 usage 信息
              const usage = parsed.usage
                ? {
                    promptTokens: parsed.usage.prompt_tokens,
                    completionTokens: parsed.usage.completion_tokens,
                    totalTokens: parsed.usage.total_tokens,
                  }
                : undefined

              // 如果有 tool_calls，返回它们
              if (toolCallsAccumulator.size > 0) {
                const toolCalls: ToolCall[] = Array.from(toolCallsAccumulator.values()).map((tc) => ({
                  id: tc.id,
                  type: 'function' as const,
                  function: {
                    name: tc.name,
                    arguments: tc.arguments,
                  },
                }))
                yield { content: '', isFinished: true, finishReason: reason, tool_calls: toolCalls, usage }
              } else {
                yield { content: '', isFinished: true, finishReason: reason, usage }
              }
              return
            }
          } catch {
            // 忽略解析错误，继续处理下一行
          }
        }
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
      // 发送一个简单请求验证 API Key
      const response = await fetch(`${this.baseUrl}/v1/models`, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
        },
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
