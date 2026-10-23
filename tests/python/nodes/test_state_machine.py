"""state_machine 节点单元测试。

覆盖：
- 状态流转正常路径（命中转移、状态切换、终态判定）
- 初始状态逻辑（无当前状态时使用 initial_state / default_state）
- 无匹配转移（保持当前状态，matched=False）
- transitions 解析（JSON 字符串 / dict / 非法 JSON / 格式错误）
- key 校验、scope 隔离、ValueError 异常处理
- 返回结构字段完整性

被测源码：qqbat_nodes/builtin/state_machine.py
"""
import json
from unittest.mock import AsyncMock, patch

import pytest

from qqbat_nodes.builtin.state_machine import state_machine


# 标准转移规则（副本场景示例）
TRANSITIONS_DUNGEON = json.dumps({
    "states": {
        "idle": {"enter": "exploring", "list": "idle"},
        "exploring": {"attack": "battling", "flee": "idle"},
        "battling": {"win": "victory", "lose": "defeat", "flee": "idle"},
        "victory": {},
        "defeat": {},
    },
    "default_state": "idle",
})


# =============================================================================
# 正常状态流转
# =============================================================================
class TestStateTransition:
    """验证状态机的核心流转逻辑。"""

    @pytest.mark.asyncio
    async def test_transition_matched(self, mock_bot, mock_event):
        """命中转移：idle + enter → exploring，matched=True。"""
        load_mock = AsyncMock(return_value="idle")
        save_mock = AsyncMock(return_value=True)
        with patch('qqbat_nodes.builtin.state_machine._load_value', new=load_mock), \
             patch('qqbat_nodes.builtin.state_machine._save_value', new=save_mock):
            result = await state_machine(
                mock_bot, mock_event,
                state_key="dungeon_state",
                action="enter",
                transitions=TRANSITIONS_DUNGEON,
            )
        assert result['old_state'] == "idle"
        assert result['new_state'] == "exploring"
        assert result['action'] == "enter"
        assert result['matched'] is True
        assert result['is_terminal'] is False
        assert result['error'] == ""

    @pytest.mark.asyncio
    async def test_transition_no_match_keeps_state(self, mock_bot, mock_event):
        """无匹配转移：idle + 未知动作 → 保持 idle，matched=False。"""
        load_mock = AsyncMock(return_value="idle")
        save_mock = AsyncMock(return_value=True)
        with patch('qqbat_nodes.builtin.state_machine._load_value', new=load_mock), \
             patch('qqbat_nodes.builtin.state_machine._save_value', new=save_mock):
            result = await state_machine(
                mock_bot, mock_event,
                state_key="dungeon_state",
                action="unknown_action",
                transitions=TRANSITIONS_DUNGEON,
            )
        assert result['old_state'] == "idle"
        assert result['new_state'] == "idle"
        assert result['matched'] is False
        assert result['is_terminal'] is False
        assert result['error'] == ""
        # 无匹配时不应该保存新状态
        save_mock.assert_not_awaited()

    @pytest.mark.asyncio
    async def test_terminal_state_detection(self, mock_bot, mock_event):
        """终态判定：victory 无出转移 → is_terminal=True。"""
        load_mock = AsyncMock(return_value="battling")
        save_mock = AsyncMock(return_value=True)
        with patch('qqbat_nodes.builtin.state_machine._load_value', new=load_mock), \
             patch('qqbat_nodes.builtin.state_machine._save_value', new=save_mock):
            result = await state_machine(
                mock_bot, mock_event,
                state_key="dungeon_state",
                action="win",
                transitions=TRANSITIONS_DUNGEON,
            )
        assert result['new_state'] == "victory"
        assert result['matched'] is True
        assert result['is_terminal'] is True

    @pytest.mark.asyncio
    async def test_non_terminal_state_has_transitions(self, mock_bot, mock_event):
        """非终态：exploring 有出转移 → is_terminal=False。"""
        load_mock = AsyncMock(return_value="idle")
        save_mock = AsyncMock(return_value=True)
        with patch('qqbat_nodes.builtin.state_machine._load_value', new=load_mock), \
             patch('qqbat_nodes.builtin.state_machine._save_value', new=save_mock):
            result = await state_machine(
                mock_bot, mock_event,
                state_key="dungeon_state",
                action="enter",
                transitions=TRANSITIONS_DUNGEON,
            )
        assert result['is_terminal'] is False

    @pytest.mark.asyncio
    async def test_chained_transitions(self, mock_bot, mock_event):
        """链式流转：idle→exploring→battling→victory 全链路。

        每次调用都重新 mock load 返回当前状态。
        """
        states_sequence = ["idle", "exploring", "battling"]
        actions = ["enter", "attack", "win"]
        expected = ["exploring", "battling", "victory"]

        for current, action, expected_new in zip(states_sequence, actions, expected):
            load_mock = AsyncMock(return_value=current)
            save_mock = AsyncMock(return_value=True)
            with patch('qqbat_nodes.builtin.state_machine._load_value', new=load_mock), \
                 patch('qqbat_nodes.builtin.state_machine._save_value', new=save_mock):
                result = await state_machine(
                    mock_bot, mock_event,
                    state_key="dungeon_state",
                    action=action,
                    transitions=TRANSITIONS_DUNGEON,
                )
            assert result['old_state'] == current
            assert result['new_state'] == expected_new
            assert result['matched'] is True


