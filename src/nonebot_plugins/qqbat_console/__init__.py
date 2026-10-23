"""
QQ bat 控制台指令接收插件
监听 stdin，接收来自主进程的控制台指令，转发给业务插件处理，将结果输出到 stdout
"""
import asyncio
import sys
from nonebot import get_driver, on_command
from nonebot.rule import to_me
from nonebot.adapters.onebot.v11 import Bot, Event

# 这个插件在机器人进程内运行，通过 stdin/stdout 与主进程通信

driver = get_driver()


@driver.on_startup
async def _():
    """启动 stdin 监听线程"""
    loop = asyncio.get_running_loop()
    asyncio.create_task(_stdin_reader(loop))


async def _stdin_reader(loop):
    """异步读取 stdin 指令"""
    reader = asyncio.StreamReader()
    protocol = asyncio.StreamReaderProtocol(reader)
    await loop.connect_read_pipe(lambda: protocol, sys.stdin)

    while True:
        try:
            line = (await reader.readline()).decode('utf-8', errors='replace').strip()
            if not line:
                await asyncio.sleep(0.1)
                continue
            # 解析指令格式: /命令名 参数...
            result = await _process_command(line)
            print(result, flush=True)
        except Exception as e:
            print(f'指令处理错误: {e}', flush=True)
        await asyncio.sleep(0.05)


async def _process_command(cmd: str) -> str:
    """处理单条指令，返回结果字符串"""
    # 基础指令直接在这里处理
    parts = cmd.strip().split(maxsplit=1)
    if not parts:
        return '空指令'
    command = parts[0].lstrip('/')
    args = parts[1] if len(parts) > 1 else ''

    if command == 'ping':
        return 'pong'
    elif command == 'help':
        return '可用指令: ping, help'
    elif command == 'status':
        return '机器人运行正常'
    else:
        return f'未知指令: {command}，发送 /help 查看可用指令'
