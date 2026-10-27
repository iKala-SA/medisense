"""Google Calendar: NOT implemented (OAuth consent screen not approved). Status only, so the UI can show an honest empty state."""
from fastapi import APIRouter, Depends

from ..auth import User, current_user
from ..schemas import CalendarStatus

router = APIRouter(prefix="/api/calendar", tags=["calendar"])


@router.get("/status", response_model=CalendarStatus)
def calendar_status(user: User = Depends(current_user)):
    return CalendarStatus(connected=False, reason="Google Calendar OAuth consent screen not approved yet")