# =============================================================================
# 初始状态逻辑
# =============================================================================
class TestInitialState:
    """验证无当前状态时的初始化逻辑。"""

    @pytest.mark.asyncio
    async def test_uses_initial_state_when_no_current(self, mock_bot, mock_event):
        """无当前状态时使用 initial_state 参数，并保存。"""
        load_mock = AsyncMock(return_value=None)
        save_mock = AsyncMock(return_value=True)
        with patch('qqbat_nodes.builtin.state_machine._load_value', new=load_mock), \
             patch('qqbat_nodes.builtin.state_machine._save_value', new=save_mock):
            result = await state_machine(
                mock_bot, mock_event,
                state_key="state",
                action="enter",
                transitions=TRANSITIONS_DUNGEON,
                initial_state="idle",
            )
        # 首次进入：写入初始状态 idle，然后按 enter 转移到 exploring
        assert result['old_state'] == "idle"
        assert result['new_state'] == "exploring"
        assert result['matched'] is True
        # 第一次 save 写入初始状态
        assert save_mock.await_count >= 1

    @pytest.mark.asyncio
    async def test_uses_default_state_when_no_initial(self, mock_bot, mock_event):
        """无当前状态且无 initial_state 时使用 default_state。"""
        load_mock = AsyncMock(return_value=None)
        save_mock = AsyncMock(return_value=True)
        with patch('qqbat_nodes.builtin.state_machine._load_value', new=load_mock), \
             patch('qqbat_nodes.builtin.state_machine._save_value', new=save_mock):
            result = await state_machine(
                mock_bot, mock_event,
                state_key="state",
                action="enter",
                transitions=TRANSITIONS_DUNGEON,
                initial_state="",
            )
        # default_state="idle"，然后 enter → exploring
        assert result['old_state'] == "idle"
        assert result['new_state'] == "exploring"

    @pytest.mark.asyncio
    async def test_initial_state_overrides_default(self, mock_bot, mock_event):
        """initial_state 优先于 default_state。"""
        transitions = json.dumps({
            "states": {
                "ready": {"start": "running"},
                "running": {},
                "idle": {"start": "running"},
            },
            "default_state": "idle",
        })
        load_mock = AsyncMock(return_value=None)
        save_mock = AsyncMock(return_value=True)
        with patch('qqbat_nodes.builtin.state_machine._load_value', new=load_mock), \
             patch('qqbat_nodes.builtin.state_machine._save_value', new=save_mock):
            result = await state_machine(
                mock_bot, mock_event,
                state_key="state",
                action="start",
                transitions=transitions,
                initial_state="ready",
            )
        # initial_state="ready" 优先，start → running
        assert result['old_state'] == "ready"
        assert result['new_state'] == "running"

    @pytest.mark.asyncio
    async def test_initial_state_save_called(self, mock_bot, mock_event):
        """首次进入时调用 _save_value 写入初始状态。"""
        load_mock = AsyncMock(return_value=None)
        save_mock = AsyncMock(return_value=True)
        with patch('qqbat_nodes.builtin.state_machine._load_value', new=load_mock), \
             patch('qqbat_nodes.builtin.state_machine._save_value', new=save_mock):
            await state_machine(
                mock_bot, mock_event,
                state_key="state",
                action="unknown",  # 无匹配转移
                transitions=TRANSITIONS_DUNGEON,
                initial_state="idle",
            )
        # 即使无匹配转移，首次进入也会写入初始状态
        save_mock.assert_awaited()


