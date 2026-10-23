import React from 'react';
import { Button } from './ui/Button';
import { t, subscribe as subscribeLocale } from '../i18n';

interface Props {
  children: React.ReactNode;
  /** 自定义错误回退 UI（局部错误时使用，不传则用全屏样式） */
  fallback?: (error: Error, reset: () => void) => React.ReactNode;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null };

  /**
   * 语言变更时强制重渲染。
   *
   * 这里是类组件，用不了 `useLocaleSubscription()`（hook 只能在函数组件里调），
   * 所以直接订阅 i18n。不订阅的话，错误页在切语言后会停在旧语言 ——
   * 而且这屏只在崩溃时出现，真机上很难碰到，属于"漏了也测不出来"的那类。
   */
  private unsubscribeLocale?: () => void;

  componentDidMount(): void {
    this.unsubscribeLocale = subscribeLocale(() => this.forceUpdate());
  }

  componentWillUnmount(): void {
    this.unsubscribeLocale?.();
  }

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    // 组装上报负载：包含错误信息、组件栈、时间戳与当前路由/页面信息
    const extra: Record<string, unknown> = {
      componentStack: info.componentStack ?? '',
      timestamp: new Date().toISOString(),
      route: {
        href: window.location.href,
        pathname: window.location.pathname,
        hash: window.location.hash,
      },
      source: 'ErrorBoundary',
    };

    // 通过 crash:capture IPC 通道上报到 crashReporter 系统
    try {
      const ret = window.qqbat?.crash?.capture(error.message, error.stack, extra) as unknown;
      // preload 实际使用 ipcRenderer.send（fire-and-forget，返回 void），
      // 而类型声明为 Promise；这里兼容两种情况，避免对 void 调用 .catch 而二次崩溃
      if (ret && typeof (ret as Promise<unknown>).catch === 'function') {
        (ret as Promise<unknown>).catch((e) => {
          console.error('[ErrorBoundary] 崩溃上报失败:', e);
        });
      }
    } catch (e) {
      // IPC 调用失败时回退到控制台输出，绝不让上报本身导致二次崩溃
      console.error('[ErrorBoundary] 崩溃上报异常:', e);
    }

    // 同时输出到控制台便于排查
    console.error('[ErrorBoundary] 渲染异常:', error, info.componentStack);
  }

  handleReload = (): void => {
    window.location.reload();
  };

  /** 重置错误状态，让子组件重新渲染 */
  handleReset = (): void => {
    this.setState({ error: null });
  };

  handleCopy = (): void => {
    const err = this.state.error;
    if (!err) return;
    const text = `${err.message}\n\n${err.stack ?? ''}`;
    navigator.clipboard?.writeText(text).then(
      () => console.info('[ErrorBoundary] 错误已复制到剪贴板'),
      () => console.warn('[ErrorBoundary] 复制失败'),
    );
  };

  render() {
    if (this.state.error) {
      if (this.props.fallback) {
        return <>{this.props.fallback(this.state.error, this.handleReset)}</>;
      }
      return (
        <div
          role="alert"
          aria-live="assertive"
          style={{
            padding: 20,
            background: '#1a1a2e',
            color: '#ff6b6b',
            fontFamily: 'monospace',
            fontSize: 14,
            minHeight: '100vh',
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              marginBottom: 16,
            }}
          >
            <h2 style={{ color: '#ff6b6b', margin: 0 }}>{t('errorBoundary.title')}</h2>
            <div style={{ display: 'flex', gap: 8 }}>
              <Button variant="secondary" size="sm" onClick={this.handleCopy}>
                {t('errorBoundary.copyError')}
              </Button>
              <Button variant="primary" size="sm" onClick={this.handleReload}>
                {t('errorBoundary.reload')}
              </Button>
            </div>
          </div>
          <pre
            style={{
              background: '#0d0d1a',
              padding: 12,
              borderRadius: 4,
              overflow: 'auto',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
              flex: 1,
            }}
          >
            {this.state.error.message}
            {'\n\n'}
            {this.state.error.stack}
          </pre>
        </div>
      );
    }
    return this.props.children;
  }
}
