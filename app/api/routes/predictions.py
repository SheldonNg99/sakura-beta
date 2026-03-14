from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.schemas.prediction import PredictionResponse
from app.services import prediction_service

router = APIRouter(prefix="/predictions", tags=["predictions"])


@router.get("", response_model=list[PredictionResponse])
def list_predictions(
    asset: str | None = Query(default=None),
    limit: int = Query(default=10, le=50),
    db: Session = Depends(get_db),
) -> list[PredictionResponse]:
    return prediction_service.get_latest_predictions(db, limit=limit, asset=asset)


@router.get("/{prediction_id}", response_model=PredictionResponse)
def get_prediction(
    prediction_id: int,
    db: Session = Depends(get_db),
) -> PredictionResponse:
    prediction = prediction_service.get_prediction_by_id(prediction_id, db)
    if not prediction:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Prediction not found",
        )
    return prediction