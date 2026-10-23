// src/main/mcp/transport-manager.ts
// MCP Transport 生命周期管理：管理 SSE transport 的创建、路由和清理。
import http from 'node:http'
import { URL } from 'node:url'
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js'
import { logger } from '../services/logger'

/**
 * 管理 SSE transport 生命周期。
 *
 * 职责：
 * - 创建 HTTP 服务器，暴露 SSE 端点（GET /sse）和消息端点（POST /messages）
 * - 按 sessionId 路由 POST 消息到对应的 transport
 * - 提供统一的启动/停止接口
 */
export class TransportManager {
  private transports = new Map<string, SSEServerTransport>()
  private httpServer: http.Server | null = null

  /**
   * 启动 HTTP 服务器并注册 SSE 端点。
   * @param port 监听端口
   * @param mcpServer MCP Server 实例，每个新 SSE 连接会 connect 到它
   */
  async startHttpServer(port: number, mcpServer: Server): Promise<void> {
    if (this.httpServer) {
      throw new Error('HTTP server already running')
    }

    const server = http.createServer()

    server.on('request', async (req, res) => {
      try {
        const parsedUrl = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`)
        const pathname = parsedUrl.pathname

        if (req.method === 'GET' && pathname === '/sse') {
          await this.handleSseConnection(req, res, mcpServer)
        } else if (req.method === 'POST' && pathname === '/messages') {
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
   * 处理 GET /sse —— 建立 SSE 连接。
   */
  private async handleSseConnection(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    mcpServer: Server
  ): Promise<void> {
    const transport = new SSEServerTransport('/messages', res)
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
   * 处理 POST /messages —— 接收客户端 JSON-RPC 消息。
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