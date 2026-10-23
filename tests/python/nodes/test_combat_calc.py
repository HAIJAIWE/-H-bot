"""combat_calc 节点回归测试。

覆盖最近修复的 3 个问题：
1. P1 bug：expr.replace('def', 'defense') 全局字符串替换破坏含 "def" 子串的变量名
   （如 default/define/defeat/defend）。修复为 re.sub(r'\\bdef\\b', 'defense', expr)
   边界匹配。
2. 额外 bug：_safe_formula_eval 中错误 import（qqbat_nodes.builtin.expression_eval._safe_eval
   不存在）导致自定义公式功能完全失效，永远回退默认公式。修复为
   from qqbat_nodes.runtime.safe_eval import safe_eval_node。
3. P1 长函数：232 行巨型函数拆分为 14 个小函数（_parse_combat_params /
   _calc_base_damage / _run_xxx 等），拆分后行为应保持一致。

测试策略：
- Bug 1 回归：直接测试修复点 _safe_formula_eval，传入含 def 子串的变量字典
  （combat_calc 内部 _calc_base_damage 只传 {"atk","def"}，无法传入 default 等额外变量）
- Bug 2 回归：通过 combat_calc 端到端验证自定义公式生效
- 主功能：4 种战斗模式 + 未知模式 + 暴击/闪避分支
- 参数解析：JSON 优先 / kwargs 回退 / 默认值 / dict 直传 / 非法 JSON
- 辅助函数：长函数拆分后的 _calc_base_damage / _normalize_skill / _check_cooldown

随机数控制：
  combat_calc 通过 random_node.random 调用随机数，被两处使用：
  1. _random_float(min>=9000, max<=11000)：伤害浮动
  2. _random_chance(min=1, max=10000)：概率判定（命中/闪避/暴击）
  使用 make_mock_random 工厂根据 min 值区分调用方，固定随机数消除不确定性。

注：源码 _coerce_combat_ints 中 float(variance or 0.1) 在 variance=0 时返回 0.1
   （0 是 falsy），无法通过 variance=0 禁用浮动，因此测试必须 mock random。
"""
from unittest.mock import AsyncMock, patch

import pytest

from qqbat_nodes.builtin.combat_calc import (
    _calc_base_damage,
    _check_cooldown,
    _normalize_skill,
    _parse_combat_params,
    _safe_formula_eval,
    combat_calc,
)


def make_mock_random(trigger_probability=True):
    """创建 mock random 函数，固定随机数以消除测试不确定性。

    random_node.random 在 combat_calc 中被两处调用：
    1. _random_float(min>=9000, max<=11000)：用于伤害浮动
       - 返回 10000 使 r/scale = 1.0（浮动无效果，base 不变）
    2. _random_chance(min=1, max=10000)：用于概率判定（命中/闪避/暴击）
       - trigger_probability=True：返回 1（1 <= int(rate*10000) → True，触发）
       - trigger_probability=False：返回 9999（9999 > int(rate*10000) → False，不触发）

    Args:
        trigger_probability: 控制 _random_chance 的判定结果
    """
    async def mock_random(**kwargs):
        mode = kwargs.get('mode', 'int')
        if mode != 'int':
            return {"result": None, "error": ""}
        min_val = kwargs.get('min', kwargs.get('min_value', 1))
        # _random_float 调用：min = int((1-variance) * 10000)，variance=0.1 → min=9000
        if min_val > 100:  # _random_float 调用
            return {"result": 10000, "error": ""}  # 浮动 = 1.0
        # _random_chance 调用：min=1, max=10000
        return {"result": 1 if trigger_probability else 9999, "error": ""}
    return mock_random


