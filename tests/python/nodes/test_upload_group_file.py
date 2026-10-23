"""upload_group_file 节点单元测试 — 上传群文件。

覆盖：
- 正常上传文件
- file_path 为空返回错误
- group_id 为空时回退取当前群
- 非群聊场景返回错误
- 路径校验失败（ValueError）
- 文件不存在
- 文件过大（>100MB）
- file_name 为空时取 basename
- folder_id 可选参数
- API 异常处理
- 返回结构完整性

被测源码：qqbat_nodes/builtin/upload_group_file.py

注：upload_group_file 内部调用 validate_path 与 os.path 系列，
    测试通过 patch 这些函数避免真实文件系统访问。
"""
import pytest
from unittest.mock import AsyncMock, MagicMock, patch

from qqbat_nodes.builtin.upload_group_file import upload_group_file, _MAX_FILE_SIZE


@pytest.fixture
def mock_filesystem():
    """Mock 文件系统操作，模拟文件存在且大小合法。"""
    with patch('qqbat_nodes.builtin.upload_group_file.validate_path') as mock_validate, \
         patch('qqbat_nodes.builtin.upload_group_file.os.path') as mock_path, \
         patch('qqbat_nodes.builtin.upload_group_file.os.getcwd') as mock_getcwd:
        mock_validate.return_value = 'safe/file.txt'
        mock_path.abspath.return_value = '/abs/safe/file.txt'
        mock_path.isfile.return_value = True
        mock_path.getsize.return_value = 1024  # 1KB
        mock_path.basename.return_value = 'file.txt'
        mock_getcwd.return_value = '/project'
        yield {
            'validate': mock_validate,
            'path': mock_path,
            'getcwd': mock_getcwd,
        }


# =============================================================================
# 正常上传
# =============================================================================
class TestUploadSuccess:
    """验证文件上传的正常路径。"""

    @pytest.mark.asyncio
    async def test_upload_with_explicit_group_id(self, mock_bot, mock_event, mock_filesystem):
        """显式传入 group_id 时调用 upload_group_file API。"""
        mock_bot.call_api = AsyncMock(return_value={})

        result = await upload_group_file(
            mock_bot, mock_event, group_id='12345', file_path='file.txt',
        )

        assert result['success'] is True
        assert result['error'] == ''
        mock_bot.call_api.assert_called_once_with(
            'upload_group_file', group_id=12345,
            file='/abs/safe/file.txt', name='file.txt', folder=None,
        )

    @pytest.mark.asyncio
    async def test_upload_fallback_to_event_group(self, mock_bot, mock_event, mock_filesystem):
        """group_id 为空时回退取当前群。"""
        mock_event.group_id = 67890
        mock_bot.call_api = AsyncMock(return_value={})

        result = await upload_group_file(
            mock_bot, mock_event, group_id='', file_path='file.txt',
        )

        assert result['success'] is True
        mock_bot.call_api.assert_called_once_with(
            'upload_group_file', group_id=67890,
            file='/abs/safe/file.txt', name='file.txt', folder=None,
        )

    @pytest.mark.asyncio
    async def test_upload_with_custom_file_name(self, mock_bot, mock_event, mock_filesystem):
        """file_name 显式传入时使用传入值。"""
        mock_bot.call_api = AsyncMock(return_value={})

        result = await upload_group_file(
            mock_bot, mock_event, group_id='1', file_path='file.txt',
            file_name='custom.txt',
        )

        assert result['success'] is True
        mock_bot.call_api.assert_called_once_with(
            'upload_group_file', group_id=1,
            file='/abs/safe/file.txt', name='custom.txt', folder=None,
        )

    @pytest.mark.asyncio
    async def test_upload_with_folder_id(self, mock_bot, mock_event, mock_filesystem):
        """folder_id 传入时调用 API 含 folder。"""
        mock_bot.call_api = AsyncMock(return_value={})

        result = await upload_group_file(
            mock_bot, mock_event, group_id='1', file_path='file.txt',
            folder_id='folder123',
        )

        assert result['success'] is True
        mock_bot.call_api.assert_called_once_with(
            'upload_group_file', group_id=1,
            file='/abs/safe/file.txt', name='file.txt', folder='folder123',
        )


# =============================================================================
# 参数缺失
# =============================================================================
class TestMissingParams:
    """验证参数缺失时的错误处理。"""

    @pytest.mark.asyncio
    async def test_empty_file_path(self, mock_bot, mock_event):
        """file_path 为空时返回错误。"""
        result = await upload_group_file(
            mock_bot, mock_event, group_id='1', file_path='',
        )
        assert result['success'] is False
        assert 'file_path 不能为空' in result['error']
        mock_bot.call_api.assert_not_called()

    @pytest.mark.asyncio
    async def test_no_group_id_no_event_group(self, mock_bot, mock_event):
        """group_id 为空且事件无 group_id 时返回错误。"""
        mock_event.group_id = ''
        result = await upload_group_file(
            mock_bot, mock_event, group_id='', file_path='file.txt',
        )
        assert result['success'] is False
        assert 'group_id 不能为空' in result['error']
        assert '非群聊' in result['error']
        mock_bot.call_api.assert_not_called()


