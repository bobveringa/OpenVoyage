from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass
from typing import Any, ClassVar

from .definitions import JobKey


@dataclass(frozen=True)
class JobResult:
    summary: dict[str, Any]


class Job(ABC):
    key: ClassVar[JobKey]

    @abstractmethod
    def run(self) -> JobResult:
        """Run one bounded maintenance attempt."""
