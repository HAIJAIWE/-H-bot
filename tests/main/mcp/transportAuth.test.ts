// tests/main/mcp/transportAuth.test.ts
//
// MCP SSE 端点的鉴权与路径契约：
// - 端口只绑 127.0.0.1，但本机任意进程都能连，必须校验 Authorization: Bearer <token>；
// - 2026-10-18 起路径从 /sse、/messages 改为 /qqbat/sse、/qqbat/messages（通用路径会和
//   同一反向代理后面的其它 MCP server 打架）。
import { describe, it, expect, afterEach } from 'vitest'
import http from 'node:http'
import net from 'node:net'
import type { Server } from '@modelcontextprotocol/sdk/server/index.js'
import {
  TransportManager,
  isAuthorized,
  MCP_SSE_PATH,
  MCP_MESSAGES_PATH
} from '@main/mcp/transport-manager'

const fakeServer = { connect: async () => {} } as unknown as Server

function reqWithAuth(header?: string): http.IncomingMessage {
  return { headers: header === undefined ? {} : { authorization: header } } as http.IncomingMessage
}

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = net.createServer()
    probe.once('error', reject)
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address()
      const port = typeof address === 'object' && address ? address.port : 0
      probe.close(() => resolve(port))
    })
  })
}

function request(
  port: number,
  method: string,
  path: string,
  headers: Record<string, string> = {}
): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, method, path, headers }, (res) => {
      let body = ''
      res.setEncoding('utf-8')
      res.on('data', (chunk) => (body += chunk))
      res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body }))
    })
    req.once('error', reject)
    req.end()
  })
}

describe('isAuthorized', () => {
  it('接受完全匹配的 Bearer token', () => {
    expect(isAuthorized(reqWithAuth('Bearer s3cret'), 's3cret')).toBe(true)
  })

  it('拒绝缺失/错误/异长度 token 与非 Bearer 方案', () => {
    expect(isAuthorized(reqWithAuth(), 's3cret')).toBe(false)
    expect(isAuthorized(reqWithAuth('Bearer wrong'), 's3cret')).toBe(false)
    expect(isAuthorized(reqWithAuth('Bearer s3cret-extra'), 's3cret')).toBe(false)
    expect(isAuthorized(reqWithAuth('Basic s3cret'), 's3cret')).toBe(false)
  })
})

describe('TransportManager SSE 鉴权与路径', () => {
  let manager: TransportManager | null = null

  afterEach(async () => {
    await manager?.stop()
    manager = null
  })

  it('未带 token 的请求一律 401，且不落到路由', async () => {
    manager = new TransportManager()
    const port = await freePort()
    await manager.startHttpServer(port, fakeServer, { authToken: 's3cret' })

    const res = await request(port, 'GET', MCP_SSE_PATH)
    expect(res.status).toBe(401)
    expect(res.headers['www-authenticate']).toBe('Bearer')
    expect(res.body).toContain('Unauthorized')
  })

  it('带 token 时走新路径；旧路径 /sse 已废弃返回 404', async () => {
    manager = new TransportManager()
    const port = await freePort()
    await manager.startHttpServer(port, fakeServer, { authToken: 's3cret' })

    const authed = { authorization: 'Bearer s3cret' }
    // 缺 sessionId：说明鉴权通过、POST 消息路由生效
    const post = await request(port, 'POST', MCP_MESSAGES_PATH, authed)
    expect(post.status).toBe(400)
    // 旧的通用路径不再注册
    const legacy = await request(port, 'GET', '/sse', authed)
    expect(legacy.status).toBe(404)
  })

  it('未配置 token 时（仅测试场景）不鉴权', async () => {
    manager = new TransportManager()
    const port = await freePort()
    await manager.startHttpServer(port, fakeServer)

    const res = await request(port, 'POST', MCP_MESSAGES_PATH)
    expect(res.status).toBe(400)
  })
})