# =============================================================================
# transitions 解析
# =============================================================================
class TestTransitionsParsing:
    """验证 transitions 参数的解析与容错。"""

    @pytest.mark.asyncio
    async def test_dict_transitions_accepted(self, mock_bot, mock_event):
        """transitions 直接传 dict 也可接受。"""
        config = {
            "states": {"idle": {"go": "active"}, "active": {}},
            "default_state": "idle",
        }
        load_mock = AsyncMock(return_value="idle")
        save_mock = AsyncMock(return_value=True)
        with patch('qqbat_nodes.builtin.state_machine._load_value', new=load_mock), \
             patch('qqbat_nodes.builtin.state_machine._save_value', new=save_mock):
            result = await state_machine(
                mock_bot, mock_event,
                state_key="state",
                action="go",
                transitions=config,
            )
        assert result['new_state'] == "active"
        assert result['matched'] is True

    @pytest.mark.asyncio
    async def test_invalid_json_returns_error(self, mock_bot, mock_event):
        """非法 JSON 字符串返回解析失败错误。"""
        result = await state_machine(
            mock_bot, mock_event,
            state_key="state",
            action="go",
            transitions="not a json",
        )
        assert result['matched'] is False
        assert result['is_terminal'] is False
        assert "JSON 解析失败" in result['error']

    @pytest.mark.asyncio
    async def test_malformed_json_returns_error(self, mock_bot, mock_event):
        """畸形 JSON（{invalid）返回解析失败错误。"""
        result = await state_machine(
            mock_bot, mock_event,
            state_key="state",
            action="go",
            transitions="{invalid",
        )
        assert result['matched'] is False
        assert "JSON 解析失败" in result['error']

    @pytest.mark.asyncio
    async def test_non_dict_transitions_returns_error(self, mock_bot, mock_event):
        """transitions 解析后非 dict（如 list）返回格式错误。"""
        result = await state_machine(
            mock_bot, mock_event,
            state_key="state",
            action="go",
            transitions='["a", "b"]',
        )
        assert result['matched'] is False
        assert "格式错误" in result['error']

    @pytest.mark.asyncio
    async def test_missing_states_key_uses_empty(self, mock_bot, mock_event):
        """transitions 缺少 states 键时视为空状态表，无匹配转移。"""
        load_mock = AsyncMock(return_value="idle")
        save_mock = AsyncMock(return_value=True)
        with patch('qqbat_nodes.builtin.state_machine._load_value', new=load_mock), \
             patch('qqbat_nodes.builtin.state_machine._save_value', new=save_mock):
            result = await state_machine(
                mock_bot, mock_event,
                state_key="state",
                action="go",
                transitions='{"default_state": "idle"}',
            )
        assert result['matched'] is False
        assert result['error'] == ""

    @pytest.mark.asyncio
    async def test_missing_default_state_uses_initial(self, mock_bot, mock_event):
        """transitions 缺少 default_state 时用 initial_state 兜底。"""
        transitions = json.dumps({
            "states": {"idle": {"go": "active"}, "active": {}},
        })
        load_mock = AsyncMock(return_value=None)
        save_mock = AsyncMock(return_value=True)
        with patch('qqbat_nodes.builtin.state_machine._load_value', new=load_mock), \
             patch('qqbat_nodes.builtin.state_machine._save_value', new=save_mock):
            result = await state_machine(
                mock_bot, mock_event,
                state_key="state",
                action="unknown",
                transitions=transitions,
                initial_state="idle",
            )
        # 无 default_state，用 initial_state="idle"
        assert result['old_state'] == "idle"


# =============================================================================
# key 校验与 scope
# =============================================================================
class TestKeyAndScope:
    """验证 state_key 校验与 scope 隔离。"""

    @pytest.mark.asyncio
    async def test_empty_state_key_returns_error(self, mock_bot, mock_event):
        """state_key 为空返回错误。"""
        result = await state_machine(
            mock_bot, mock_event,
            state_key="",
            action="enter",
            transitions=TRANSITIONS_DUNGEON,
        )
        assert result['matched'] is False
        assert result['error'] == "state_key 为空"

    @pytest.mark.asyncio
    async def test_invalid_scope_defaults_to_user(self, mock_bot, mock_event):
        """非法 scope 回退为 user。"""
        mock_event.user_id = 12345
        load_mock = AsyncMock(return_value="idle")
        save_mock = AsyncMock(return_value=True)
        with patch('qqbat_nodes.builtin.state_machine._load_value', new=load_mock), \
             patch('qqbat_nodes.builtin.state_machine._save_value', new=save_mock):
            result = await state_machine(
                mock_bot, mock_event,
                state_key="state",
                action="enter",
                transitions=TRANSITIONS_DUNGEON,
                scope="invalid_scope",
            )
        assert result['matched'] is True
        # load_mock 被调用时 scope 应为 user（非法回退）
        assert load_mock.call_args.args[1] == "user"

    @pytest.mark.asyncio
    async def test_scope_user_passed_to_load(self, mock_bot, mock_event):
        """scope=user 透传给 _load_value。"""
        mock_event.user_id = 12345
        load_mock = AsyncMock(return_value="idle")
        save_mock = AsyncMock(return_value=True)
        with patch('qqbat_nodes.builtin.state_machine._load_value', new=load_mock), \
             patch('qqbat_nodes.builtin.state_machine._save_value', new=save_mock):
            await state_machine(
                mock_bot, mock_event,
                state_key="state",
                action="enter",
                transitions=TRANSITIONS_DUNGEON,
                scope="user",
            )
        assert load_mock.call_args.args[1] == "user"

    @pytest.mark.asyncio
    async def test_scope_group_passed_to_load(self, mock_bot, mock_event):
        """scope=group 透传给 _load_value。"""
        mock_event.group_id = 67890
        load_mock = AsyncMock(return_value="idle")
        save_mock = AsyncMock(return_value=True)
        with patch('qqbat_nodes.builtin.state_machine._load_value', new=load_mock), \
             patch('qqbat_nodes.builtin.state_machine._save_value', new=save_mock):
            await state_machine(
                mock_bot, mock_event,
                state_key="state",
                action="enter",
                transitions=TRANSITIONS_DUNGEON,
                scope="group",
            )
        assert load_mock.call_args.args[1] == "group"

    @pytest.mark.asyncio
    async def test_scope_global_passed_to_load(self, mock_bot, mock_event):
        """scope=global 透传给 _load_value。"""
        load_mock = AsyncMock(return_value="idle")
        save_mock = AsyncMock(return_value=True)
        with patch('qqbat_nodes.builtin.state_machine._load_value', new=load_mock), \
             patch('qqbat_nodes.builtin.state_machine._save_value', new=save_mock):
            await state_machine(
                mock_bot, mock_event,
                state_key="state",
                action="enter",
                transitions=TRANSITIONS_DUNGEON,
                scope="global",
            )
        assert load_mock.call_args.args[1] == "global"