# =============================================================================
# Bug 1 回归测试：def 边界匹配
# =============================================================================
class TestDefBoundaryReplacement:
    """验证 re.sub(r'\\bdef\\b', 'defense', expr) 只替换独立单词 def，
    不误伤 default/define/defeat/defend 等含 def 子串的合法变量名。

    注意：combat_calc 内部 _calc_base_damage 只传 {"atk": atk, "def": dfn}，
    无法传入 default 等额外变量，因此直接测试修复点 _safe_formula_eval。
    """

    def test_default_variable_preserved(self):
        """含 'default' 子串的变量名不被错误替换。

        修复前：'default + def'.replace('def','defense') = 'defenseault + defense'
                → defenseault 未定义 → 求值失败 → 回退默认 = max(1, 10-3//2) = 9
        修复后：'default + defense' = 10 + 3 = 13
        """
        result = _safe_formula_eval('default + def', {'default': 10, 'def': 3})
        assert result == 13

    def test_debuff_variable_preserved(self):
        """验证 'debuff' 变量名能正确解析。

        注：'debuff' 实际为 d-e-b-u-f-f，并不含 'def' 子串（任务描述有误），
        因此修复前后行为相同。此用例主要覆盖常见游戏变量名的解析路径，
        确保 debuff 不会被边界匹配误伤。
        """
        result = _safe_formula_eval('debuff - def', {'debuff': 10, 'def': 3})
        assert result == 7

    def test_defeat_variable_preserved(self):
        """含 'defeat' 子串的变量名不被错误替换。

        修复前：'defeat * 2 - def'.replace('def','defense') = 'defenseeat * 2 - defense'
                → defenseeat 未定义 → 回退默认 = max(1, 10-2//2) = 9（atk 默认 10）
        修复后：'defeat * 2 - defense' = 5 * 2 - 2 = 8
        """
        result = _safe_formula_eval('defeat * 2 - def', {'defeat': 5, 'def': 2})
        assert result == 8

    def test_define_variable_preserved(self):
        """含 'define' 子串的变量名不被错误替换。

        修复前：'define + def'.replace('def','defense') = 'defenseine + defense'
                → defenseine 未定义 → 回退默认
        修复后：'define + defense' = 20 + 4 = 24
        """
        result = _safe_formula_eval('define + def', {'define': 20, 'def': 4})
        assert result == 24

    def test_defend_variable_preserved(self):
        """含 'defend' 子串的变量名不被错误替换。

        修复前：'defend - def'.replace('def','defense') = 'defenseend - defense'
                → defenseend 未定义 → 回退默认
        修复后：'defend - defense' = 15 - 5 = 10
        """
        result = _safe_formula_eval('defend - def', {'defend': 15, 'def': 5})
        assert result == 10

    @pytest.mark.asyncio
    async def test_standalone_def_replaced(self, mock_bot, mock_event):
        """独立的 'def' 被正确替换为 'defense'（端到端验证）。

        damage_formula='def * 2'，defender_def=5
        修复后：defense * 2 = 5 * 2 = 10
        mock random 使浮动=1.0，crit_rate 默认 0 不调用 _random_chance。
        """
        with patch('qqbat_nodes.builtin.combat_calc.random_node.random',
                   new=make_mock_random(trigger_probability=False)):
            result = await combat_calc(
                mock_bot, mock_event, mode='turn_based',
                attacker_atk=10, defender_def=5,
                damage_formula='def * 2',
            )
        assert result['damage'] == 10


