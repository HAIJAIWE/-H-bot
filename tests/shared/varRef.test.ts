// tests/shared/varRef.test.ts
//
// 命名变量键格式的**单一来源**（`src/shared/nodes/varRef.ts`）。
//
// 这个文件存在的理由：这套编码有三个使用者（运行时取值、UI 下拉框、表达式别名层），
// 任何一处自己拼字符串，就会出现"面板存的是 A、运行时读的是 B"的静默失配 ——
// 不报错，只是取不到值。所以把编解码的往返钉死在这里。
import { describe, it, expect } from 'vitest';
import {
  NAMED_VAR_PREFIX,
  NAMED_VAR_REF_NODE,
  namedVarKey,
  namedVarNameOf,
  isNamedVarKey,
  refToVarKey,
  refToOptionValue,
  optionValueToRef,
  EXPRESSION_CONFIG_KEYS,
  parseSubflowParams,
} from '@shared/nodes/varRef';

describe('命名变量键：构造与解析必须往返', () => {
  it('namedVarKey 加前缀，namedVarNameOf 剥回来', () => {
    for (const name of ['lv', '进贡次数', 'a b', 'x:y']) {
      const key = namedVarKey(name);
      expect(key).toBe(NAMED_VAR_PREFIX + name);
      expect(namedVarNameOf(key)).toBe(name);
    }
  });

  it('不认的键返回 null（不是猜一个名字出来）', () => {
    expect(namedVarNameOf('')).toBeNull();
    expect(namedVarNameOf('node1:port1')).toBeNull();
    // 只有前缀、没有名字：也不算命名变量
    expect(namedVarNameOf(NAMED_VAR_PREFIX)).toBeNull();
    expect(isNamedVarKey(NAMED_VAR_PREFIX)).toBe(false);
  });

  it('isNamedVarKey 只认"前缀 + 非空名字"', () => {
    expect(isNamedVarKey(namedVarKey('lv'))).toBe(true);
    expect(isNamedVarKey('lv')).toBe(false);
    expect(isNamedVarKey('__var__lv')).toBe(false);
  });
});

describe('whereParamRef → 存储键', () => {
  it('伪节点 __var__ ⇒ 命名变量键；真节点 ⇒ 节点:端口', () => {
    expect(refToVarKey({ nodeId: NAMED_VAR_REF_NODE, portId: 'lv' })).toBe(namedVarKey('lv'));
    expect(refToVarKey({ nodeId: 'rpg_enc', portId: 'result' })).toBe('rpg_enc:result');
  });

  it('缺一半 ⇒ null（调用方应视为"没配来源"）', () => {
    expect(refToVarKey(null)).toBeNull();
    expect(refToVarKey(undefined)).toBeNull();
    expect(refToVarKey({})).toBeNull();
    expect(refToVarKey({ nodeId: 'rpg_enc' })).toBeNull();
    expect(refToVarKey({ portId: 'result' })).toBeNull();
    // 非字符串同样当作没配
    expect(refToVarKey({ nodeId: 1, portId: 'x' })).toBeNull();
  });
});

describe('下拉框选项值：refToOptionValue / optionValueToRef 必須互逆', () => {
  it('往返保持 nodeId/portId', () => {
    for (const ref of [
      { nodeId: NAMED_VAR_REF_NODE, portId: 'lv' },
      { nodeId: 'rpg_enc', portId: 'result' },
      { nodeId: 'n1', portId: 'a:b' },
    ]) {
      const value = refToOptionValue(ref);
      expect(optionValueToRef(value)).toEqual({ nodeId: ref.nodeId, portId: ref.portId });
    }
  });

  it('空 ref ⇒ 空串；空串/无冒号 ⇒ null（首字符是冒号也算无效）', () => {
    expect(refToOptionValue(null)).toBe('');
    expect(refToOptionValue({ nodeId: 'n1' })).toBe('');
    expect(optionValueToRef('')).toBeNull();
    expect(optionValueToRef('nodash')).toBeNull();
    expect(optionValueToRef(':port')).toBeNull();
    expect(optionValueToRef('node:')).toBeNull();
  });

  it('端口名里的冒号只按第一个冒号切（否则 n1:a:b 会解析错）', () => {
    expect(optionValueToRef('n1:a:b')).toEqual({ nodeId: 'n1', portId: 'a:b' });
  });
});

describe('表达式节点的配置键排除表', () => {
  it('只包含配置键，不含任何变量名', () => {
    for (const k of ['mode', 'expression', 'formulas', 'variables_json', 'variables']) {
      expect(EXPRESSION_CONFIG_KEYS.has(k)).toBe(true);
    }
    expect(EXPRESSION_CONFIG_KEYS.has('lv')).toBe(false);
  });
});

describe('子流程参数：两种盘上存法都要收', () => {
  it('JSON 字符串（面板/默认配置存法）', () => {
    expect(parseSubflowParams('[{"name":"a"},{"name":" b "}]')).toEqual(['a', 'b']);
    expect(parseSubflowParams('["x","y"]')).toEqual(['x', 'y']);
  });

  it('数组（早期版本/手工编辑）', () => {
    expect(parseSubflowParams([{ name: 'a' }, 'b'])).toEqual(['a', 'b']);
  });

  it('坏输入 ⇒ 空数组（不抛错：这段在热路径上）', () => {
    expect(parseSubflowParams('{oops')).toEqual([]);
    expect(parseSubflowParams(null)).toEqual([]);
    expect(parseSubflowParams({ a: 1 })).toEqual([]);
    // 无名的行直接丢掉
    expect(parseSubflowParams([{}, { name: '  ' }, { name: 'ok' }])).toEqual(['ok']);
  });
});
