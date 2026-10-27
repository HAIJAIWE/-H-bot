// examples/window-packages/demo.executable/entry.js
//
// 第 74 批示例：一份**自包含**的窗口包入口，跑在宿主的 Blob module worker 里。
// - 没有 DOM、没有 Node、不能 import（Blob 没有 base URL）
// - 只能：收 {type:'init'} / {type:'context'}，发 {type:'view'} / {type:'command'}
// - 视图是数据（见 src/shared/plugins/windowView.ts 的白名单节点）
let ctx = null

self.onmessage = event => {
  const msg = event.data
  if (!msg || typeof msg !== 'object') return
  if (msg.type === 'context') {
    ctx = msg.context
    render()
  }
}

function render() {
  const threads = (ctx?.threads ?? []).map(thread => ({
    title: thread.title,
    detail: thread.messageCount + ' 条消息',
    active: thread.id === ctx.threadId,
    command: 'select-thread',
    payload: thread.id,
  }))
  const last = ctx?.messages?.[ctx.messages.length - 1]
  const current = (ctx?.threads ?? []).find(thread => thread.id === ctx?.threadId)

  self.postMessage({
    type: 'view',
    view: {
      root: {
        type: 'stack',
        gap: 'md',
        children: [
          {
            type: 'header',
            title: '可执行窗口（外部包）',
            subtitle: 'worker 沙箱 · 无 DOM · 只收发消息',
          },
          {
            type: 'text',
            content: ctx
              ? '当前线程：' + (current ? current.title : '（未选择）')
              : '等待宿主推送上下文…',
            muted: true,
          },
          {
            type: 'list',
            items:
              threads.length > 0
                ? threads
                : [{ title: '还没有会话', detail: '用下面的按钮新建或发送消息' }],
          },
          { type: 'divider' },
          {
            type: 'stack',
            gap: 'sm',
            children: [
              {
                type: 'button',
                label: '发送「继续」',
                command: 'send-message',
                payload: '继续',
                primary: true,
                disabled: Boolean(ctx?.streaming),
              },
              {
                type: 'button',
                label: '停止生成',
                command: 'stop',
                disabled: !ctx?.streaming,
              },
            ],
          },
          {
            type: 'text',
            content: last ? '最近一条：' + String(last.content).slice(0, 160) : '（还没有消息）',
            muted: true,
          },
        ],
      },
    },
  })
}

render()
