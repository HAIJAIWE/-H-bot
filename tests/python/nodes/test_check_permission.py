"""check_permission handler 单元测试。

覆盖 super_admin / owner / admin / member / guest 五种角色的权限判定，
以及私聊场景、群聊场景、API 异常、参数缺失等边界条件。

被测源码：qqbat_nodes/builtin/check_permission.py
"""
import pytest

from qqbat_nodes.builtin.check_permission import check_permission, _get_super_admin_ids


# ---------------------------------------------------------------------------
# 辅助 fixture
# ---------------------------------------------------------------------------

class _MockEvent:
    """模拟 NoneBot OneBot v11 event，仅暴露 user_id / group_id 属性。"""

    def __init__(self, user_id=None, group_id=None):
        self.user_id = user_id
        self.group_id = group_id


@pytest.fixture
def super_admin_env(monkeypatch):
    """注入 SUPER_ADMIN_IDS 环境变量，返回 admin id 集合。"""
    admin_ids = {'10086', '10000'}
    monkeypatch.setenv('SUPER_ADMIN_IDS', ','.join(sorted(admin_ids)))
    return admin_ids


@pytest.fixture
def clear_admin_env(monkeypatch):
    """清空 SUPER_ADMIN_IDS 环境变量。"""
    monkeypatch.delenv('SUPER_ADMIN_IDS', raising=False)


# ---------------------------------------------------------------------------
# _get_super_admin_ids
# ---------------------------------------------------------------------------

def test_get_super_admin_ids_parses_env(super_admin_env):
    result = _get_super_admin_ids()
    assert result == super_admin_env


def test_get_super_admin_ids_empty_env(clear_admin_env):
    assert _get_super_admin_ids() == set()


def test_get_super_admin_ids_strips_whitespace(monkeypatch):
    monkeypatch.setenv('SUPER_ADMIN_IDS', '  100  ,  200  ,')
    result = _get_super_admin_ids()
    assert result == {'100', '200'}


# ---------------------------------------------------------------------------
# super_admin 场景
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_check_permission_super_admin_passes_all(mock_bot, super_admin_env):
    """super_admin 应通过任意 role 检查。"""
    event = _MockEvent(user_id='10086', group_id='999')
    for role in ('super_admin', 'owner', 'admin', 'member', 'guest'):
        result = await check_permission(mock_bot, event, role=role)
        assert result['passed'] is True, f'role={role} 应通过'
        assert result['user_role'] == 'super_admin'
        assert result['error'] == ''


@pytest.mark.asyncio
async def test_check_permission_super_admin_in_private_chat(mock_bot, super_admin_env):
    """私聊场景下 super_admin 仍生效。"""
    event = _MockEvent(user_id='10086', group_id=None)
    result = await check_permission(mock_bot, event, role='super_admin')
    assert result['passed'] is True
    assert result['user_role'] == 'super_admin'


@pytest.mark.asyncio
async def test_check_permission_super_admin_id_not_in_list(mock_bot, clear_admin_env):
    """普通用户即使在私聊也不是 super_admin。"""
    event = _MockEvent(user_id='12345', group_id=None)
    result = await check_permission(mock_bot, event, role='super_admin')
    assert result['passed'] is False
    assert result['user_role'] == 'guest'


# ---------------------------------------------------------------------------
# 私聊场景
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_check_permission_private_chat_admin_denied(mock_bot, clear_admin_env):
    """私聊场景下，要求 owner/admin/super_admin 一律拒绝。"""
    event = _MockEvent(user_id='12345', group_id=None)
    for role in ('super_admin', 'owner', 'admin'):
        result = await check_permission(mock_bot, event, role=role)
        assert result['passed'] is False, f'role={role} 应拒绝'
        assert result['user_role'] == 'guest'


@pytest.mark.asyncio
async def test_check_permission_private_chat_member_guest_pass(mock_bot, clear_admin_env):
    """私聊场景下，member/guest 一律放行。"""
    event = _MockEvent(user_id='12345', group_id=None)
    for role in ('member', 'guest'):
        result = await check_permission(mock_bot, event, role=role)
        assert result['passed'] is True, f'role={role} 应通过'
        assert result['user_role'] == 'guest'


# ---------------------------------------------------------------------------
# 群聊场景：通过 bot.call_api 返回角色
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_check_permission_group_owner_passes_owner(mock_bot, clear_admin_env):
    """群主通过 owner 检查。"""
    event = _MockEvent(user_id='12345', group_id='999')
    mock_bot.call_api = _make_call_api({'role': 'owner'})

    result = await check_permission(mock_bot, event, role='owner')
    assert result['passed'] is True
    assert result['user_role'] == 'owner'


@pytest.mark.asyncio
async def test_check_permission_group_admin_passes_admin(mock_bot, clear_admin_env):
    """管理员通过 admin 检查。"""
    event = _MockEvent(user_id='12345', group_id='999')
    mock_bot.call_api = _make_call_api({'role': 'admin'})

    result = await check_permission(mock_bot, event, role='admin')
    assert result['passed'] is True
    assert result['user_role'] == 'admin'


