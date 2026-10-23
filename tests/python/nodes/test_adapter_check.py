"""_adapter_check 模块单元测试 — 适配器能力检测。

覆盖：
- is_official_adapter 的三种检测策略（_openid / _qqbat_official / 环境变量）
- check_adapter_support 已知支持功能（返回 None）
- check_adapter_support 已知不支持功能（返回错误 dict）
- check_adapter_support 未知功能名（返回错误，而非警告）
- check_adapter_support 自定义 return_struct
- 非 NapCat 适配器直接返回 None（跳过检测）

被测源码：qqbat_nodes/builtin/_adapter_check.py
"""
import os
import pytest
from unittest.mock import MagicMock

from qqbat_nodes.builtin._adapter_check import (
    is_official_adapter,
    check_adapter_support,
    _OFFICIAL_FEATURE_SUPPORT,
)


# =============================================================================
# is_official_adapter 检测策略
# =============================================================================
class TestIsOfficialAdapter:
    """验证三种检测策略的优先级和判定逻辑。"""

    def test_event_has_openid_returns_true(self):
        """事件含 _openid 字段时判定为官方适配器。"""
        bot = MagicMock()
        event = MagicMock()
        event._openid = 'some_openid_value'

        assert is_official_adapter(bot, event) is True

    def test_event_openid_none_returns_false_without_other_signals(self):
        """事件 _openid 为 None 且无其他信号时判定为非官方适配器。"""
        bot = MagicMock()
        bot._qqbat_official = False
        event = MagicMock()
        event._openid = None

        # 清理环境变量
        old = os.environ.pop('QQBAT_OFFICIAL_MODE', None)
        try:
            assert is_official_adapter(bot, event) is False
        finally:
            if old is not None:
                os.environ['QQBAT_OFFICIAL_MODE'] = old

    def test_bot_has_official_flag_returns_true(self):
        """bot 含 _qqbat_official=True 时判定为官方适配器。"""
        bot = MagicMock()
        bot._qqbat_official = True
        event = MagicMock()
        event._openid = None

        assert is_official_adapter(bot, event) is True

    def test_env_var_qqbat_official_mode_true(self):
        """环境变量 QQBAT_OFFICIAL_MODE=1 时判定为官方适配器。"""
        bot = MagicMock()
        bot._qqbat_official = False
        event = MagicMock()
        event._openid = None

        old = os.environ.get('QQBAT_OFFICIAL_MODE')
        os.environ['QQBAT_OFFICIAL_MODE'] = '1'
        try:
            assert is_official_adapter(bot, event) is True
        finally:
            if old is None:
                os.environ.pop('QQBAT_OFFICIAL_MODE', None)
            else:
                os.environ['QQBAT_OFFICIAL_MODE'] = old

    def test_env_var_qqbat_official_mode_true_uppercase(self):
        """环境变量 QQBAT_OFFICIAL_MODE=TRUE（大写）时判定为官方适配器。"""
        bot = MagicMock()
        bot._qqbat_official = False
        event = MagicMock()
        event._openid = None

        old = os.environ.get('QQBAT_OFFICIAL_MODE')
        os.environ['QQBAT_OFFICIAL_MODE'] = 'TRUE'
        try:
            assert is_official_adapter(bot, event) is True
        finally:
            if old is None:
                os.environ.pop('QQBAT_OFFICIAL_MODE', None)
            else:
                os.environ['QQBAT_OFFICIAL_MODE'] = old

    def test_env_var_qqbat_official_mode_empty(self):
        """环境变量 QQBAT_OFFICIAL_MODE 为空时判定为非官方适配器。"""
        bot = MagicMock()
        bot._qqbat_official = False
        event = MagicMock()
        event._openid = None

        old = os.environ.get('QQBAT_OFFICIAL_MODE')
        os.environ['QQBAT_OFFICIAL_MODE'] = ''
        try:
            assert is_official_adapter(bot, event) is False
        finally:
            if old is None:
                os.environ.pop('QQBAT_OFFICIAL_MODE', None)
            else:
                os.environ['QQBAT_OFFICIAL_MODE'] = old

    def test_priority_event_openid_over_env_var(self):
        """_openid 优先级高于环境变量。"""
        bot = MagicMock()
        event = MagicMock()
        event._openid = 'openid_from_event'

        assert is_official_adapter(bot, event) is True


