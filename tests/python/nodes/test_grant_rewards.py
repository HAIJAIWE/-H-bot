"""grant_rewards 节点单元测试 — 重点回归 P0 bug：add 模式累加奖励失效。

P0 bug 背景：
    旧代码把 load_persistent 返回的 dict 当作数值直接参与加法：
        load_result = await load_persistent.load_persistent(...)
        current = load_result  # ❌ 错误：是 dict 不是数值
        # isinstance(dict, (int, float)) == False → 永远回退为 0
        # 导致 add 模式实际写入 amount，玩家原值被覆盖丢失
    修复后：
        current = load_result.get('result') if isinstance(load_result, dict) else None
        # 正确提取原值，累加生效

被测源码：qqbat_nodes/builtin/grant_rewards.py
"""
import json
from unittest.mock import AsyncMock, patch

import pytest

from qqbat_nodes.builtin.grant_rewards import grant_rewards


# ---------------------------------------------------------------------------
# 辅助：构造 load_persistent / save_persistent / expression_eval 的 mock
# ---------------------------------------------------------------------------

def _mock_load(return_value):
    """构造 load_persistent mock，返回 {"result": return_value, "error": ""}。"""
    return AsyncMock(return_value={"result": return_value, "error": ""})


def _mock_save(success=True, error=""):
    """构造 save_persistent mock。"""
    return AsyncMock(return_value={"success": success, "value_out": None, "error": error})


def _mock_eval(result):
    """构造 expression_eval mock，返回 {"result": result, "error": ""}。"""
    return AsyncMock(return_value={"result": result, "error": ""})


def _mock_eval_dynamic(func):
    """构造 expression_eval mock，使用自定义函数计算结果。

    用于验证 expression_eval 被传入正确的 variables_json。
    """
    async def _eval(*args, **kwargs):
        return {"result": func(**kwargs), "error": ""}
    return _eval


# =============================================================================
# P0 回归：add 模式累加正确（最关键的测试）
# =============================================================================
class TestAddModeAccumulation:
    """验证 add 模式正确读取原值并累加，回归 P0 bug。"""

    @pytest.mark.asyncio
    async def test_add_with_existing_value_100_plus_50(self, mock_bot, mock_event):
        """P0 核心：玩家原值 100，发放 50，应得 150。

        修复前：load_result 是 dict，被当作数值 → isinstance(dict, (int,float))=False
                → current=0 → 0+50=50（原值 100 被丢失）
        修复后：current=load_result['result']=100 → 100+50=150
        """
        with patch('qqbat_nodes.builtin.load_persistent.load_persistent',
                   new=_mock_load(100)), \
             patch('qqbat_nodes.builtin.save_persistent.save_persistent',
                   new=_mock_save()), \
             patch('qqbat_nodes.builtin.expression_eval.expression_eval',
                   new=_mock_eval(150)):
            result = await grant_rewards(
                mock_bot, mock_event,
                rewards='[{"label":"经验","key":"rpg_exp","amount":50}]',
                mode='add',
            )
        assert result['success'] is True
        assert result['details'][0]['old_value'] == 100
        assert result['details'][0]['new_value'] == 150
        assert result['details'][0]['action'] == 'add'
        assert '获得 50 经验' in result['result']

    @pytest.mark.asyncio
    async def test_add_with_none_existing_value(self, mock_bot, mock_event):
        """add 模式：玩家无原值（None），发放 50，应得 50。

        load_persistent 返回 result=None（键不存在）→ current=0 → 0+50=50
        old_value 应为 0（None 被规范化为 0）。
        """
        with patch('qqbat_nodes.builtin.load_persistent.load_persistent',
                   new=_mock_load(None)), \
             patch('qqbat_nodes.builtin.save_persistent.save_persistent',
                   new=_mock_save()), \
             patch('qqbat_nodes.builtin.expression_eval.expression_eval',
                   new=_mock_eval(50)):
            result = await grant_rewards(
                mock_bot, mock_event,
                rewards='[{"label":"经验","key":"rpg_exp","amount":50}]',
                mode='add',
            )
        assert result['success'] is True
        assert result['details'][0]['old_value'] == 0
        assert result['details'][0]['new_value'] == 50

    @pytest.mark.asyncio
    async def test_add_with_zero_original(self, mock_bot, mock_event):
        """add 模式：原值为 0，发放 10，应得 10（边界值）。"""
        with patch('qqbat_nodes.builtin.load_persistent.load_persistent',
                   new=_mock_load(0)), \
             patch('qqbat_nodes.builtin.save_persistent.save_persistent',
                   new=_mock_save()), \
             patch('qqbat_nodes.builtin.expression_eval.expression_eval',
                   new=_mock_eval(10)):
            result = await grant_rewards(
                mock_bot, mock_event,
                rewards='[{"label":"计数","key":"cnt","amount":10}]',
                mode='add',
            )
        assert result['details'][0]['old_value'] == 0
        assert result['details'][0]['new_value'] == 10

    @pytest.mark.asyncio
    async def test_add_float_result_kept_as_float(self, mock_bot, mock_event):
        """add 模式：浮点结果（非整数）保持浮点类型。"""
        with patch('qqbat_nodes.builtin.load_persistent.load_persistent',
                   new=_mock_load(10)), \
             patch('qqbat_nodes.builtin.save_persistent.save_persistent',
                   new=_mock_save()), \
             patch('qqbat_nodes.builtin.expression_eval.expression_eval',
                   new=_mock_eval(10.5)):
            result = await grant_rewards(
                mock_bot, mock_event,
                rewards='[{"label":"经验","key":"rpg_exp","amount":0.5}]',
                mode='add',
            )
        assert result['details'][0]['new_value'] == 10.5
        assert isinstance(result['details'][0]['new_value'], float)

    @pytest.mark.asyncio
    async def test_add_passes_correct_variables_to_expression_eval(
        self, mock_bot, mock_event,
    ):
        """验证 add 模式向 expression_eval 传入 value=current, delta=amount。"""
        captured = {}

        async def _capture_eval(*args, **kwargs):
            captured.update(kwargs)
            return {"result": 150, "error": ""}

        with patch('qqbat_nodes.builtin.load_persistent.load_persistent',
                   new=_mock_load(100)), \
             patch('qqbat_nodes.builtin.save_persistent.save_persistent',
                   new=_mock_save()), \
             patch('qqbat_nodes.builtin.expression_eval.expression_eval',
                   new=_capture_eval):
            await grant_rewards(
                mock_bot, mock_event,
                rewards='[{"label":"经验","key":"rpg_exp","amount":50}]',
                mode='add',
            )
        assert captured.get('expression') == 'value + delta'
        assert captured.get('variables_json') == {"value": 100.0, "delta": 50.0}


