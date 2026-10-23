"""set_member_attr handler 单元测试。

覆盖 card / title / special_title / admin 四种模式的正常路径、参数缺失、
权限不足、API 异常、默认值与适配器能力检测等场景。

被测源码：qqbat_nodes/builtin/set_member_attr.py
"""
import pytest
from unittest.mock import AsyncMock

from qqbat_nodes.builtin.set_member_attr import set_member_attr, VALID_MODES


# ---------------------------------------------------------------------------
# 辅助 fixture
# ---------------------------------------------------------------------------

@pytest.fixture(autouse=True)
def _ensure_napcat_adapter(mock_bot, mock_event, monkeypatch):
    """自动配置为 NapCat 适配器（非官方），避免 check_adapter_support 误判。

    MagicMock 会自动创建 ``_openid`` / ``_qqbat_official`` 属性（truthy），
    导致 ``is_official_adapter`` 误判为官方适配器。本 fixture 显式清除这些
    标记并清空环境变量，确保默认走 NapCat 路径。
    需要测试官方适配器分支的用例可随后重新设置标记/环境变量。
    """
    mock_event._openid = None
    mock_bot._qqbat_official = False
    monkeypatch.delenv('QQBAT_OFFICIAL_MODE', raising=False)


@pytest.fixture
def group_event(mock_event):
    """预配置为群聊场景的 mock_event。"""
    mock_event.group_id = 67890
    mock_event.user_id = 12345
    return mock_event


def _make_action_failed(msg: str):
    """构造一个 ActionFailed 异常实例（兼容无 nonebot 环境时的 Exception 回退）。"""
    try:
        from nonebot.adapters.onebot.v11 import ActionFailed
        return ActionFailed(msg)
    except ImportError:
        return Exception(msg)


# ---------------------------------------------------------------------------
# card 模式
# ---------------------------------------------------------------------------

class TestSetMemberAttrCard:
    """名片设置（card 模式）相关测试。"""

    @pytest.mark.asyncio
    async def test_card_success(self, mock_bot, group_event):
        """card 模式正常调用应调用 set_group_card 并返回 success。"""
        mock_bot.call_api = AsyncMock(return_value=None)

        result = await set_member_attr(mock_bot, group_event, mode='card', value='新名片')

        assert result['success'] is True
        assert result['error'] == ''
        mock_bot.call_api.assert_awaited_once_with(
            'set_group_card', group_id=67890, user_id=12345, card='新名片',
        )

    @pytest.mark.asyncio
    async def test_card_uses_explicit_ids(self, mock_bot, group_event):
        """显式传入 user_id / group_id 应优先于 event 中的值。"""
        mock_bot.call_api = AsyncMock(return_value=None)

        await set_member_attr(
            mock_bot, group_event,
            mode='card', user_id='99999', group_id='11111', value='X',
        )

        mock_bot.call_api.assert_awaited_once_with(
            'set_group_card', group_id=11111, user_id=99999, card='X',
        )

    @pytest.mark.asyncio
    async def test_card_empty_value(self, mock_bot, group_event):
        """card 模式允许空名片（用于清除名片）。"""
        mock_bot.call_api = AsyncMock(return_value=None)

        result = await set_member_attr(mock_bot, group_event, mode='card', value='')

        assert result['success'] is True
        mock_bot.call_api.assert_awaited_once_with(
            'set_group_card', group_id=67890, user_id=12345, card='',
        )


# ---------------------------------------------------------------------------
# title / special_title 模式
# ---------------------------------------------------------------------------

