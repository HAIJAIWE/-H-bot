import pytest
from unittest.mock import AsyncMock, MagicMock


@pytest.fixture
def mock_bot():
    bot = AsyncMock()
    bot.send = AsyncMock()
    return bot


@pytest.fixture
def mock_event():
    return MagicMock()
