import pytest
from unittest.mock import AsyncMock, patch, MagicMock
from qqbat_nodes.builtin.http_request import http_request


@pytest.fixture
def mock_httpx():
    """提供预配置的 mock httpx AsyncClient 和 response。

    自动 patch _check_ssrf 和 httpx.AsyncClient，返回 (mock_client, mock_resp)。
    mock_client 和 mock_resp 均已配置 async with 支持。
    测试可按需修改 mock_resp 的属性或 mock_client.stream 的行为。

    使用方式：
        mock_client, mock_resp = mock_httpx
        mock_resp.status_code = 200
        mock_client.stream = MagicMock(return_value=mock_resp)
        # ... 调用 http_request ...
    """
    patches = []

    # Patch _check_ssrf 跳过 SSRF 检查（避免真实 DNS 解析）
    # 返回 3-tuple (ok, error, resolved_ip)，resolved_ip='' 表示不 pin URL
    p1 = patch('qqbat_nodes.builtin.http_request._check_ssrf', return_value=(True, '', ''))
    p1.start()
    patches.append(p1)

    # Patch httpx.AsyncClient
    p2 = patch('qqbat_nodes.builtin.http_request.httpx.AsyncClient')
    mock_cls = p2.start()
    patches.append(p2)

    # 创建 mock client（支持 async with）
    mock_client = MagicMock()
    mock_client.__aenter__ = AsyncMock(return_value=mock_client)
    mock_client.__aexit__ = AsyncMock(return_value=None)
    mock_cls.return_value = mock_client

    # 创建 mock response（支持 async with）
    mock_resp = MagicMock()
    mock_resp.__aenter__ = AsyncMock(return_value=mock_resp)
    mock_resp.__aexit__ = AsyncMock(return_value=None)

    yield mock_client, mock_resp

    for p in patches:
        try:
            p.stop()
        except RuntimeError:
            pass


@pytest.mark.asyncio
async def test_http_request_success(mock_bot, mock_event, mock_httpx):
    """成功请求返回 status/data/error 三字段"""
    mock_client, mock_resp = mock_httpx
    mock_resp.status_code = 200
    mock_resp.charset = 'utf-8'
    mock_resp.headers = {'content-length': '12'}
    mock_resp.raise_for_status = MagicMock()  # 不抛异常
    # aiter_bytes 返回字节块
    async def _aiter_bytes():
        yield b'{"ok": true}'
    mock_resp.aiter_bytes = _aiter_bytes
    mock_client.stream = MagicMock(return_value=mock_resp)

    result = await http_request(mock_bot, mock_event, url='http://example.com', method='GET')

    assert result['status'] == 200
    assert result['data'] == {'ok': True}
    assert result['error'] == ''


@pytest.mark.asyncio
async def test_http_request_failure(mock_bot, mock_event, mock_httpx):
    """网络异常返回 status=0 和 error 字段"""
    import httpx

    mock_client, _ = mock_httpx
    # stream() 抛出 RequestError
    mock_client.stream = MagicMock(side_effect=httpx.RequestError('network error'))

    result = await http_request(mock_bot, mock_event, url='http://example.com')

    assert result['status'] == 0
    assert '网络请求失败' in result['error']
    assert result['data'] is None


@pytest.mark.asyncio
async def test_http_request_empty_response(mock_bot, mock_event, mock_httpx):
    """空响应体返回 data=None"""
    mock_client, mock_resp = mock_httpx
    mock_resp.status_code = 204
    mock_resp.charset = 'utf-8'
    mock_resp.headers = {}
    mock_resp.raise_for_status = MagicMock()
    async def _aiter_bytes():
        return
        yield  # 让生成器为空
    mock_resp.aiter_bytes = _aiter_bytes
    mock_client.stream = MagicMock(return_value=mock_resp)

    result = await http_request(mock_bot, mock_event, url='http://example.com')

    assert result['status'] == 204
    assert result['data'] is None
    assert result['error'] == ''