class TestSetMemberAttrTitle:
    """头衔设置（title / special_title 模式）相关测试。"""

    @pytest.mark.asyncio
    async def test_title_success(self, mock_bot, group_event):
        """title 模式应调用 set_group_special_title。"""
        mock_bot.call_api = AsyncMock(return_value=None)

        result = await set_member_attr(
            mock_bot, group_event, mode='title', value='大佬', duration=3600,
        )

        assert result['success'] is True
        mock_bot.call_api.assert_awaited_once_with(
            'set_group_special_title',
            group_id=67890, user_id=12345, special_title='大佬', duration=3600,
        )

    @pytest.mark.asyncio
    async def test_special_title_alias_works(self, mock_bot, group_event):
        """special_title 是 title 的别名，应走相同 API。"""
        mock_bot.call_api = AsyncMock(return_value=None)

        result = await set_member_attr(
            mock_bot, group_event, mode='special_title', value='专属头衔',
        )

        assert result['success'] is True
        # duration 默认 -1（永久）
        mock_bot.call_api.assert_awaited_once_with(
            'set_group_special_title',
            group_id=67890, user_id=12345, special_title='专属头衔', duration=-1,
        )

    @pytest.mark.asyncio
    async def test_title_duration_float_conversion(self, mock_bot, group_event):
        """duration 传入浮点数应被 int(float()) 转换为整数。"""
        mock_bot.call_api = AsyncMock(return_value=None)

        await set_member_attr(
            mock_bot, group_event, mode='title', value='头衔', duration=99.9,
        )

        mock_bot.call_api.assert_awaited_once_with(
            'set_group_special_title',
            group_id=67890, user_id=12345, special_title='头衔', duration=99,
        )


# ---------------------------------------------------------------------------
# admin 模式
# ---------------------------------------------------------------------------

class TestSetMemberAttrAdmin:
    """管理员设置（admin 模式）相关测试。"""

    @pytest.mark.asyncio
    async def test_admin_empty_value_defaults_true(self, mock_bot, group_event):
        """admin 模式 value 为空时默认设为管理员（enable=True）。"""
        mock_bot.call_api = AsyncMock(return_value=None)

        result = await set_member_attr(mock_bot, group_event, mode='admin', value='')

        assert result['success'] is True
        mock_bot.call_api.assert_awaited_once_with(
            'set_group_admin', group_id=67890, user_id=12345, enable=True,
        )

    @pytest.mark.asyncio
    async def test_admin_value_true(self, mock_bot, group_event):
        """admin 模式 value='true' 应设 enable=True。"""
        mock_bot.call_api = AsyncMock(return_value=None)

        await set_member_attr(mock_bot, group_event, mode='admin', value='true')

        mock_bot.call_api.assert_awaited_once_with(
            'set_group_admin', group_id=67890, user_id=12345, enable=True,
        )

    @pytest.mark.asyncio
    async def test_admin_value_false(self, mock_bot, group_event):
        """admin 模式 value='false' 应设 enable=False（取消管理员）。"""
        mock_bot.call_api = AsyncMock(return_value=None)

        await set_member_attr(mock_bot, group_event, mode='admin', value='false')

        mock_bot.call_api.assert_awaited_once_with(
            'set_group_admin', group_id=67890, user_id=12345, enable=False,
        )

    @pytest.mark.asyncio
    async def test_admin_value_yes_no_aliases(self, mock_bot, group_event):
        """admin 模式 value='1'/'yes' 视为 True，其他视为 False。"""
        mock_bot.call_api = AsyncMock(return_value=None)

        # '1' → True
        await set_member_attr(mock_bot, group_event, mode='admin', value='1')
        mock_bot.call_api.assert_awaited_with(
            'set_group_admin', group_id=67890, user_id=12345, enable=True,
        )

        # 'yes' → True
        await set_member_attr(mock_bot, group_event, mode='admin', value='yes')
        mock_bot.call_api.assert_awaited_with(
            'set_group_admin', group_id=67890, user_id=12345, enable=True,
        )

        # '0' → False
        await set_member_attr(mock_bot, group_event, mode='admin', value='0')
        mock_bot.call_api.assert_awaited_with(
            'set_group_admin', group_id=67890, user_id=12345, enable=False,
        )


# ---------------------------------------------------------------------------
# 参数校验与缺失
# ---------------------------------------------------------------------------