# =============================================================================
# set 模式：覆盖赋值
# =============================================================================
class TestSetMode:
    """验证 set 模式直接覆盖，不读取原值，old_value 为 None。"""

    @pytest.mark.asyncio
    async def test_set_overwrites_value(self, mock_bot, mock_event):
        """set 模式：直接把值设为 amount，old_value 为 None。"""
        with patch('qqbat_nodes.builtin.save_persistent.save_persistent',
                   new=_mock_save()) as save_mock:
            result = await grant_rewards(
                mock_bot, mock_event,
                rewards='[{"label":"等级","key":"rpg_level","amount":10}]',
                mode='set',
            )
        assert result['success'] is True
        assert result['details'][0]['old_value'] is None
        assert result['details'][0]['new_value'] == 10
        assert result['details'][0]['action'] == 'set'
        # set 模式不应调用 load_persistent
        save_mock.assert_called_once()

    @pytest.mark.asyncio
    async def test_set_with_zero_amount(self, mock_bot, mock_event):
        """set 模式：amount=0 被跳过（源码 if not key or not amount: continue）。"""
        with patch('qqbat_nodes.builtin.save_persistent.save_persistent',
                   new=_mock_save()) as save_mock:
            result = await grant_rewards(
                mock_bot, mock_event,
                rewards='[{"label":"重置","key":"rpg_x","amount":0}]',
                mode='set',
            )
        # amount=0 被视为 falsy 跳过
        assert result['details'] == []
        save_mock.assert_not_called()

    @pytest.mark.asyncio
    async def test_set_text_format(self, mock_bot, mock_event):
        """set 模式文本：'{label} 设为 {new_value}'。"""
        with patch('qqbat_nodes.builtin.save_persistent.save_persistent',
                   new=_mock_save()):
            result = await grant_rewards(
                mock_bot, mock_event,
                rewards='[{"label":"等级","key":"lv","amount":99}]',
                mode='set',
            )
        assert '等级 设为 99' in result['result']


