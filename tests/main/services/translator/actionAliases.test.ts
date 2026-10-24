import { describe, expect, it } from 'vitest';
import { ALL_ACTION_HANDLERS } from '@main/services/translator/actions';
import {
  LEGACY_ACTION_ALIASES,
  normalizeActionName,
} from '@main/services/translator/actions/aliases';

/**
 * 动作名归一化：存量的 .qqbat/flow.json 里还写着 send_group_msg 这类旧名，
 * 网关入口必须把它们映射到现行命名，否则用户升级后原有流程会集体「不支持的动作」。
 */
describe('旧动作名归一化', () => {
  it('旧名全部映射到新名', () => {
    const expected: Record<string, string> = {
      send_msg: 'send_message',
      send_group_msg: 'send_group_message',
      send_private_msg: 'send_private_message',
      send_stream_msg: 'send_stream_message',
      send_keyboard_msg: 'send_keyboard_message',
      send_channel_msg: 'send_channel_message',
      delete_msg: 'delete_message',
    };
    expect({ ...LEGACY_ACTION_ALIASES }).toEqual(expected);
    for (const [oldName, newName] of Object.entries(expected)) {
      expect(normalizeActionName(oldName)).toBe(newName);
    }
  });

  it('edit_msg / get_msg / send_group_forward_msg 不登记别名（改名前就没有 handler）', () => {
    for (const name of ['edit_msg', 'get_msg', 'send_group_forward_msg']) {
      expect(normalizeActionName(name)).toBe(name);
    }
  });

  it('别名目标都真实存在（不会映射到一个没人实现的动作）', () => {
    const handlers = ALL_ACTION_HANDLERS as Record<string, unknown>;
    for (const newName of Object.values(LEGACY_ACTION_ALIASES)) {
      expect(typeof handlers[newName], `${newName} 没有 handler`).toBe('function');
    }
  });

  it('新名与未知动作原样透传（未知的仍交给查表报错）', () => {
    expect(normalizeActionName('send_message')).toBe('send_message');
    expect(normalizeActionName('no_such_action')).toBe('no_such_action');
    expect(normalizeActionName(undefined)).toBe('');
    expect(normalizeActionName(null)).toBe('');
  });
});