from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.routes import auth, leaderboard, markets, predictions, wallet, agents
from app.core.config import settings

app = FastAPI(title="SakuraBeta API", version="0.1.0")

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.allowed_origins_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Routes
app.include_router(auth.router)
app.include_router(predictions.router)
app.include_router(markets.router)
app.include_router(wallet.router)
app.include_router(leaderboard.router)
app.include_router(agents.router)


@app.get("/health")
def health() -> dict:
    return {"status": "ok"}