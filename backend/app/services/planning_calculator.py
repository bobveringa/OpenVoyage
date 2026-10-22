"""Bounded provider calls without database access."""

import threading
import time
from collections import OrderedDict
from concurrent.futures import ThreadPoolExecutor

from fastapi import HTTPException

from models.api.planning import ROAD_MODES
from models.database.base import utcnow
from services.planning_geometry import validated_geometry
from services.route_providers.route_provider import (
    RouteProviderError,
    RouteProviderLimitError,
)


class CalculationGate:
    """Bound per-process abuse and coalesce duplicate requests without retaining DB sessions."""

    def __init__(self):
        self.lock = threading.Lock()
        self.active = set()
        self.recent = OrderedDict()

    def enter(self, actor, trip, key):
        now = time.monotonic()
        scope = (actor, trip)
        with self.lock:
            for old in list(self.recent):
                if now - self.recent[old][0] > 60:
                    del self.recent[old]
            entry = self.recent.get(scope, (now, 0))
            if scope in self.active or entry[1] >= 20:
                raise HTTPException(
                    429, 'Calculation busy or limit reached. Try again later.'
                )
            self.active.add(scope)
            self.recent[scope] = (entry[0], entry[1] + 1)
            while len(self.recent) > 10000:
                self.recent.popitem(last=False)

    def leave(self, actor, trip):
        with self.lock:
            self.active.discard((actor, trip))


calculation_gate = CalculationGate()


class RouteCalculator:
    def __init__(self, provider=None):
        self.provider = provider

    def _calculate_one(self, seg, deadline):
        base = {
            'input_hash': seg.input_hash,
            'status': 'FAILED',
            'provider': None,
            'geometry_geojson': None,
            'distance_meters': None,
            'duration_seconds': None,
            'error_code': None,
            'generated_at': utcnow().isoformat(),
        }
        if not self.provider or not self.provider.is_configured():
            return base | {'error_code': 'NOT_CONFIGURED'}
        if not self.provider.supports_travel_mode(seg.intent.travel_mode):
            return base | {'status': 'UNSUPPORTED'}
        try:
            route = self.provider.get_route(
                (seg.start.longitude, seg.start.latitude),
                (seg.end.longitude, seg.end.latitude),
                seg.intent.travel_mode,
                via=(seg.via.longitude, seg.via.latitude) if seg.via else None,
                timeout=min(10, max(0.01, deadline - time.monotonic())),
            )
            geometry = validated_geometry(route.geometry_geojson)
            return base | {
                'status': 'READY',
                'provider': self.provider.name,
                'geometry_geojson': geometry,
                'distance_meters': route.distance_meters,
                'duration_seconds': route.duration_seconds,
                'alternatives': [
                    {
                        'status': 'READY',
                        'geometry_geojson': validated_geometry(item.geometry_geojson),
                        'distance_meters': item.distance_meters,
                        'duration_seconds': item.duration_seconds,
                    }
                    for item in route.alternatives[:2]
                ],
            }
        except RouteProviderLimitError:
            return base | {'error_code': 'ROUTING_LIMIT_REACHED'}
        except TimeoutError:
            return base | {'error_code': 'TIMEOUT'}
        except RouteProviderError, OSError, ValueError:
            return base | {'error_code': 'ROUTE_UNAVAILABLE'}

    def calculate(
        self, segments, retry_failed=False, include_alternatives=False, *, force=False
    ):
        deadline = time.monotonic() + 30
        pending = [
            s
            for s in segments
            if s.intent.travel_mode in ROAD_MODES
            and s.start
            and s.end
            and (
                force
                or s.result is None
                or (retry_failed and s.result['status'] == 'FAILED')
                or (
                    include_alternatives
                    and s.result['status'] == 'READY'
                    and 'alternatives' not in s.result
                )
            )
        ]
        # Submit only two calls at a time; no executor backlog survives the deadline.
        with ThreadPoolExecutor(max_workers=2) as executor:
            for offset in range(0, len(pending), 2):
                if time.monotonic() >= deadline:
                    break
                batch = pending[offset : offset + 2]
                futures = [
                    executor.submit(self._calculate_one, seg, deadline) for seg in batch
                ]
                for seg, future in zip(batch, futures, strict=True):
                    calculated = future.result()
                    if not force and seg.result and seg.result['status'] == 'READY':
                        # Opening the chooser must preserve the saved route selection.
                        options = []
                        if calculated['status'] == 'READY':
                            for item in [
                                calculated,
                                *calculated.get('alternatives', []),
                            ]:
                                if (
                                    item['geometry_geojson']
                                    != seg.result['geometry_geojson']
                                ):
                                    options.append(
                                        {
                                            key: value
                                            for key, value in (
                                                calculated | item
                                            ).items()
                                            if key != 'alternatives'
                                        }
                                    )
                        seg.result = seg.result | {'alternatives': options[:2]}
                    else:
                        seg.result = calculated
