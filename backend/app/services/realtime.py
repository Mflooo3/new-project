import asyncio
from collections.abc import AsyncGenerator
from concurrent.futures import Future


class EventBus:
    def __init__(self) -> None:
        self._subscribers: set[asyncio.Queue] = set()
        self._loop: asyncio.AbstractEventLoop | None = None

    async def subscribe(self) -> asyncio.Queue:
        self._loop = asyncio.get_running_loop()
        queue: asyncio.Queue = asyncio.Queue(maxsize=100)
        self._subscribers.add(queue)
        return queue

    def unsubscribe(self, queue: asyncio.Queue) -> None:
        self._subscribers.discard(queue)

    async def publish(self, message: dict) -> None:
        for queue in list(self._subscribers):
            if queue.full():
                try:
                    queue.get_nowait()
                except asyncio.QueueEmpty:
                    pass
            try:
                queue.put_nowait(message)
            except asyncio.QueueFull:
                continue

    def publish_nowait(self, message: dict) -> None:
        try:
            loop = asyncio.get_running_loop()
        except RuntimeError:
            if self._loop and self._loop.is_running():
                future: Future = asyncio.run_coroutine_threadsafe(self.publish(message), self._loop)
                future.add_done_callback(lambda _: None)
            return
        loop.create_task(self.publish(message))

    async def stream(self) -> AsyncGenerator[dict, None]:
        queue = await self.subscribe()
        try:
            while True:
                event = await queue.get()
                yield event
        finally:
            self.unsubscribe(queue)


event_bus = EventBus()