# =============================================================================
# 参数解析与边界
# =============================================================================
class TestRewardsParsing:
    """验证 rewards 参数的多种格式解析与边界情况。"""

    @pytest.mark.asyncio
    async def test_empty_rewards_returns_empty(self, mock_bot, mock_event):
        """空奖励列表：返回空结果，success=True。"""
        result = await grant_rewards(mock_bot, mock_event, rewards='[]')
        assert result['success'] is True
        assert result['details'] == []
        assert result['result'] == ''
        assert result['error'] == ''

    @pytest.mark.asyncio
    async def test_empty_string_rewards(self, mock_bot, mock_event):
        """空字符串 rewards：当作空列表处理。"""
        result = await grant_rewards(mock_bot, mock_event, rewards='')
        assert result['success'] is True
        assert result['details'] == []

    @pytest.mark.asyncio
    async def test_invalid_json_rewards(self, mock_bot, mock_event):
        """非法 JSON：回退为空列表，不抛异常。"""
        result = await grant_rewards(mock_bot, mock_event, rewards='not a json')
        assert result['success'] is True
        assert result['details'] == []

    @pytest.mark.asyncio
    async def test_rewards_as_list_directly(self, mock_bot, mock_event):
        """rewards 直接传 list 类型（不经 JSON 序列化）。"""
        with patch('qqbat_nodes.builtin.load_persistent.load_persistent',
                   new=_mock_load(None)), \
             patch('qqbat_nodes.builtin.save_persistent.save_persistent',
                   new=_mock_save()), \
             patch('qqbat_nodes.builtin.expression_eval.expression_eval',
                   new=_mock_eval(50)):
            result = await grant_rewards(
                mock_bot, mock_event,
                rewards=[{"label": "经验", "key": "rpg_exp", "amount": 50}],
                mode='add',
            )
        assert result['success'] is True
        assert len(result['details']) == 1
        assert result['details'][0]['new_value'] == 50

    @pytest.mark.asyncio
    async def test_rewards_as_int_type_falls_back_to_empty(self, mock_bot, mock_event):
        """rewards 为非 str/list 类型（如 int）：回退为空列表。"""
        result = await grant_rewards(mock_bot, mock_event, rewards=12345)
        assert result['success'] is True
        assert result['details'] == []

    @pytest.mark.asyncio
    async def test_reward_item_missing_key_skipped(self, mock_bot, mock_event):
        """奖励项缺少 key：被跳过。"""
        with patch('qqbat_nodes.builtin.save_persistent.save_persistent',
                   new=_mock_save()):
            result = await grant_rewards(
                mock_bot, mock_event,
                rewards='[{"label":"x","amount":10},{"label":"y","key":"k","amount":20}]',
                mode='set',
            )
        # 第一项无 key 被跳过，只处理第二项
        assert len(result['details']) == 1
        assert result['details'][0]['key'] == 'k'

    @pytest.mark.asyncio
    async def test_reward_item_zero_amount_skipped(self, mock_bot, mock_event):
        """奖励项 amount=0 被跳过（not amount 为 True）。"""
        with patch('qqbat_nodes.builtin.save_persistent.save_persistent',
                   new=_mock_save()):
            result = await grant_rewards(
                mock_bot, mock_event,
                rewards='[{"key":"a","amount":0},{"key":"b","amount":5}]',
                mode='set',
            )
        assert len(result['details']) == 1
        assert result['details'][0]['key'] == 'b'

    @pytest.mark.asyncio
    async def test_reward_non_dict_item_skipped(self, mock_bot, mock_event):
        """奖励列表中含非 dict 项：被跳过。"""
        with patch('qqbat_nodes.builtin.save_persistent.save_persistent',
                   new=_mock_save()):
            result = await grant_rewards(
                mock_bot, mock_event,
                rewards='[123, "str", {"key":"a","amount":5}]',
                mode='set',
            )
        assert len(result['details']) == 1

    @pytest.mark.asyncio
    async def test_reward_label_defaults_to_key(self, mock_bot, mock_event):
        """奖励项无 label：label 默认为 key。"""
        with patch('qqbat_nodes.builtin.save_persistent.save_persistent',
                   new=_mock_save()):
            result = await grant_rewards(
                mock_bot, mock_event,
                rewards='[{"key":"rpg_gold","amount":100}]',
                mode='set',
            )
        assert result['details'][0]['label'] == 'rpg_gold'


# =============================================================================
# mode 校验
# =============================================================================
class TestModeValidation:
    """验证非法 mode 回退为 add。"""

    @pytest.mark.asyncio
    async def test_invalid_mode_falls_back_to_add(self, mock_bot, mock_event):
        """非法 mode 回退为 add（向后兼容）。"""
        with patch('qqbat_nodes.builtin.load_persistent.load_persistent',
                   new=_mock_load(100)), \
             patch('qqbat_nodes.builtin.save_persistent.save_persistent',
                   new=_mock_save()), \
             patch('qqbat_nodes.builtin.expression_eval.expression_eval',
                   new=_mock_eval(150)):
            result = await grant_rewards(
                mock_bot, mock_event,
                rewards='[{"label":"经验","key":"rpg_exp","amount":50}]',
                mode='invalid_mode',
            )
        # action 应为 'add'（回退后）
        assert result['details'][0]['action'] == 'add'
        assert result['details'][0]['old_value'] == 100
        assert result['details'][0]['new_value'] == 150

    @pytest.mark.asyncio
    async def test_empty_mode_falls_back_to_add(self, mock_bot, mock_event):
        """空 mode 字符串回退为 add。"""
        with patch('qqbat_nodes.builtin.load_persistent.load_persistent',
                   new=_mock_load(0)), \
             patch('qqbat_nodes.builtin.save_persistent.save_persistent',
                   new=_mock_save()), \
             patch('qqbat_nodes.builtin.expression_eval.expression_eval',
                   new=_mock_eval(50)):
            result = await grant_rewards(
                mock_bot, mock_event,
                rewards='[{"label":"经验","key":"rpg_exp","amount":50}]',
                mode='',
            )
        assert result['details'][0]['action'] == 'add'


