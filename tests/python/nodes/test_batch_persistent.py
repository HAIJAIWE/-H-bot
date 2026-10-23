"""batch_persistent 节点单元测试。

覆盖：
- load 模式：批量读取多个 key，JSON/list 两种 keys 格式
- save 模式：批量保存 dict/JSON 两种 data 格式，部分失败处理
- 未知 mode、空 keys/data、非法格式等边界
- _load_value / _save_value 的 mock 隔离

被测源码：qqbat_nodes/builtin/batch_persistent.py
"""
import json
from unittest.mock import AsyncMock, patch

import pytest

from qqbat_nodes.builtin.batch_persistent import (
    batch_persistent,
    _batch_load,
    _batch_save,
    _err,
    _ok,
)


# =============================================================================
# 辅助函数 _err / _ok
# =============================================================================
class TestHelpers:
    """验证返回结构构造函数。"""

    def test_err_returns_unified_structure(self):
        """_err 返回统一错误结构：out=None, values={}, count=0, saved=0, keys=[], error=msg。"""
        result = _err("some error")
        assert result['out'] is None
        assert result['values'] == {}
        assert result['count'] == 0
        assert result['saved'] == 0
        assert result['keys'] == []
        assert result['error'] == 'some error'

    def test_ok_default_empty_values(self):
        """_ok 无参时返回空结构。"""
        result = _ok()
        assert result['out'] is None
        assert result['values'] == {}
        assert result['count'] == 0
        assert result['saved'] == 0
        assert result['keys'] == []
        assert result['error'] == ''

    def test_ok_with_values(self):
        """_ok 接受 values/count 参数。"""
        result = _ok(values={'a': 1, 'b': 2}, count=2)
        assert result['values'] == {'a': 1, 'b': 2}
        assert result['count'] == 2

    def test_ok_with_partial_error(self):
        """_ok 支持部分失败的 error 字段。"""
        result = _ok(saved=2, keys=['a', 'b'], error='c: 保存失败')
        assert result['saved'] == 2
        assert result['keys'] == ['a', 'b']
        assert result['error'] == 'c: 保存失败'


# =============================================================================
# mode 分发
# =============================================================================
class TestModeDispatch:
    """验证 batch_persistent 的 mode 分发逻辑。"""

    @pytest.mark.asyncio
    async def test_unknown_mode_returns_error(self, mock_bot, mock_event):
        """未知 mode 返回 _err 结构。"""
        result = await batch_persistent(
            mock_bot, mock_event, mode='delete', keys='[]', data='{}',
        )
        assert result['out'] is None
        assert result['values'] == {}
        assert result['count'] == 0
        assert '未知 mode' in result['error']
        assert 'delete' in result['error']


# =============================================================================
# load 模式
# =============================================================================
class TestBatchLoad:
    """验证 _batch_load / batch_persistent(mode=load) 的批量读取。"""

    @pytest.mark.asyncio
    async def test_load_multiple_keys_json_string(self, mock_event):
        """load 模式：JSON 字符串 keys 批量读取。"""
        async def _fake_load(key, scope, event):
            return {'a': 1, 'b': 2, 'c': 3}.get(key)

        with patch('qqbat_nodes.builtin.batch_persistent._load_value',
                   new=_fake_load):
            result = await _batch_load(mock_event, 'user', '["a","b","c"]')
        assert result['values'] == {'a': 1, 'b': 2, 'c': 3}
        assert result['count'] == 3
        assert result['error'] == ''

    @pytest.mark.asyncio
    async def test_load_multiple_keys_list_type(self, mock_event):
        """load 模式：list 类型 keys 也可接受。"""
        async def _fake_load(key, scope, event):
            return f'val_{key}'

        with patch('qqbat_nodes.builtin.batch_persistent._load_value',
                   new=_fake_load):
            result = await _batch_load(mock_event, 'user', ['x', 'y'])
        assert result['values'] == {'x': 'val_x', 'y': 'val_y'}
        assert result['count'] == 2

    @pytest.mark.asyncio
    async def test_load_empty_keys_returns_error(self, mock_event):
        """load 模式：keys 为空返回错误。"""
        result = await _batch_load(mock_event, 'user', '')
        assert result['count'] == 0
        assert 'keys 为空' in result['error']

    @pytest.mark.asyncio
    async def test_load_invalid_keys_format(self, mock_event):
        """load 模式：keys 为非法类型（int）返回错误。"""
        result = await _batch_load(mock_event, 'user', 12345)
        assert 'keys 格式错误' in result['error']

    @pytest.mark.asyncio
    async def test_load_keys_json_array_with_invalid_json(self, mock_event):
        """load 模式：keys 为非法 JSON 字符串触发异常 → 返回 error。"""
        result = await _batch_load(mock_event, 'user', 'not json')
        assert result['count'] == 0
        # json.loads 抛 JSONDecodeError 被外层 try-except 捕获
        assert result['error'] != ''

    @pytest.mark.asyncio
    async def test_load_keys_not_list_after_parse(self, mock_event):
        """load 模式：解析后非 list 返回错误。"""
        result = await _batch_load(mock_event, 'user', '{"a":1}')
        # JSON 解析得到 dict，不是 list
        assert 'keys 必须是数组' in result['error']

    @pytest.mark.asyncio
    async def test_load_skips_empty_key_strings(self, mock_event):
        """load 模式：keys 列表中空白字符串被跳过。"""
        async def _fake_load(key, scope, event):
            return 1

        with patch('qqbat_nodes.builtin.batch_persistent._load_value',
                   new=_fake_load):
            result = await _batch_load(mock_event, 'user', ['a', '', '  ', 'b'])
        # 空白字符串被 strip 后跳过
        assert result['count'] == 2
        assert set(result['values'].keys()) == {'a', 'b'}

    @pytest.mark.asyncio
    async def test_load_via_batch_persistent_entry(self, mock_bot, mock_event):
        """通过 batch_persistent 入口调用 load 模式。"""
        async def _fake_load(key, scope, event):
            return 100 if key == 'exp' else None

        with patch('qqbat_nodes.builtin.batch_persistent._load_value',
                   new=_fake_load):
            result = await batch_persistent(
                mock_bot, mock_event,
                mode='load', keys='["exp","gold"]',
            )
        assert result['values'] == {'exp': 100, 'gold': None}
        assert result['count'] == 2