# =============================================================================
# Bug 2 回归测试：自定义公式生效
# =============================================================================
class TestCustomFormulaEval:
    """验证 _safe_formula_eval 正确委托 safe_eval_node，自定义 damage_formula 生效。

    修复前：from qqbat_nodes.builtin.expression_eval import _safe_eval 失败
            → 异常被吞 → 永远回退默认公式 max(1, atk - def//2)
    修复后：from qqbat_nodes.runtime.safe_eval import safe_eval_node 成功
            → 自定义公式生效
    """

    @pytest.mark.asyncio
    async def test_custom_formula_atk_times_2_minus_def(self, mock_bot, mock_event):
        """自定义公式 atk*2-def 正确求值。

        修复前：回退默认 max(1, 10-3//2) = 9
        修复后：10*2 - 3 = 17
        """
        with patch('qqbat_nodes.builtin.combat_calc.random_node.random',
                   new=make_mock_random(trigger_probability=False)):
            result = await combat_calc(
                mock_bot, mock_event, mode='turn_based',
                attacker_atk=10, defender_def=3,
                damage_formula='atk*2-def',
            )
        assert result['damage'] == 17

    @pytest.mark.asyncio
    async def test_custom_formula_with_complex_expression(self, mock_bot, mock_event):
        """复杂公式 (atk + def) * 2 正确求值（含括号优先级）。"""
        # (10 + 3) * 2 = 26
        with patch('qqbat_nodes.builtin.combat_calc.random_node.random',
                   new=make_mock_random(trigger_probability=False)):
            result = await combat_calc(
                mock_bot, mock_event, mode='turn_based',
                attacker_atk=10, defender_def=3,
                damage_formula='(atk + def) * 2',
            )
        assert result['damage'] == 26

    @pytest.mark.asyncio
    async def test_custom_formula_fallback_on_invalid_syntax(self, mock_bot, mock_event):
        """非法公式语法时回退到默认公式，不抛异常。

        'atk +* def' 语法错误 → ast.parse 抛 SyntaxError → 回退默认
        默认公式：max(1, 10 - 3//2) = 9
        """
        with patch('qqbat_nodes.builtin.combat_calc.random_node.random',
                   new=make_mock_random(trigger_probability=False)):
            result = await combat_calc(
                mock_bot, mock_event, mode='turn_based',
                attacker_atk=10, defender_def=3,
                damage_formula='atk +* def',
            )
        assert result['damage'] == 9

    @pytest.mark.asyncio
    async def test_custom_formula_with_safe_func(self, mock_bot, mock_event):
        """自定义公式支持白名单函数 max/min。"""
        # max(atk, def) = max(10, 3) = 10
        with patch('qqbat_nodes.builtin.combat_calc.random_node.random',
                   new=make_mock_random(trigger_probability=False)):
            result = await combat_calc(
                mock_bot, mock_event, mode='turn_based',
                attacker_atk=10, defender_def=3,
                damage_formula='max(atk, def)',
            )
        assert result['damage'] == 10

    def test_custom_formula_min_value_clamp(self):
        """公式结果小于 1 时被 clamp 为 1（max(1, int(val))）。"""
        # atk - def = 1 - 10 = -9 → max(1, -9) = 1
        result = _safe_formula_eval('atk - def', {'atk': 1, 'def': 10})
        assert result == 1

    def test_custom_formula_undefined_var_falls_back(self):
        """公式引用未定义变量时回退默认公式（P2 修复后 safe_eval_node raise ValueError，
        _safe_formula_eval 捕获后回退）。"""
        # 'unknown_var + atk' → unknown_var 未定义 → raise ValueError → 回退
        # 回退：max(1, 10 - 3//2) = 9
        result = _safe_formula_eval('unknown_var + atk', {'atk': 10, 'def': 3})
        assert result == 9


