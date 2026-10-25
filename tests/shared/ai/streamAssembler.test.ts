// tests/shared/ai/streamAssembler.test.ts
//
// # 协议翻译层：三家共用的那条流的组装
//
// 三条判据，都是旧手写实现做不到或做错过的事：
//   1. **思考要透出来**：旧的三个 `chat()` 只看 `delta.content`，`reasoning_content` 直接丢了；
//   2. **被截断的工具调用不许交出去**：`finish_reason === 'length'` 时报 `droppedToolCalls`，调用表为空；
//   3. 帧被网络切成两半仍然要拼回来（SSE 按行切、Ollama 按行切）。
import { describe, it, expect } from 'vitest'
import { assembleStream, type AssembleCallbacks } from '@shared/ai/streamAssembler'

const encoder = new TextEncoder()

function readerOf(chunks: string[]): ReadableStreamDefaultReader<Uint8Array> {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk))
      controller.close()
    },
  })
  return stream.getReader()
}

function sse(payload: unknown): string {
  return `data: ${JSON.stringify(payload)}\n\n`
}

function collector(): AssembleCallbacks & { chunks: string[]; calls: unknown[][] } {
  const chunks: string[] = []
  const calls: unknown[][] = []
  return {
    chunks,
    calls,
    onChunk: chunk => chunks.push(`${chunk.type}:${chunk.content}`),
    onComplete: () => {},
    onToolCalls: list => {
      calls.push(list)
    },
  }
}

describe('assembleStream：OpenAI 系 SSE', () => {
  it('★ 思考 + 正文 + 两个工具调用交错，回调顺序与原始形状都对', async () => {
    const callbacks = collector()
    const result = await assembleStream(
      readerOf([
        sse({ choices: [{ delta: { reasoning_content: '先想' } }] }),
        sse({ choices: [{ delta: { content: '答' } }] }),
        sse({
          choices: [
            {
              delta: {
                tool_calls: [
                  { index: 0, id: 'c1', function: { name: 'read_file', arguments: '{"pa' } },
                ],
              },
            },
          ],
        }),
        sse({
          choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: 'th":"a"}' } }] } }],
        }),
        sse({
          choices: [
            {
              delta: {
                tool_calls: [
                  {
                    index: 1,
                    id: 'c2',
                    function: { name: 'run_command', arguments: '{"command":"ls"}' },
                  },
                ],
              },
            },
          ],
        }),
        sse({ choices: [{ delta: {}, finish_reason: 'tool_calls' }] }),
        'data: [DONE]\n\n',
      ]),
      'openai',
      { callbacks },
    )

    expect(callbacks.chunks).toEqual(['reasoning:先想', 'text:答'])
    expect(result.text).toBe('答')
    expect(result.reasoning).toBe('先想')
    expect(result.finish).toEqual({ kind: 'tool-calls' })
    expect(result.droppedToolCalls).toBe(0)
    expect(result.toolCalls).toEqual([
      {
        index: 0,
        id: 'c1',
        type: 'function',
        function: { name: 'read_file', arguments: '{"path":"a"}' },
      },
      {
        index: 1,
        id: 'c2',
        type: 'function',
        function: { name: 'run_command', arguments: '{"command":"ls"}' },
      },
    ])
    expect(callbacks.calls).toHaveLength(1)
    expect(callbacks.calls[0]).toEqual(result.toolCalls)
  })

  it('★ finish_reason=length：半截工具调用一条都不交出去，数额单独报', async () => {
    const callbacks = collector()
    const result = await assembleStream(
      readerOf([
        sse({ choices: [{ delta: { content: '说到一半' } }] }),
        sse({
          choices: [
            {
              delta: {
                tool_calls: [
                  { index: 0, id: 'c1', function: { name: 'run_command', arguments: '{"comm' } },
                ],
              },
            },
          ],
        }),
        sse({ choices: [{ delta: {}, finish_reason: 'length' }] }),
      ]),
      'openai',
      { callbacks },
    )

    expect(result.text).toBe('说到一半')
    expect(result.toolCalls).toEqual([])
    expect(result.droppedToolCalls).toBe(1)
    expect(result.finish).toEqual({ kind: 'max-tokens' })
    expect(callbacks.calls).toHaveLength(0)
  })

  it('一帧被切成两半也能拼回来；坏帧跳过不打断整条流', async () => {
    const frame = sse({ choices: [{ delta: { content: '你好' } }] })
    const callbacks = collector()
    const result = await assembleStream(
      readerOf(['data: {"choices":[{"delt', 'a":{"content":"你', '好"}}]}\n\n', 'data: {oops\n\n']),
      'openai',
      { callbacks },
    )

    expect(frame.length).toBeGreaterThan(0)
    expect(result.text).toBe('你好')
    expect(result.finish).toEqual({ kind: 'stop' })
  })

  it('用量交给注入的 mapUsage 归一，不在这里分叉字段名', async () => {
    const usages: unknown[] = []
    const callbacks: AssembleCallbacks = {
      onChunk: () => {},
      onComplete: () => {},
      onUsage: usage => usages.push(usage),
    }
    await assembleStream(
      readerOf([
        sse({
          choices: [{ delta: { content: 'x' } }],
          usage: { prompt_tokens: 7, completion_tokens: 2 },
        }),
      ]),
      'openai',
      {
        callbacks,
        mapUsage: raw => {
          const usage = raw as { prompt_tokens?: number; completion_tokens?: number }
          if (usage?.prompt_tokens === undefined || usage.completion_tokens === undefined) return undefined
          return {
            promptTokens: usage.prompt_tokens,
            completionTokens: usage.completion_tokens,
            totalTokens: usage.prompt_tokens + usage.completion_tokens,
          }
        },
      },
    )

    expect(usages).toEqual([{ promptTokens: 7, completionTokens: 2, totalTokens: 9 }])
  })
})

describe('assembleStream：Ollama NDJSON', () => {
  it('★ 一行一个对象：思考与正文分开，done=true 收尾', async () => {
    const callbacks = collector()
    const result = await assembleStream(
      readerOf([
        `${JSON.stringify({ message: { thinking: '想一想' }, done: false })}\n`,
        `${JSON.stringify({ message: { content: '答案' }, done: false })}\n`,
        `${JSON.stringify({ message: { content: '' }, done: true })}\n`,
      ]),
      'ollama',
      { callbacks },
    )

    expect(callbacks.chunks).toEqual(['reasoning:想一想', 'text:答案'])
    expect(result.text).toBe('答案')
    expect(result.reasoning).toBe('想一想')
    expect(result.finish).toEqual({ kind: 'stop' })
  })

  it('最后一帧没有换行也能读到（尾巴单独冲刷）', async () => {
    const result = await assembleStream(
      readerOf([`${JSON.stringify({ response: '尾巴', done: true })}`]),
      'ollama',
      { callbacks: collector() },
    )

    expect(result.text).toBe('尾巴')
  })
})
