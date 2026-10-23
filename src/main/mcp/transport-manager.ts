// src/main/mcp/transport-manager.ts
// MCP Transport 生命周期管理：管理 SSE transport 的创建、路由和清理。
//
// 安全边界：端口只绑 127.0.0.1，但**本机不等于可信** —— 本机任意进程都能连这个端口，
// 所以每个请求都要过 `Authorization: Bearer <token>`，否则外部进程可以直接调工具改流程/写文件。
import http from 'node:http'
import { timingSafeEqual } from 'node:crypto'
import { URL } from 'node:url'
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js'
import { logger } from '../services/logger'

/**
 * SSE 建连端点（GET）。
 *
 * 2026-10-18 起从 `/sse` 改为 `/qqbat/sse`：用户完全可能把多个 MCP server 挂到
 * 同一个反向代理/隧道后面，通用路径会互相抢。⚠️ 破坏性：外部 IDE 里填的
 * `http://127.0.0.1:43190/sse` 要改成 `/qqbat/sse`。
 */
export const MCP_SSE_PATH = '/qqbat/sse'

/** 消息回传端点（POST，SSE transport 会把完整地址发给客户端） */
export const MCP_MESSAGES_PATH = '/qqbat/messages'

export interface SseAuthOptions {
  /** 一次性 Bearer token；为空表示不鉴权（只应在测试里出现） */
  authToken?: string
}

/**
 * 常量时间比较 `Authorization: Bearer <token>`。
 *
 * 为什么用 timingSafeEqual：本机任意进程都能连这个端口，逐字节试 token 的旁路没必要留着
 * （UUID 空间虽然暴力不可行，但这类比较本来就不该写成 `===`）。
 */
export function isAuthorized(req: http.IncomingMessage, expected: string): boolean {
  const header = req.headers.authorization ?? ''
  if (!header.startsWith('Bearer ')) return false
  const got = Buffer.from(header.slice(7), 'utf-8')
  const want = Buffer.from(expected, 'utf-8')
  if (got.length !== want.length) return false
  return timingSafeEqual(got, want)
}

/**
 * 管理 SSE transport 生命周期。
 *
 * 职责：
 * - 创建 HTTP 服务器，暴露 SSE 端点（GET /qqbat/sse）和消息端点（POST /qqbat/messages）
 * - 按 sessionId 路由 POST 消息到对应的 transport
 * - 校验 Bearer token，未通过一律 401
 * - 提供统一的启动/停止接口
 */
export class TransportManager {
  private transports = new Map<string, SSEServerTransport>()
  private httpServer: http.Server | null = null
  /** SSE 鉴权 token；为空表示不鉴权（只应在测试里出现） */
  private authToken = ''

  /**
   * 启动 HTTP 服务器并注册 SSE 端点。
   * @param port 监听端口
   * @param mcpServer MCP Server 实例，每个新 SSE 连接会 connect 到它
   * @param opts.authToken 一次性 Bearer token；未通过鉴权的请求一律 401
   */
  async startHttpServer(
    port: number,
    mcpServer: Server,
    opts: SseAuthOptions = {}
  ): Promise<void> {
    if (this.httpServer) {
      throw new Error('HTTP server already running')
    }
    this.authToken = opts.authToken ?? ''

    const server = http.createServer()

    server.on('request', async (req, res) => {
      try {
        if (this.authToken && !isAuthorized(req, this.authToken)) {
          res.writeHead(401, {
            'WWW-Authenticate': 'Bearer',
            'Content-Type': 'text/plain; charset=utf-8'
          })
          res.end('Unauthorized：需要 Authorization: Bearer <token>')
          return
        }
        const parsedUrl = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`)
        const pathname = parsedUrl.pathname

        if (req.method === 'GET' && pathname === MCP_SSE_PATH) {
          await this.handleSseConnection(req, res, mcpServer)
        } else if (req.method === 'POST' && pathname === MCP_MESSAGES_PATH) {
          await this.handlePostMessage(req, res, parsedUrl)
        } else {
          res.writeHead(404).end('Not found')
        }
      } catch (err) {
        if (!res.headersSent) {
          res.writeHead(500).end('Internal server error')
        }
        logger.error('[TransportManager] request error:', err)
      }
    })

    return new Promise<void>((resolve, reject) => {
      server.listen(port, '127.0.0.1', () => {
        this.httpServer = server
        resolve()
      })
      server.once('error', reject)
    })
  }

  /**
   * 处理 GET /qqbat/sse —— 建立 SSE 连接。
   */
  private async handleSseConnection(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    mcpServer: Server
  ): Promise<void> {
    const transport = new SSEServerTransport(MCP_MESSAGES_PATH, res)
    const sessionId = transport.sessionId
    this.transports.set(sessionId, transport)

    transport.onclose = () => {
      this.transports.delete(sessionId)
    }

    transport.onerror = (err) => {
      logger.error(`[TransportManager] transport error [${sessionId}]:`, err)
    }

    await mcpServer.connect(transport)
  }

  /**
   * 处理 POST /qqbat/messages —— 接收客户端 JSON-RPC 消息。
   */
  private async handlePostMessage(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    parsedUrl: URL
  ): Promise<void> {
    const sessionId = parsedUrl.searchParams.get('sessionId')
    if (!sessionId) {
      res.writeHead(400).end('Missing sessionId parameter')
      return
    }

    const transport = this.transports.get(sessionId)
    if (!transport) {
      res.writeHead(404).end('Session not found')
      return
    }

    await transport.handlePostMessage(req, res, undefined)
  }

  /**
   * 关闭所有 transport 并停止 HTTP 服务器。
   */
  async stop(): Promise<void> {
    for (const [sessionId, transport] of this.transports) {
      try {
        await transport.close()
      } catch (err) {
        logger.error(`[TransportManager] error closing transport [${sessionId}]:`, err)
      }
    }
    this.transports.clear()
    this.authToken = ''

    if (this.httpServer) {
      await new Promise<void>((resolve, reject) => {
        this.httpServer!.close((err) => {
          if (err) reject(err)
          else resolve()
        })
      })
      this.httpServer = null
    }
  }
}