# =============================================================================
# save 模式
# =============================================================================
class TestBatchSave:
    """验证 _batch_save / batch_persistent(mode=save) 的批量保存。"""

    @pytest.mark.asyncio
    async def test_save_dict_data_success(self, mock_event):
        """save 模式：dict 类型 data 全部成功保存。"""
        async def _fake_batch_save(data_dict, scope, event, ttl=0):
            keys = list(data_dict.keys())
            return (len(keys), [str(k) for k in keys], [])

        with patch('qqbat_nodes.builtin.batch_persistent._batch_save_values',
                   new=_fake_batch_save):
            result = await _batch_save(
                mock_event, 'user', {'a': 1, 'b': 2, 'c': 3}, ttl=0,
            )
        assert result['saved'] == 3
        assert result['keys'] == ['a', 'b', 'c']
        assert result['error'] == ''

    @pytest.mark.asyncio
    async def test_save_json_string_data(self, mock_event):
        """save 模式：JSON 字符串 data 也可接受。"""
        async def _fake_batch_save(data_dict, scope, event, ttl=0):
            keys = list(data_dict.keys())
            return (len(keys), [str(k) for k in keys], [])

        with patch('qqbat_nodes.builtin.batch_persistent._batch_save_values',
                   new=_fake_batch_save):
            result = await _batch_save(
                mock_event, 'user', '{"x": 10}', ttl=0,
            )
        assert result['saved'] == 1
        assert result['keys'] == ['x']

    @pytest.mark.asyncio
    async def test_save_empty_dict_returns_error(self, mock_event):
        """save 模式：data 为空 dict 返回 'data 为空' 错误。"""
        result = await _batch_save(mock_event, 'user', {}, ttl=0)
        assert result['saved'] == 0
        assert 'data 为空' in result['error']

    @pytest.mark.asyncio
    async def test_save_invalid_data_format(self, mock_event):
        """save 模式：data 为非 str/dict 类型（如 list）返回 'data 格式错误'。"""
        result = await _batch_save(mock_event, 'user', ['a', 'b'], ttl=0)
        assert 'data 格式错误' in result['error']

    @pytest.mark.asyncio
    async def test_save_partial_failure_aggregates_error(self, mock_event):
        """save 模式：部分失败时 error 汇总失败原因，saved 只计成功数。

        _batch_save_values 返回 (saved, keys, errors) 三元组，
        其中 errors 是失败键的错误信息列表（格式 "key: 原因"）。
        """
        async def _fake_batch_save(data_dict, scope, event, ttl=0):
            saved_keys = [str(k) for k in data_dict.keys() if str(k) != 'b']
            errors = ['b: 保存失败'] if 'b' in data_dict else []
            return (len(saved_keys), saved_keys, errors)

        with patch('qqbat_nodes.builtin.batch_persistent._batch_save_values',
                   new=_fake_batch_save):
            result = await _batch_save(
                mock_event, 'user', {'a': 1, 'b': 2, 'c': 3}, ttl=0,
            )
        assert result['saved'] == 2
        assert result['keys'] == ['a', 'c']
        assert 'b: 保存失败' in result['error']
        assert result['error'] != ''

    @pytest.mark.asyncio
    async def test_save_invalid_json_string(self, mock_event):
        """save 模式：非法 JSON 字符串触发异常 → 返回 error。"""
        result = await _batch_save(mock_event, 'user', 'not json', ttl=0)
        assert result['saved'] == 0
        assert result['error'] != ''

    @pytest.mark.asyncio
    async def test_save_via_batch_persistent_entry(self, mock_bot, mock_event):
        """通过 batch_persistent 入口调用 save 模式。"""
        async def _fake_batch_save(data_dict, scope, event, ttl=0):
            keys = list(data_dict.keys())
            return (len(keys), [str(k) for k in keys], [])

        with patch('qqbat_nodes.builtin.batch_persistent._batch_save_values',
                   new=_fake_batch_save):
            result = await batch_persistent(
                mock_bot, mock_event,
                mode='save', data=json.dumps({'hp': 100, 'mp': 50}),
                ttl=60,
            )
        assert result['saved'] == 2
        assert set(result['keys']) == {'hp', 'mp'}

    @pytest.mark.asyncio
    async def test_save_dict_not_dict_after_parse(self, mock_event):
        """save 模式：JSON 解析后非 dict（如 list）返回 'data 为空' 错误。"""
        # json.loads('[1,2]') → list → not isinstance(data_dict, dict) → "data 为空"
        result = await _batch_save(mock_event, 'user', '[1, 2, 3]', ttl=0)
        assert 'data 为空' in result['error']