# =============================================================================
# 主功能测试：4 种战斗模式
# =============================================================================
class TestCombatModes:
    """覆盖 4 种战斗模式的核心路径与边界场景。

    随机数控制策略：
    - 优先通过参数禁用随机：crit_rate=0 / hit_rate=1.0 / dodge_rate=0.0
    - 必要时 patch qqbat_nodes.builtin.combat_calc.random_node.random
    - 冷却制需要 patch qqbat_nodes.builtin.combat_calc.time.time
    """

    @pytest.mark.asyncio
    async def test_turn_based_mode(self, mock_bot, mock_event):
        """回合制模式：基础伤害 = atk - def//2。

        atk=20, def=10 → 20 - 5 = 15
        mock random 使浮动=1.0，crit_rate 默认 0 不暴击。
        """
        with patch('qqbat_nodes.builtin.combat_calc.random_node.random',
                   new=make_mock_random(trigger_probability=False)):
            result = await combat_calc(
                mock_bot, mock_event, mode='turn_based',
                attacker_atk=20, defender_def=10,
            )
        assert result['damage'] == 15
        assert result['is_crit'] is False
        assert result['defender_hp_remain'] == 35  # 50 - 15
        assert result['is_hit'] is True

    @pytest.mark.asyncio
    async def test_turn_based_mode_with_critical(self, mock_bot, mock_event):
        """回合制模式暴击：伤害 * crit_mult。

        mock random 使浮动=1.0，_random_chance(0.5) 触发暴击。
        base = 15, crit: 15 * 2 = 30
        """
        with patch('qqbat_nodes.builtin.combat_calc.random_node.random',
                   new=make_mock_random(trigger_probability=True)):
            result = await combat_calc(
                mock_bot, mock_event, mode='turn_based',
                attacker_atk=20, defender_def=10,
                crit='{"rate":0.5,"multiplier":2.0}',
            )
        assert result['damage'] == 30
        assert result['is_crit'] is True

    @pytest.mark.asyncio
    async def test_probability_mode_hit(self, mock_bot, mock_event):
        """概率制模式命中：mock random 使 _random_chance(0.5) 触发。

        hit_rate=0.5: trigger_probability=True → 1 <= 5000 → True (命中)
        dodge_rate=0.0: rate<=0 直接 False，不调用 random
        mock random 使浮动=1.0；显式 crit.rate=0 关闭暴击，
        避免 combat_calc 默认 crit='{"rate":0.1,"multiplier":1.5}' 触发暴击
        导致 damage=15*1.5=22 而非预期的 15
        """
        with patch('qqbat_nodes.builtin.combat_calc.random_node.random',
                   new=make_mock_random(trigger_probability=True)):
            result = await combat_calc(
                mock_bot, mock_event, mode='probability',
                attacker_atk=20, defender_def=10,
                hit_dodge='{"hit_rate":0.5,"dodge_rate":0.0}',
                crit='{"rate":0,"multiplier":1.5}',
            )
        assert result['is_hit'] is True
        assert result['is_dodge'] is False
        assert result['damage'] == 15  # 20 - 5

    @pytest.mark.asyncio
    async def test_probability_mode_miss(self, mock_bot, mock_event):
        """概率制模式未命中：mock random 使 _random_chance(0.5) 不触发。

        hit_rate=0.5: trigger_probability=False → 9999 > 5000 → False (未命中)
        """
        with patch('qqbat_nodes.builtin.combat_calc.random_node.random',
                   new=make_mock_random(trigger_probability=False)):
            result = await combat_calc(
                mock_bot, mock_event, mode='probability',
                attacker_atk=20, defender_def=10,
                hit_dodge='{"hit_rate":0.5,"dodge_rate":0.0}',
            )
        assert result['is_hit'] is False
        assert result['is_dodge'] is True
        assert result['damage'] == 0
        assert '未命中' in result['result_text']

    @pytest.mark.asyncio
    async def test_probability_mode_dodge(self, mock_bot, mock_event):
        """概率制模式闪避：命中后触发闪避。

        hit_rate=1.0: rate>=1 直接 True，不调用 random
        dodge_rate=0.5: trigger_probability=True → 1 <= 5000 → True (闪避)
        """
        with patch('qqbat_nodes.builtin.combat_calc.random_node.random',
                   new=make_mock_random(trigger_probability=True)):
            result = await combat_calc(
                mock_bot, mock_event, mode='probability',
                attacker_atk=20, defender_def=10,
                hit_dodge='{"hit_rate":1.0,"dodge_rate":0.5}',
            )
        assert result['is_dodge'] is True
        assert result['is_hit'] is False
        assert result['damage'] == 0
        assert '闪避' in result['result_text']

    @pytest.mark.asyncio
    async def test_skill_counter_mode_attacker_wins(self, mock_bot, mock_event):
        """技能克制模式：攻击者克制防御者，双倍伤害。

        counter_map = {"rock": "scissors", ...}，rock 克 scissors。
        base = (20 - 10//2) * 2 = 15 * 2 = 30
        skill_counter 模式不调用 random，无需 mock。
        """
        result = await combat_calc(
            mock_bot, mock_event, mode='skill_counter',
            attacker_atk=20, defender_def=10,
            skills='{"attacker":"rock","defender":"scissors"}',
        )
        assert result['damage'] == 30
        assert result['counter_damage'] == 0
        assert '克制成功' in result['result_text']

    @pytest.mark.asyncio
    async def test_skill_counter_mode_defender_wins(self, mock_bot, mock_event):
        """技能克制模式：防御者克制攻击者，攻击无效 + 反击。

        attacker=scissors, defender=rock → rock 克 scissors → 防御者克制
        counter = _calc_base_damage(defender_def=20, attacker_atk=10)
                = max(1, 20 - 10//2) = 15
        """
        result = await combat_calc(
            mock_bot, mock_event, mode='skill_counter',
            attacker_atk=10, defender_def=20,
            skills='{"attacker":"scissors","defender":"rock"}',
        )
        assert result['is_hit'] is False
        assert result['counter_damage'] == 15
        assert '被克制' in result['result_text']

    @pytest.mark.asyncio
    async def test_skill_counter_mode_draw(self, mock_bot, mock_event):
        """技能克制模式：平局双方互伤一半。

        双方都出 rock：
        base = _calc_base_damage(20, 10) // 2 = 15 // 2 = 7
        counter = _calc_base_damage(10, 20) // 2 = max(1, 0) // 2 = 1 // 2 = 0
        """
        result = await combat_calc(
            mock_bot, mock_event, mode='skill_counter',
            attacker_atk=20, defender_def=10,
            skills='{"attacker":"rock","defender":"rock"}',
        )
        assert result['damage'] == 7
        assert result['counter_damage'] == 0
        assert '平局' in result['result_text']

    @pytest.mark.asyncio
    async def test_cooldown_mode_available(self, mock_bot, mock_event):
        """冷却制模式：技能可用时返回伤害。

        now=2000, last_ts=500, cooldown=10
        remain = 10 - (2000-500) = -1490 < 0 → 不在冷却
        base = 20 - 5 = 15
        mock random 使浮动=1.0
        """
        with patch('qqbat_nodes.builtin.combat_calc.random_node.random',
                   new=make_mock_random(trigger_probability=False)), \
             patch('qqbat_nodes.builtin.combat_calc.time.time', return_value=2000):
            result = await combat_calc(
                mock_bot, mock_event, mode='cooldown',
                attacker_atk=20, defender_def=10,
                cooldown='{"sec":10,"last_ts":500}',
            )
        assert result['damage'] == 15
        assert result['can_attack'] is True
        assert result['cooldown_remain'] == 10  # cd["cooldown"]
        assert result.get('new_ts') == 2000  # 供下游更新 last_attack_ts

    @pytest.mark.asyncio
    async def test_cooldown_mode_on_cooldown(self, mock_bot, mock_event):
        """冷却制模式：技能冷却中返回 0 伤害。

        now=505, last_ts=500, cooldown=10
        remain = 10 - (505-500) = 5 > 0 → 在冷却
        """
        with patch('qqbat_nodes.builtin.combat_calc.time.time', return_value=505):
            result = await combat_calc(
                mock_bot, mock_event, mode='cooldown',
                attacker_atk=20, defender_def=10,
                cooldown='{"sec":10,"last_ts":500}',
            )
        assert result['damage'] == 0
        assert result['can_attack'] is False
        assert result['cooldown_remain'] == 5
        assert '冷却中' in result['result_text']
        assert 'new_ts' not in result  # 冷却中不更新时间戳

    @pytest.mark.asyncio
    async def test_unknown_mode_returns_error(self, mock_bot, mock_event):
        """未知模式返回错误文本，伤害为 0，其他字段保持默认值。"""
        result = await combat_calc(
            mock_bot, mock_event, mode='unknown_mode',
        )
        assert result['damage'] == 0
        assert '未知战斗模式' in result['result_text']
        assert result['can_attack'] is True  # 默认值未变


