from fastapi import APIRouter, Response

from api.deps import CurrentAdmin, SessionDep
from core.version import APP_VERSION
from models.api.software_updates import ServerVersionResponse, SoftwareUpdateResponse
from services.software_update_service import SoftwareUpdateService

router = APIRouter(tags=['software'])


@router.get('/server/version', response_model=ServerVersionResponse)
def get_server_version(response: Response) -> ServerVersionResponse:
    response.headers['Cache-Control'] = 'no-store'
    return ServerVersionResponse(version=APP_VERSION)


@router.get('/admin/updates', response_model=SoftwareUpdateResponse)
def get_software_updates(
    session: SessionDep, _admin: CurrentAdmin, response: Response,
) -> SoftwareUpdateResponse:
    response.headers['Cache-Control'] = 'private, no-store'
    return SoftwareUpdateService(session).status()