# =============================================================================
# check_adapter_support 已知功能
# =============================================================================
class TestCheckAdapterSupportKnown:
    """验证已注册功能的检测逻辑。"""

    def test_supported_feature_returns_none(self):
        """官方适配器下已知支持的功能返回 None（继续执行）。"""
        bot = MagicMock()
        bot._qqbat_official = True
        event = MagicMock()
        event._openid = None

        # send_message 在支持表中为 True
        result = check_adapter_support(bot, event, 'send_message')
        assert result is None

    def test_unsupported_feature_returns_error(self):
        """官方适配器下已知不支持的功能返回错误 dict。"""
        bot = MagicMock()
        bot._qqbat_official = True
        event = MagicMock()
        event._openid = None

        # group_punish 在支持表中为 False
        result = check_adapter_support(bot, event, 'group_punish')
        assert result is not None
        assert result['success'] is False
        assert '不支持' in result['error']
        assert 'group_punish' in result['error']

    def test_recall_supported_returns_none(self):
        """recall 现已支持（True），应返回 None。"""
        bot = MagicMock()
        bot._qqbat_official = True
        event = MagicMock()
        event._openid = None

        result = check_adapter_support(bot, event, 'recall')
        assert result is None

    def test_delete_msg_supported_returns_none(self):
        """delete_msg 现已支持（True），应返回 None。"""
        bot = MagicMock()
        bot._qqbat_official = True
        event = MagicMock()
        event._openid = None

        result = check_adapter_support(bot, event, 'delete_msg')
        assert result is None

    def test_set_group_whole_ban_unsupported(self):
        """set_group_whole_ban 在支持表中为 False，应返回错误。"""
        bot = MagicMock()
        bot._qqbat_official = True
        event = MagicMock()
        event._openid = None

        result = check_adapter_support(bot, event, 'set_group_whole_ban')
        assert result is not None
        assert result['success'] is False
        assert 'set_group_whole_ban' in result['error']


# =============================================================================
# check_adapter_support 未知功能名
# =============================================================================
class TestCheckAdapterSupportUnknown:
    """验证未知功能名的检测策略（应返回错误，而非警告）。"""

    def test_unknown_feature_returns_error(self):
        """未知功能名应返回错误 dict（而非 None 或仅警告）。"""
        bot = MagicMock()
        bot._qqbat_official = True
        event = MagicMock()
        event._openid = None

        result = check_adapter_support(bot, event, 'nonexistent_feature_xyz')
        assert result is not None
        assert result['success'] is False
        assert '不支持' in result['error']
        assert 'nonexistent_feature_xyz' in result['error']
        assert '未注册' in result['error']

    def test_unknown_feature_error_mentions_registration(self):
        """未知功能名错误消息应提示注册。"""
        bot = MagicMock()
        bot._qqbat_official = True
        event = MagicMock()
        event._openid = None

        result = check_adapter_support(bot, event, 'unknown_op')
        assert '_OFFICIAL_FEATURE_SUPPORT' in result['error']


# =============================================================================
# check_adapter_support 自定义返回结构
# =============================================================================
class TestCheckAdapterSupportReturnStruct:
    """验证自定义 return_struct 参数的合并逻辑。"""

    def test_custom_return_struct_preserves_extra_fields(self):
        """自定义 return_struct 应保留调用方约定字段。"""
        bot = MagicMock()
        bot._qqbat_official = True
        event = MagicMock()
        event._openid = None

        custom_struct = {
            "success": True,
            "error": "",
            "members": [],
            "lastrowid": 0
        }
        result = check_adapter_support(
            bot, event, 'get_group_member_list',
            return_struct=custom_struct
        )
        assert result is not None
        assert result['success'] is False
        assert '不支持' in result['error']
        # 自定义字段应被保留
        assert result['members'] == []
        assert result['lastrowid'] == 0

    def test_custom_return_struct_does_not_mutate_original(self):
        """check_adapter_support 不应修改调用方传入的原始 dict。"""
        bot = MagicMock()
        bot._qqbat_official = True
        event = MagicMock()
        event._openid = None

        original = {"success": True, "error": "", "count": 10}
        check_adapter_support(
            bot, event, 'group_punish',
            return_struct=original
        )
        # 原始 dict 不应被修改
        assert original['success'] is True
        assert original['error'] == ''
        assert original['count'] == 10


