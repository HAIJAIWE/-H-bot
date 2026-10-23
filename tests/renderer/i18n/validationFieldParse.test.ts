// tests/renderer/i18n/validationFieldParse.test.ts
//
// 不变量：`parseErrorFieldKey` 要从错误消息里反解出 config 字段 key（用于「点错误条
// 跳字段」与内联字段红框）。它靠消息里**第一个「」引号内的字段名**做反解 ——
// 所以每条消息在 zH 和 en 两种语言下都必须保证：
//   1. 消息里保留了 `「{field}」` 占位（周围散文随便翻）；
//   2. 引号内的字段名能经 `findFieldKeyByLabel` 精确反解回原 key。
//
// 这层耦合之前靠"消息里写死中文 + 正则匹配中文短语「需填写…」"硬撑，
// 英文界面下会静默失配（跳转失效但 UI 无报错）。下面的测试在两个语言下逐一断言。
import { describe, it, expect } from 'vitest';
import zhCN from '@renderer/i18n/zh-CN.json';
import enUS from '@renderer/i18n/en-US.json';
import { fieldLabel } from '@renderer/i18n/fieldLabels';
import { parseErrorFieldKey } from '@renderer/stores/flowStore';

/** 每个文本模板：{ key, ...fieldArgs }，fieldArgs 是 fieldLabel() 的参数 → 译者必须保密「{}」内的是字段名 */
const TEMPLATES: Array<{ tpl: string; key: string }> = [
  { tpl: 'fieldRequired', key: 'command' },
  { tpl: 'fieldInvalidJson', key: 'cases' },
  { tpl: 'proactiveTargetRequired', key: 'target_id' },
  { tpl: 'modeTextRequired', key: 'text' },
  { tpl: 'modeMarkdownRequired', key: 'markdown' },
  { tpl: 'modeKeyboardRequired', key: 'markdown' },
  { tpl: 'modeKeyboardButtonsRequired', key: 'keyboard' },
  { tpl: 'modeMediaRequired', key: 'media_url' },
  { tpl: 'modeSegmentRequired', key: 'segments' },
  { tpl: 'modeStreamRequired', key: 'text' },
  { tpl: 'modeStreamPrivateOnly', key: 'target_type' },
  { tpl: 'modeForwardRequired', key: 'messages' },
];

describe('校验错误消息 → 字段 key 反解（两种语言下都成立）', () => {
  const packs = [
    { name: 'zh-CN', validation: (zhCN as unknown as { validation: Record<string, string> }).validation },
    { name: 'en-US', validation: (enUS as unknown as { validation: Record<string, string> }).validation },
  ];
  for (const pack of packs) {
    describe(pack.name, () => {
      for (const { tpl, key } of TEMPLATES) {
        it(`${tpl} 消息里的字段名能反解回 ${key}`, () => {
          const value = pack.validation[tpl];
          expect(value, `${tpl} 在 ${pack.name} 语言包里应存在`).toBeDefined();
          // 关键：用当前语言的字段显示名（fieldLabel(key)）替换 {field} 占位，
          // 因为运行时尚不知道 config 里的 key → 只可能是当前语言的显示名。
          // 反解必须从这条"本地化消息"里找回 key。
          const msg = value.replace('{field}', fieldLabel(key));
          expect(parseErrorFieldKey(msg)).toBe(key);
        });
      }
    });
  }
});