# =============================================================================
# 参数解析测试
# =============================================================================
class TestParamParsing:
    """验证 _parse_combat_params 的 JSON 优先 / kwargs 回退 / 默认值逻辑。"""

    def test_json_params_priority(self):
        """JSON 字符串参数优先于 kwargs。"""
        params = _parse_combat_params(
            crit='{"rate":0.2,"multiplier":2.5}',
            hit_dodge='{"hit_rate":0.8,"dodge_rate":0.1}',
            skills='{"attacker":"paper","defender":"rock"}',
            cooldown='{"sec":30,"last_ts":1000}',
            kwargs={
                'crit_rate': 0.1, 'crit_mult': 1.5,
                'hit_rate': 1.0, 'dodge_rate': 0.0,
                'attacker_skill': 'rock', 'defender_skill': 'rock',
                'cooldown_sec': 0, 'last_attack_ts': 0,
            },
        )
        assert params['crit_rate'] == 0.2
        assert params['crit_mult'] == 2.5
        assert params['hit_rate'] == 0.8
        assert params['dodge_rate'] == 0.1
        assert params['attacker_skill'] == 'paper'
        assert params['defender_skill'] == 'rock'
        assert params['cooldown_sec'] == 30
        assert params['last_attack_ts'] == 1000

    def test_kwargs_fallback(self):
        """无 JSON 时使用 kwargs 旧参数名。"""
        params = _parse_combat_params(
            crit='', hit_dodge='', skills='', cooldown='',
            kwargs={
                'crit_rate': 0.3, 'crit_mult': 2.0,
                'hit_rate': 0.7, 'dodge_rate': 0.2,
                'attacker_skill': 'scissors', 'defender_skill': 'paper',
                'cooldown_sec': 60, 'last_attack_ts': 2000,
            },
        )
        assert params['crit_rate'] == 0.3
        assert params['crit_mult'] == 2.0
        assert params['hit_rate'] == 0.7
        assert params['dodge_rate'] == 0.2
        assert params['attacker_skill'] == 'scissors'
        assert params['defender_skill'] == 'paper'
        assert params['cooldown_sec'] == 60
        assert params['last_attack_ts'] == 2000

    def test_empty_params_uses_defaults(self):
        """空参数使用默认值。"""
        params = _parse_combat_params('', '', '', '', {})
        assert params['crit_rate'] == 0.0
        assert params['crit_mult'] == 1.5
        assert params['hit_rate'] == 1.0
        assert params['dodge_rate'] == 0.0
        assert params['attacker_skill'] == ''
        assert params['defender_skill'] == ''
        assert params['cooldown_sec'] == 0
        assert params['last_attack_ts'] == 0

    def test_invalid_json_falls_back_to_kwargs(self):
        """非法 JSON 字符串回退到 kwargs（_parse_json_param 捕获 ValueError）。"""
        params = _parse_combat_params(
            crit='not a json', hit_dodge='{invalid', skills='', cooldown='',
            kwargs={'crit_rate': 0.4, 'crit_mult': 3.0},
        )
        assert params['crit_rate'] == 0.4
        assert params['crit_mult'] == 3.0

    def test_dict_param_accepted_directly(self):
        """dict 类型参数直接接受（_parse_json_param 兼容 dict）。"""
        params = _parse_combat_params(
            crit={'rate': 0.25, 'multiplier': 1.8},
            hit_dodge={'hit_rate': 0.9, 'dodge_rate': 0.05},
            skills={'attacker': 'rock', 'defender': 'scissors'},
            cooldown={'sec': 15, 'last_ts': 500},
            kwargs={},
        )
        assert params['crit_rate'] == 0.25
        assert params['crit_mult'] == 1.8
        assert params['hit_rate'] == 0.9
        assert params['dodge_rate'] == 0.05
        assert params['attacker_skill'] == 'rock'
        assert params['defender_skill'] == 'scissors'
        assert params['cooldown_sec'] == 15
        assert params['last_attack_ts'] == 500


