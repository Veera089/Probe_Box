import asyncio
import allure
import pytest
import aiohttp

@allure.feature("CK12 Flexi")
class TestCK12Flexi(BaseAgentTest):
    # Override the base URL for this test class
    BASE_URL = "https://www.ck12.org/flexi"
    
    @pytest.fixture(autouse=True)
    async def cleanup_sessions(self):
        yield
        # Cleanup any remaining aiohttp sessions after each test
        for task in asyncio.all_tasks():
            if not task.done() and 'aiohttp' in str(task):
                task.cancel()
                try:
                    await task
                except (asyncio.CancelledError, aiohttp.ClientError):
                    pass
    
