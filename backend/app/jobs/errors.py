from typing import Any


class JobFailure(RuntimeError):
    """An expected job failure with safe, structured diagnostic metadata."""

    def __init__(self, message: str, summary: dict[str, Any]):
        super().__init__(message)
        self.summary = summary
