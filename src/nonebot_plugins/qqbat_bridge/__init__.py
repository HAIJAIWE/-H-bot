"""
QQ bat 数据变更通知接收插件
在机器人进程内启动一个轻量 HTTP 服务，接收主进程的数据变更通知
端口号通过 --qqbat-bridge-port 参数传入
"""
import asyncio
import json
import os
import sys
import signal
from aiohttp import web
from nonebot import get_driver, get_bot

driver = get_driver()
_changed_callbacks = []


def on_data_changed(callback):
    """注册数据变更回调"""
    _changed_callbacks.append(callback)


@driver.on_startup
async def _start_http_server():
    """启动 HTTP 服务"""
    # 从命令行参数获取端口
    port = None
    for i, arg in enumerate(sys.argv):
        if arg == '--qqbat-bridge-port' and i + 1 < len(sys.argv):
            try:
                p = int(sys.argv[i + 1])
                if 1 <= p <= 65535:
                    port = p
                else:
                    print(f'[qqbat_bridge] 端口号 {p} 超出有效范围 (1-65535)，跳过', flush=True)
            except ValueError:
                print(f'[qqbat_bridge] 无效端口号: {sys.argv[i + 1]}，跳过', flush=True)
            break

    # 从环境变量获取端口（备选）
    if port is None:
        port_str = os.environ.get('QQBAT_BRIDGE_PORT')
        if port_str:
            try:
                p = int(port_str)
                if 1 <= p <= 65535:
                    port = p
                else:
                    print(f'[qqbat_bridge] 端口号 {p} 超出有效范围 (1-65535)，跳过', flush=True)
            except ValueError:
                print(f'[qqbat_bridge] 无效端口号: {port_str}，跳过', flush=True)

    if port is None:
        return  # 没有配置端口，跳过启动

    app = web.Application()
    app.router.add_post('/data_changed', _handle_data_changed)
    app.router.add_get('/health', _handle_health)
    app.router.add_post('/shutdown', _handle_shutdown)

    runner = web.AppRunner(app)
    await runner.setup()
    site = web.TCPSite(runner, 'localhost', port)
    await site.start()

    # 通知主进程 HTTP 服务已就绪（通过 stdout）
    print(f'[qqbat_bridge] HTTP 服务已启动: localhost:{port}', flush=True)


async def _handle_data_changed(request):
    """处理数据变更通知"""
    try:
        body = await request.json()
        table = body.get('table', '')
        action = body.get('action', '')
        qq = body.get('qq', '')

        # 触发注册的回调
        for cb in _changed_callbacks:
            try:
                if asyncio.iscoroutinefunction(cb):
                    await cb(table, action, qq)
                else:
                    cb(table, action, qq)
            except Exception as e:
                print(f'[qqbat_bridge] 回调处理错误: {e}', flush=True)

        return web.json_response({'ok': True})
    except Exception as e:
        return web.json_response({'ok': False, 'error': str(e)})


async def _handle_health(request):
    """健康检查"""
    return web.json_response({'ok': True, 'status': 'running'})


async def _handle_shutdown(request):
    """关闭 HTTP 服务（需携带 secret 认证）"""
    secret = os.environ.get('QQBAT_BRIDGE_SECRET', '')
    if secret:
        auth = request.headers.get('Authorization', '')
        if auth != f'Bearer {secret}':
            return web.json_response({'ok': False, 'error': 'unauthorized'}, status=403)
    # 优雅退出：发送 SIGTERM 让 NoneBot 正常走 on_shutdown 流程
    os.kill(os.getpid(), signal.SIGTERM)
    return web.json_response({'ok': True})