@pytest.mark.asyncio
async def test_check_permission_group_admin_denied_owner(mock_bot, clear_admin_env):
    """管理员不能通过 owner 检查。"""
    event = _MockEvent(user_id='12345', group_id='999')
    mock_bot.call_api = _make_call_api({'role': 'admin'})

    result = await check_permission(mock_bot, event, role='owner')
    assert result['passed'] is False
    assert result['user_role'] == 'admin'


@pytest.mark.asyncio
async def test_check_permission_group_member_denied_admin(mock_bot, clear_admin_env):
    """普通成员不能通过 admin 检查。"""
    event = _MockEvent(user_id='12345', group_id='999')
    mock_bot.call_api = _make_call_api({'role': 'member'})

    result = await check_permission(mock_bot, event, role='admin')
    assert result['passed'] is False
    assert result['user_role'] == 'member'


@pytest.mark.asyncio
async def test_check_permission_group_member_passes_member(mock_bot, clear_admin_env):
    """普通成员通过 member 检查。"""
    event = _MockEvent(user_id='12345', group_id='999')
    mock_bot.call_api = _make_call_api({'role': 'member'})

    result = await check_permission(mock_bot, event, role='member')
    assert result['passed'] is True
    assert result['user_role'] == 'member'


@pytest.mark.asyncio
async def test_check_permission_group_owner_passes_admin(mock_bot, clear_admin_env):
    """群主也通过 admin 检查（层级向下兼容）。"""
    event = _MockEvent(user_id='12345', group_id='999')
    mock_bot.call_api = _make_call_api({'role': 'owner'})

    result = await check_permission(mock_bot, event, role='admin')
    assert result['passed'] is True
    assert result['user_role'] == 'owner'


# ---------------------------------------------------------------------------
# 群聊场景：用户不存在 / API 异常
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_check_permission_user_not_in_group(mock_bot, clear_admin_env):
    """call_api 抛异常（用户不在群）时返回 passed=False 并携带 error。"""
    event = _MockEvent(user_id='12345', group_id='999')
    mock_bot.call_api = _make_call_api(side_effect=RuntimeError('user not in group'))

    result = await check_permission(mock_bot, event, role='admin')
    assert result['passed'] is False
    assert result['user_role'] == ''
    assert 'user not in group' in result['error']


# ---------------------------------------------------------------------------
# 边界：未知 role / 默认参数
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_check_permission_unknown_role(mock_bot, clear_admin_env):
    """未知 role 应被显式拒绝（fail-closed），避免越权放行。"""
    event = _MockEvent(user_id='12345', group_id=None)
    result = await check_permission(mock_bot, event, role='unknown_role_xyz')
    assert result['passed'] is False
    assert result['user_role'] == ''
    assert '未知角色' in result['error']


@pytest.mark.asyncio
async def test_check_permission_default_role_is_admin(mock_bot, clear_admin_env):
    """不传 role 时默认为 admin，私聊场景下应拒绝。"""
    event = _MockEvent(user_id='12345', group_id=None)
    result = await check_permission(mock_bot, event)
    assert result['passed'] is False
    assert result['user_role'] == 'guest'


@pytest.mark.asyncio
async def test_check_permission_role_case_insensitive(mock_bot, clear_admin_env):
    """role 大小写不敏感。"""
    event = _MockEvent(user_id='12345', group_id='999')
    mock_bot.call_api = _make_call_api({'role': 'admin'})

    result = await check_permission(mock_bot, event, role='ADMIN')
    assert result['passed'] is True
    assert result['user_role'] == 'admin'


@pytest.mark.asyncio
async def test_check_permission_role_none_falls_back_to_admin(mock_bot, clear_admin_env):
    """role=None 时回退到 admin，私聊场景下应拒绝。"""
    event = _MockEvent(user_id='12345', group_id=None)
    result = await check_permission(mock_bot, event, role=None)
    assert result['passed'] is False
    assert result['user_role'] == 'guest'


@pytest.mark.asyncio
async def test_check_permission_event_missing_user_id(mock_bot, clear_admin_env):
    """event 无 user_id 时回退到普通群成员逻辑（不会命中 super_admin）。"""
    event = _MockEvent(user_id=None, group_id='999')
    mock_bot.call_api = _make_call_api({'role': 'member'})

    result = await check_permission(mock_bot, event, role='member')
    # call_api 用 user_id=None 调用 → int(None) 会抛 TypeError → 被 catch 后返回 False
    assert result['passed'] is False
    # error 应携带异常信息
    assert result['error'] != ''


# ---------------------------------------------------------------------------
# 辅助函数
# ---------------------------------------------------------------------------

def _make_call_api(return_value=None, side_effect=None):
    """构造一个 async mock call_api 函数。"""
    from unittest.mock import AsyncMock

    mock = AsyncMock()
    if side_effect is not None:
        mock.side_effect = side_effect
    else:
        mock.return_value = return_value
    return mock