# =============================================================================
# 异常处理
# =============================================================================
class TestExceptionHandling:
    """验证异常捕获与错误返回。"""

    @pytest.mark.asyncio
    async def test_value_error_from_load_returns_error(self, mock_bot, mock_event):
        """_load_value 抛 ValueError 时返回错误信息。"""
        load_mock = AsyncMock(side_effect=ValueError("scope 非法"))
        with patch('qqbat_nodes.builtin.state_machine._load_value', new=load_mock):
            result = await state_machine(
                mock_bot, mock_event,
                state_key="state",
                action="enter",
                transitions=TRANSITIONS_DUNGEON,
            )
        assert result['matched'] is False
        assert result['is_terminal'] is False
        assert "scope 非法" in result['error']

    @pytest.mark.asyncio
    async def test_value_error_from_save_returns_error(self, mock_bot, mock_event):
        """_save_value 抛 ValueError 时返回错误信息。"""
        load_mock = AsyncMock(return_value="idle")
        save_mock = AsyncMock(side_effect=ValueError("event 缺失"))
        with patch('qqbat_nodes.builtin.state_machine._load_value', new=load_mock), \
             patch('qqbat_nodes.builtin.state_machine._save_value', new=save_mock):
            result = await state_machine(
                mock_bot, mock_event,
                state_key="state",
                action="enter",
                transitions=TRANSITIONS_DUNGEON,
            )
        assert result['matched'] is False
        assert "event 缺失" in result['error']


# =============================================================================
# 返回结构完整性
# =============================================================================
class TestReturnStructure:
    """验证返回 dict 的字段完整性。"""

    @pytest.mark.asyncio
    async def test_return_has_all_required_fields(self, mock_bot, mock_event):
        """返回 dict 必含 old_state/new_state/action/matched/is_terminal/error。"""
        load_mock = AsyncMock(return_value="idle")
        save_mock = AsyncMock(return_value=True)
        with patch('qqbat_nodes.builtin.state_machine._load_value', new=load_mock), \
             patch('qqbat_nodes.builtin.state_machine._save_value', new=save_mock):
            result = await state_machine(
                mock_bot, mock_event,
                state_key="state",
                action="enter",
                transitions=TRANSITIONS_DUNGEON,
            )
        assert set(result.keys()) == {
            'old_state', 'new_state', 'action', 'matched', 'is_terminal', 'error'
        }

    @pytest.mark.asyncio
    async def test_action_echoed_in_return(self, mock_bot, mock_event):
        """返回的 action 字段等于传入的 action 参数。"""
        load_mock = AsyncMock(return_value="idle")
        save_mock = AsyncMock(return_value=True)
        with patch('qqbat_nodes.builtin.state_machine._load_value', new=load_mock), \
             patch('qqbat_nodes.builtin.state_machine._save_value', new=save_mock):
            result = await state_machine(
                mock_bot, mock_event,
                state_key="state",
                action="custom_action",
                transitions=TRANSITIONS_DUNGEON,
            )
        assert result['action'] == "custom_action"