# =============================================================================
# 路径校验
# =============================================================================
class TestPathValidation:
    """验证路径安全校验。"""

    @pytest.mark.asyncio
    async def test_path_traversal_rejected(self, mock_bot, mock_event):
        """路径含 .. 时 validate_path 抛 ValueError，返回非法路径错误。"""
        with patch('qqbat_nodes.builtin.upload_group_file.validate_path',
                   side_effect=ValueError('路径不允许包含 ..')):
            result = await upload_group_file(
                mock_bot, mock_event, group_id='1', file_path='../../../etc/passwd',
            )
        assert result['success'] is False
        assert '非法文件路径' in result['error']
        assert '..' in result['error']

    @pytest.mark.asyncio
    async def test_path_outside_project_rejected(self, mock_bot, mock_event):
        """路径超出项目范围时返回非法路径错误。"""
        with patch('qqbat_nodes.builtin.upload_group_file.validate_path',
                   side_effect=ValueError('路径超出项目范围')):
            result = await upload_group_file(
                mock_bot, mock_event, group_id='1', file_path='/etc/passwd',
            )
        assert result['success'] is False
        assert '非法文件路径' in result['error']
        assert '路径超出项目范围' in result['error']


# =============================================================================
# 文件存在性检查
# =============================================================================
class TestFileExistence:
    """验证文件存在性检查。"""

    @pytest.mark.asyncio
    async def test_file_not_exist(self, mock_bot, mock_event):
        """文件不存在时返回错误。"""
        with patch('qqbat_nodes.builtin.upload_group_file.validate_path',
                   return_value='safe/missing.txt'), \
             patch('qqbat_nodes.builtin.upload_group_file.os.path') as mock_path:
            mock_path.abspath.return_value = '/abs/safe/missing.txt'
            mock_path.isfile.return_value = False

            result = await upload_group_file(
                mock_bot, mock_event, group_id='1', file_path='missing.txt',
            )

        assert result['success'] is False
        assert '文件不存在' in result['error']
        mock_bot.call_api.assert_not_called()


# =============================================================================
# 文件大小检查
# =============================================================================
class TestFileSizeCheck:
    """验证文件大小检查。"""

    @pytest.mark.asyncio
    async def test_file_too_large(self, mock_bot, mock_event):
        """文件超过 100MB 上限时返回错误。"""
        with patch('qqbat_nodes.builtin.upload_group_file.validate_path',
                   return_value='safe/big.txt'), \
             patch('qqbat_nodes.builtin.upload_group_file.os.path') as mock_path:
            mock_path.abspath.return_value = '/abs/safe/big.txt'
            mock_path.isfile.return_value = True
            mock_path.getsize.return_value = _MAX_FILE_SIZE + 1

            result = await upload_group_file(
                mock_bot, mock_event, group_id='1', file_path='big.txt',
            )

        assert result['success'] is False
        assert '文件过大' in result['error']
        assert '100MB' in result['error']

    @pytest.mark.asyncio
    async def test_file_size_exactly_limit(self, mock_bot, mock_event):
        """文件恰好等于上限（100MB）时允许上传。"""
        with patch('qqbat_nodes.builtin.upload_group_file.validate_path',
                   return_value='safe/limit.txt'), \
             patch('qqbat_nodes.builtin.upload_group_file.os.path') as mock_path:
            mock_path.abspath.return_value = '/abs/safe/limit.txt'
            mock_path.isfile.return_value = True
            mock_path.getsize.return_value = _MAX_FILE_SIZE
            mock_path.basename.return_value = 'limit.txt'
            mock_bot.call_api = AsyncMock(return_value={})

            result = await upload_group_file(
                mock_bot, mock_event, group_id='1', file_path='limit.txt',
            )

        assert result['success'] is True

    @pytest.mark.asyncio
    async def test_getsize_oserror(self, mock_bot, mock_event):
        """os.path.getsize 抛 OSError 时返回错误。"""
        with patch('qqbat_nodes.builtin.upload_group_file.validate_path',
                   return_value='safe/err.txt'), \
             patch('qqbat_nodes.builtin.upload_group_file.os.path') as mock_path:
            mock_path.abspath.return_value = '/abs/safe/err.txt'
            mock_path.isfile.return_value = True
            mock_path.getsize.side_effect = OSError('权限拒绝')

            result = await upload_group_file(
                mock_bot, mock_event, group_id='1', file_path='err.txt',
            )

        assert result['success'] is False
        assert '获取文件大小失败' in result['error']
        assert '权限拒绝' in result['error']


# =============================================================================
# API 异常
# =============================================================================
class TestApiException:
    """验证 API 调用异常的处理。"""

    @pytest.mark.asyncio
    async def test_api_raises_exception(self, mock_bot, mock_event, mock_filesystem):
        """API 抛异常时返回错误信息。"""
        mock_bot.call_api = AsyncMock(side_effect=RuntimeError('上传失败'))

        result = await upload_group_file(
            mock_bot, mock_event, group_id='1', file_path='file.txt',
        )

        assert result['success'] is False
        assert '上传失败' in result['error']


# =============================================================================
# 返回结构完整性
# =============================================================================
class TestReturnStructure:
    """验证返回 dict 字段完整性。"""

    @pytest.mark.asyncio
    async def test_return_has_success_and_error(self, mock_bot, mock_event, mock_filesystem):
        """返回 dict 必含 success 与 error 字段。"""
        mock_bot.call_api = AsyncMock(return_value={})

        result = await upload_group_file(
            mock_bot, mock_event, group_id='1', file_path='file.txt',
        )

        assert 'success' in result
        assert 'error' in result

    @pytest.mark.asyncio
    async def test_error_empty_on_success(self, mock_bot, mock_event, mock_filesystem):
        """成功时 error 为空字符串。"""
        mock_bot.call_api = AsyncMock(return_value={})

        result = await upload_group_file(
            mock_bot, mock_event, group_id='1', file_path='file.txt',
        )
        assert result['error'] == ''