class TestSetMemberAttrValidation:
    """参数校验与缺失场景测试。"""

    @pytest.mark.asyncio
    async def test_invalid_mode_rejected(self, mock_bot, group_event):
        """未知 mode 应被拒绝并提示合法值。"""
        result = await set_member_attr(mock_bot, group_event, mode='unknown_mode')

        assert result['success'] is False
        assert 'mode' in result['error']
        assert 'unknown_mode' in result['error']
        mock_bot.call_api.assert_not_called()

    @pytest.mark.asyncio
    async def test_missing_group_id_private_chat(self, mock_bot, mock_event):
        """私聊场景（无 group_id）应拒绝执行群操作。"""
        mock_event.group_id = None
        mock_event.user_id = 12345
        mock_bot.call_api = AsyncMock()

        result = await set_member_attr(mock_bot, mock_event, mode='card', value='X')

        assert result['success'] is False
        assert '私聊' in result['error']
        mock_bot.call_api.assert_not_called()

    @pytest.mark.asyncio
    async def test_missing_user_id(self, mock_bot, mock_event):
        """群聊场景下 user_id 缺失应返回错误。"""
        mock_event.group_id = 67890
        mock_event.user_id = None
        mock_bot.call_api = AsyncMock()

        result = await set_member_attr(mock_bot, mock_event, mode='card', value='X')

        assert result['success'] is False
        assert 'user_id' in result['error']
        mock_bot.call_api.assert_not_called()

    @pytest.mark.asyncio
    async def test_ids_fallback_from_event(self, mock_bot, mock_event):
        """user_id / group_id 为空时应从 event 回退获取。"""
        mock_event.group_id = 67890
        mock_event.user_id = 12345
        mock_bot.call_api = AsyncMock(return_value=None)

        await set_member_attr(mock_bot, mock_event, mode='card', value='名片')

        mock_bot.call_api.assert_awaited_once_with(
            'set_group_card', group_id=67890, user_id=12345, card='名片',
        )


# ---------------------------------------------------------------------------
# 异常处理
# ---------------------------------------------------------------------------

class TestSetMemberAttrErrors:
    """异常处理与权限不足场景测试。"""

    @pytest.mark.asyncio
    async def test_action_failed_permission_denied(self, mock_bot, group_event):
        """ActionFailed 含 1300 时应返回权限不足友好提示。"""
        mock_bot.call_api = AsyncMock(side_effect=_make_action_failed('retcode=1300 权限不足'))

        result = await set_member_attr(mock_bot, group_event, mode='card', value='X')

        assert result['success'] is False
        assert '权限不足' in result['error']

    @pytest.mark.asyncio
    async def test_action_failed_keyword_permission(self, mock_bot, group_event):
        """ActionFailed 含 '权限' 关键字也应返回权限不足提示。"""
        mock_bot.call_api = AsyncMock(side_effect=_make_action_failed('权限不足'))

        result = await set_member_attr(mock_bot, group_event, mode='card', value='X')

        assert result['success'] is False
        assert '权限不足' in result['error']

    @pytest.mark.asyncio
    async def test_action_failed_other_error(self, mock_bot, group_event):
        """ActionFailed 不含权限关键字时应返回原始错误信息。"""
        mock_bot.call_api = AsyncMock(side_effect=_make_action_failed('用户不存在'))

        result = await set_member_attr(mock_bot, group_event, mode='card', value='X')

        assert result['success'] is False
        assert '用户不存在' in result['error']

    @pytest.mark.asyncio
    async def test_general_exception_caught(self, mock_bot, group_event):
        """普通异常应被捕获并返回 error 字符串。"""
        mock_bot.call_api = AsyncMock(side_effect=RuntimeError('网络错误'))

        result = await set_member_attr(mock_bot, group_event, mode='card', value='X')

        assert result['success'] is False
        assert '网络错误' in result['error']


# ---------------------------------------------------------------------------
# 适配器能力检测
# ---------------------------------------------------------------------------

class TestSetMemberAttrAdapter:
    """官方适配器能力检测相关测试。"""

    @pytest.mark.asyncio
    async def test_official_adapter_unsupported(self, mock_bot, group_event, monkeypatch):
        """QQ 官方适配器下应直接返回不支持错误，不调用 API。"""
        monkeypatch.setenv('QQBAT_OFFICIAL_MODE', '1')
        mock_bot.call_api = AsyncMock()

        result = await set_member_attr(mock_bot, group_event, mode='card', value='X')

        assert result['success'] is False
        assert '不支持' in result['error']
        mock_bot.call_api.assert_not_called()

    @pytest.mark.asyncio
    async def test_valid_modes_constant(self):
        """VALID_MODES 应包含 card / title / admin / special_title 四种。"""
        assert VALID_MODES == {'card', 'title', 'admin', 'special_title'}
