// tests/shared/toolFailure.test.ts
import { describe, it, expect } from 'vitest';
import { classifyToolFailure } from '../../src/shared/ai/toolFailure';

describe('★ 工具失败分类', () => {
  it('★ 常见失败 → 具体 code + 动作', () => {
    expect(classifyToolFailure('权限不足').code).toBe('permission_denied');
    expect(classifyToolFailure('权限不足').actions).toEqual(['approve']);
    expect(classifyToolFailure('工具超时（5000ms）').code).toBe('timeout');
    expect(classifyToolFailure('未知工具: nope').code).toBe('not_found');
    expect(classifyToolFailure('参数校验失败: path 必填').code).toBe('invalid_args');
    expect(classifyToolFailure('HTTP 500: internal error').code).toBe('upstream_error');
    expect(classifyToolFailure('ECONNRESET').code).toBe('upstream_error');
    expect(classifyToolFailure('已取消').code).toBe('cancelled');
  });

  it('认不出 → unknown（不猜）', () => {
    expect(classifyToolFailure('something odd happened')).toEqual({
      code: 'unknown',
      actions: ['retry'],
    });
  });

  it('顺序：权限优先于其它关键词', () => {
    expect(classifyToolFailure('权限不足：HTTP 403').code).toBe('permission_denied');
  });
});