# =============================================================================
# 错误处理
# =============================================================================
class TestErrorHandling:
    """验证 save_persistent 失败时的错误返回。"""

    @pytest.mark.asyncio
    async def test_save_failure_returns_error(self, mock_bot, mock_event):
        """save_persistent 失败：返回 success=False 与错误信息。"""
        with patch('qqbat_nodes.builtin.load_persistent.load_persistent',
                   new=_mock_load(100)), \
             patch('qqbat_nodes.builtin.expression_eval.expression_eval',
                   new=_mock_eval(150)), \
             patch('qqbat_nodes.builtin.save_persistent.save_persistent',
                   new=_mock_save(success=False, error="DB locked")):
            result = await grant_rewards(
                mock_bot, mock_event,
                rewards='[{"label":"经验","key":"rpg_exp","amount":50}]',
                mode='add',
            )
        assert result['success'] is False
        assert '保存' in result['error']
        assert 'rpg_exp' in result['error']
        assert 'DB locked' in result['error']

    @pytest.mark.asyncio
    async def test_save_failure_stops_processing_remaining_rewards(
        self, mock_bot, mock_event,
    ):
        """save 失败时停止处理后续奖励（短路返回）。"""
        call_count = {"save": 0}

        async def _fail_save(*args, **kwargs):
            call_count["save"] += 1
            return {"success": False, "value_out": None, "error": "fail"}

        with patch('qqbat_nodes.builtin.load_persistent.load_persistent',
                   new=_mock_load(0)), \
             patch('qqbat_nodes.builtin.expression_eval.expression_eval',
                   new=_mock_eval(50)), \
             patch('qqbat_nodes.builtin.save_persistent.save_persistent',
                   new=_fail_save):
            result = await grant_rewards(
                mock_bot, mock_event,
                rewards='[{"key":"a","amount":1},{"key":"b","amount":2},{"key":"c","amount":3}]',
                mode='add',
            )
        # 第一个 save 失败即返回，只调用 1 次 save
        assert call_count["save"] == 1
        assert result['success'] is False


# =============================================================================
# 多奖励批处理
# =============================================================================
class TestMultipleRewards:
    """验证多奖励项的批量处理。"""

    @pytest.mark.asyncio
    async def test_multiple_rewards_processed_in_order(self, mock_bot, mock_event):
        """多个奖励按顺序处理，details 顺序保持。"""
        load_values = {"rpg_exp": 100, "rpg_gold": 50, "rpg_potions": 2}
        eval_results = {"rpg_exp": 150, "rpg_gold": 100, "rpg_potions": 5}

        async def _mock_load_fn(*args, **kwargs):
            key = kwargs.get('key', '')
            return {"result": load_values.get(key), "error": ""}

        async def _mock_eval_fn(*args, **kwargs):
            # 通过 variables_json.value 反查 key（无法直接获取 key，用值映射）
            v = kwargs.get('variables_json', {}).get('value')
            for k, val in load_values.items():
                if val is not None and float(val) == v:
                    return {"result": eval_results[k], "error": ""}
            return {"result": v, "error": ""}

        with patch('qqbat_nodes.builtin.load_persistent.load_persistent',
                   new=_mock_load_fn), \
             patch('qqbat_nodes.builtin.save_persistent.save_persistent',
                   new=_mock_save()), \
             patch('qqbat_nodes.builtin.expression_eval.expression_eval',
                   new=_mock_eval_fn):
            result = await grant_rewards(
                mock_bot, mock_event,
                rewards=json.dumps([
                    {"label": "经验", "key": "rpg_exp", "amount": 50},
                    {"label": "金币", "key": "rpg_gold", "amount": 50},
                    {"label": "药水", "key": "rpg_potions", "amount": 3},
                ]),
                mode='add',
            )
        assert result['success'] is True
        assert len(result['details']) == 3
        keys = [d['key'] for d in result['details']]
        assert keys == ['rpg_exp', 'rpg_gold', 'rpg_potions']
        # 文本拼接用 、 分隔
        assert '获得 50 经验' in result['result']
        assert '获得 50 金币' in result['result']
        assert '获得 3 药水' in result['result']
        assert result['result'].count('、') == 2
