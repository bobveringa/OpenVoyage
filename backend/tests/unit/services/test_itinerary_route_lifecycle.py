from unittest.mock import Mock
from services.planning_service import PlanningService


def test_read_and_empty_calculation_do_not_contact_provider():
    provider = Mock()
    service = PlanningService(Mock(), Mock(), provider)
    service.calculate([])
    provider.get_route.assert_not_called()