# =============================================================================
# 辅助函数测试（长函数拆分回归）
# =============================================================================
class TestHelperFunctions:
    """验证拆分后的辅助函数行为正确（P1 长函数拆分回归）。"""

    def test_calc_base_damage_default_formula(self):
        """默认公式：max(1, atk - def//2)。"""
        assert _calc_base_damage(20, 10, '') == 15
        assert _calc_base_damage(10, 10, '') == 5  # 10 - 5
        assert _calc_base_damage(3, 10, '') == 1  # max(1, 3-5) = 1
        assert _calc_base_damage(0, 0, '') == 1  # max(1, 0) = 1

    def test_calc_base_damage_custom_formula(self):
        """自定义公式生效。"""
        assert _calc_base_damage(10, 3, 'atk*2-def') == 17
        assert _calc_base_damage(10, 3, 'atk + def') == 13
        assert _calc_base_damage(10, 3, 'def * 2') == 6  # defense * 2 = 3 * 2

    def test_normalize_skill_valid(self):
        """合法技能名标准化为小写去空白。"""
        assert _normalize_skill('rock') == 'rock'
        assert _normalize_skill('ROCK') == 'rock'
        assert _normalize_skill('  paper  ') == 'paper'
        assert _normalize_skill('Scissors') == 'scissors'

    def test_normalize_skill_invalid_falls_back_to_rock(self):
        """非法技能名回退为 rock。"""
        assert _normalize_skill('') == 'rock'
        assert _normalize_skill(None) == 'rock'
        assert _normalize_skill('fire') == 'rock'
        assert _normalize_skill('water') == 'rock'

    def test_check_cooldown_in_cooldown(self):
        """冷却中：remain > 0。"""
        # cooldown=10, last_ts=500, now=505 → remain = 10 - 5 = 5
        cd = _check_cooldown(10, 500, 505)
        assert cd['in_cooldown'] is True
        assert cd['remain'] == 5
        assert cd['cooldown'] == 10

    def test_check_cooldown_expired(self):
        """冷却已过：remain <= 0。"""
        # cooldown=10, last_ts=500, now=600 → remain = 10 - 100 = -90
        cd = _check_cooldown(10, 500, 600)
        assert cd['in_cooldown'] is False
        assert cd['remain'] == 0
        assert cd['cooldown'] == 10

    def test_check_cooldown_no_cooldown_config(self):
        """未配置冷却（cooldown=0）：永远不在冷却。"""
        cd = _check_cooldown(0, 500, 501)
        assert cd['in_cooldown'] is False
        assert cd['remain'] == 0
        assert cd['cooldown'] == 0

    def test_check_cooldown_no_last_attack(self):
        """无上次攻击记录（last_ts=0）：不在冷却。"""
        cd = _check_cooldown(10, 0, 1000)
        assert cd['in_cooldown'] is False

    def test_check_cooldown_invalid_inputs(self):
        """非法输入回退为 0，不在冷却。"""
        cd = _check_cooldown('abc', 'xyz', 1000)
        assert cd['in_cooldown'] is False
        assert cd['remain'] == 0
        assert cd['cooldown'] == 0