# =============================================================================
# check_adapter_support 非官方适配器
# =============================================================================
class TestCheckAdapterSupportNonOfficial:
    """验证非官方适配器（NapCat）的检测逻辑。"""

    def test_napcat_adapter_returns_none(self):
        """NapCat 适配器（无 _openid，无 _qqbat_official）应返回 None。"""
        bot = MagicMock()
        bot._qqbat_official = False
        event = MagicMock()
        event._openid = None

        # 清理环境变量
        old = os.environ.pop('QQBAT_OFFICIAL_MODE', None)
        try:
            # 即使是不支持的功能，NapCat 也应返回 None（不检测）
            result = check_adapter_support(bot, event, 'group_punish')
            assert result is None
        finally:
            if old is not None:
                os.environ['QQBAT_OFFICIAL_MODE'] = old

    def test_napcat_adapter_unknown_feature_returns_none(self):
        """NapCat 适配器下未知功能名也返回 None（不检测）。"""
        bot = MagicMock()
        bot._qqbat_official = False
        event = MagicMock()
        event._openid = None

        old = os.environ.pop('QQBAT_OFFICIAL_MODE', None)
        try:
            result = check_adapter_support(bot, event, 'unknown_feature')
            assert result is None
        finally:
            if old is not None:
                os.environ['QQBAT_OFFICIAL_MODE'] = old


# =============================================================================
# _OFFICIAL_FEATURE_SUPPORT 表完整性
# =============================================================================
class TestFeatureSupportTable:
    """验证支持表的完整性（防止遗漏常用群管 action）。"""

    def test_recall_is_supported(self):
        """recall 应为 True（OneBotTranslator 已桥接 delete_msg）。"""
        assert _OFFICIAL_FEATURE_SUPPORT['recall'] is True

    def test_delete_msg_is_supported(self):
        """delete_msg 应为 True。"""
        assert _OFFICIAL_FEATURE_SUPPORT['delete_msg'] is True

    def test_set_group_whole_ban_exists(self):
        """set_group_whole_ban 应在支持表中注册。"""
        assert 'set_group_whole_ban' in _OFFICIAL_FEATURE_SUPPORT
        assert _OFFICIAL_FEATURE_SUPPORT['set_group_whole_ban'] is False

    def test_send_keyboard_msg_exists(self):
        """send_keyboard_msg 应在支持表中注册。"""
        assert 'send_keyboard_msg' in _OFFICIAL_FEATURE_SUPPORT
        assert _OFFICIAL_FEATURE_SUPPORT['send_keyboard_msg'] is True

    def test_all_group_admin_ops_unsupported(self):
        """群管理操作（踢人/禁言/头衔等）应全部为 False。"""
        unsupported_ops = [
            'group_punish', 'set_group_ban', 'set_group_kick',
            'set_member_attr', 'set_group_card', 'set_group_special_title',
            'set_group_admin', 'essence_msg', 'set_essence_msg',
            'set_group_leave', 'get_group_member_list', 'get_group_member_info',
            'get_group_info', 'get_stranger_info',
        ]
        for op in unsupported_ops:
            assert op in _OFFICIAL_FEATURE_SUPPORT, f"{op} 未在支持表中注册"
            assert _OFFICIAL_FEATURE_SUPPORT[op] is False, f"{op} 应为 False"

    def test_all_send_ops_supported(self):
        """发送消息操作应全部为 True。"""
        supported_ops = [
            'send_message', 'send_private_msg', 'send_group_msg', 'send_msg',
        ]
        for op in supported_ops:
            assert op in _OFFICIAL_FEATURE_SUPPORT, f"{op} 未在支持表中注册"
            assert _OFFICIAL_FEATURE_SUPPORT[op] is True, f"{op} 应为 True"
