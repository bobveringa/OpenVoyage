"""Normalize planning errors, including authentication and request validation."""

from fastapi import HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from fastapi.routing import APIRoute

from models.api.planning_errors import (
    PlanningErrorDetail,
    PlanningErrorResponse,
    PlanningValidationIssue,
)

STATUS_CODES = {
    401: 'AUTHENTICATION_REQUIRED',
    403: 'PLANNING_FORBIDDEN',
    404: 'PLANNING_NOT_FOUND',
    409: 'PLANNING_CONFLICT',
    412: 'ITINERARY_CHANGED',
    422: 'VALIDATION_ERROR',
    428: 'REVISION_REQUIRED',
    429: 'CALCULATION_LIMIT_REACHED',
}
MESSAGES = {
    'LOOKUP_EXPIRED': 'This flight lookup expired. Look up the flight again.',
    'PREVIEW_EXPIRED': 'This route preview expired. Calculate the routes again.',
    'CONNECTION_ALREADY_EXISTS': 'This connection already exists.',
    'CONNECTION_DELETION_REQUIRED': 'Confirm removal of the customized connections to continue.',
}


class PlanningRoute(APIRoute):
    def get_route_handler(self):
        handler = super().get_route_handler()

        async def planning_handler(request: Request):
            try:
                return await handler(request)
            except RequestValidationError as exc:
                detail = PlanningErrorDetail(
                    code='VALIDATION_ERROR',
                    message='Check the highlighted planning inputs.',
                    validation_errors=[
                        PlanningValidationIssue(
                            location=list(item['loc']),
                            message=item['msg'],
                            type=item['type'],
                        )
                        for item in exc.errors()
                    ],
                )
                return JSONResponse(
                    status_code=422,
                    content=PlanningErrorResponse(detail=detail).model_dump(
                        mode='json', by_alias=True
                    ),
                )
            except HTTPException as exc:
                if isinstance(exc.detail, dict):
                    values = dict(exc.detail)
                    code = values.get(
                        'code', STATUS_CODES.get(exc.status_code, 'PLANNING_ERROR')
                    )
                    values.setdefault('code', code)
                    values.setdefault(
                        'message',
                        MESSAGES.get(
                            code, 'The planning request could not be completed.'
                        ),
                    )
                else:
                    message = str(exc.detail)
                    code = (
                        message
                        if message in MESSAGES
                        else STATUS_CODES.get(exc.status_code, 'PLANNING_ERROR')
                    )
                    values = {'code': code, 'message': MESSAGES.get(code, message)}
                detail = PlanningErrorDetail.model_validate(values)
                return JSONResponse(
                    status_code=exc.status_code,
                    headers=exc.headers,
                    content=PlanningErrorResponse(detail=detail).model_dump(
                        mode='json', by_alias=True
                    ),
                )

        return planning_handler


PLANNING_ERROR_RESPONSES = {
    code: {
        'model': PlanningErrorResponse,
        'description': name.replace('_', ' ').capitalize(),
    }
    for code, name in STATUS_CODES.items()
}
