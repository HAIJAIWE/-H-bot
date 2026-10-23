// src/renderer/src/hooks/useJsonEditMode.ts
import { useState, useCallback } from 'react';
import { t } from '../i18n';

/**
 * JSON 编辑模式 hook —— 抽取自 SwitchCaseEditor / EndNodeConfigEditor / SubflowParamsEditor
 * 三个编辑器组件共有的"可视化编辑 ↔ JSON 编辑"切换逻辑。
 *
 * 三个组件原本各自维护 jsonMode / jsonText / jsonError 三段 state +
 * enterJsonMode / applyJson 两个函数，逻辑完全相同，仅校验字段不同。
 * 此 hook 消除重复，校验逻辑通过 validate 回调注入。
 *
 * @param data 当前可视化数据（进入 JSON 模式时序列化为文本）
 * @param onApply 应用解析后的数据（校验通过后调用）
 * @param validate 可选校验函数，返回错误信息（空串表示通过）
 */
export function useJsonEditMode<T>(
  data: T,
  onApply: (parsed: T) => void,
  validate?: (parsed: unknown) => string,
) {
  const [jsonMode, setJsonMode] = useState(false);
  const [jsonText, setJsonText] = useState('');
  const [jsonError, setJsonError] = useState('');

  const enterJsonMode = useCallback(() => {
    setJsonText(JSON.stringify(data, null, 2));
    setJsonError('');
    setJsonMode(true);
  }, [data]);

  const exitJsonMode = useCallback(() => {
    setJsonMode(false);
  }, []);

  const applyJson = useCallback(() => {
    try {
      const parsed = JSON.parse(jsonText);
      const err = validate ? validate(parsed) : '';
      if (err) {
        setJsonError(err);
        return;
      }
      setJsonError('');
      onApply(parsed as T);
      setJsonMode(false);
    } catch {
      setJsonError(t('blocks.schemaForm.invalidJson'));
    }
  }, [jsonText, onApply, validate]);

  const updateJsonText = useCallback((text: string) => {
    setJsonText(text);
    setJsonError('');
  }, []);

  return {
    jsonMode,
    jsonText,
    jsonError,
    enterJsonMode,
    exitJsonMode,
    applyJson,
    updateJsonText,
  };
}
