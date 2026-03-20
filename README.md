# 🌸 SakuraBeta

**AI Agent Prediction Markets on Bitcoin via Stacks**

SakuraBeta is a decentralized prediction market where users bet STX on whether AI trading agents make correct crypto price predictions — settled on Bitcoin via Stacks smart contracts, with prediction data monetized through x402 micropayments.

> Built for the BUIDL Battle #2 Hackathon · Stacks Testnet

---

## What It Does

Users upload Python AI agents that predict BTC/ETH price direction. Other users stake native STX betting for or against each prediction. Markets resolve automatically on-chain. Winners claim payouts directly from the Clarity smart contract. Prediction data is monetized through the x402 protocol — AI agents pay micro-STX per API request.

| Role | Action | Reward |
|------|--------|--------|
| Agent Creator | Upload Python prediction model | Reputation + 5% of winning pool |
| Bettor (For) | Bet STX that agent is correct | Proportional payout if agent wins |
| Bettor (Against) | Bet STX that agent is wrong | Proportional payout if agent loses |
| x402 Consumer | Pay micro-STX per API call | Access to prediction data & agent stats |

---

## Architecture

```
┌─────────────────────────────────────────────────────┐
│                  Next.js Frontend                    │
│   Leather Wallet · Market UI · Leaderboard           │
│   Live on-chain pool data · Claim Payout             │
└──────────┬──────────────────────────┬───────────────┘
           │ HTTP/REST                │ @stacks/connect v8
┌──────────▼────────────┐   ┌────────▼────────────────┐
│   FastAPI Backend      │   │   Stacks Blockchain      │
│                        │   │                          │
│ · Agent upload/sandbox │   │  sakura-market-v5.clar   │
│ · Agent execution      │   │  · create-market()       │
│ · Market management    │   │  · place-bet() [STX]     │
│ · Price resolution     │   │  · close-market()        │
│ · Auth (JWT + wallet)  │   │  · resolve-market()      │
│ · On-chain sync        │   │  · claim-payout()        │
└──────┬────────┬────────┘   └─────────────────────────┘
       │        │
┌──────▼──┐  ┌──▼─────────┐   ┌───────────────────────┐
│Postgres │  │   Redis     │   │  x402 Payment Gateway  │
│         │  │             │   │                        │
│ agents  │  │ task queue  │   │  /api/x402/predictions │
│ markets │  │ leaderboard │   │  /api/x402/agents/:id  │
│ users   │  │ cache       │   │  Pays: STX per request │
└─────────┘  └──────┬──────┘   └───────────────────────┘
                    │
             ┌──────▼──────────────┐
             │   Celery Workers     │
             │                      │
             │ · generate_predictions│
             │ · close_betting      │
             │ · resolve_markets    │
             │ · refresh_leaderboard│
             └──────────────────────┘
```

---

## Tech Stack

| Layer | Technology |
|-------|------------|
| Frontend | Next.js 14, `@stacks/connect` v8, Leather Wallet |
| Backend | FastAPI, Celery, Alembic |
| Database | PostgreSQL, Redis |
| Blockchain | Stacks Testnet, Clarity smart contracts |
| Agent Sandbox | RestrictedPython (no network/FS/OS access) |
| Price Oracle | Binance API |
| Micropayments | x402 protocol (STX per request) |
| Chain Reads | Hiro `call-read` API |

---

## Smart Contract

**Deployed:** `STPGTJ3HGE3VCNX1GGK0VCSQ85DCGSETJNSZN7F6.sakura-market-v5`  
**Network:** Stacks Testnet

Key functions:
- `create-market` — opens a new betting market for an agent prediction
- `place-bet` — stakes STX for or against a prediction
- `close-market` — stops new bets (called by backend at deadline)
- `resolve-market` — settles outcome and distributes creator fee
- `claim-payout` — transfers winnings to bettor's wallet

All funds are held in the contract. STX is safe on-chain regardless of backend state.

---

## Agent Interface

Agents must expose a single `predict` function:

```python
def predict(asset: str, current_price: float, history: list[float]) -> dict:
    # asset: "BTC-USD" or "ETH-USD"
    # history: last 20 candle closes
    return {
        "direction": "up",   # or "down"
        "confidence": 0.72   # 0.5 – 1.0
    }
```

**Sandbox restrictions:** no network, no filesystem, no subprocess, 5s timeout, 50MB memory limit.

---

## Market Lifecycle

```
Every 2 minutes per agent per asset:

1. Celery fetches latest Binance price + 20-candle history
2. Agent executes in sandbox → returns direction + confidence
3. Prediction stored in PostgreSQL
4. create-market() called on-chain → market ID saved to DB
5. Users place bets via Leather wallet
6. close-market() called at betting deadline
7. resolve-market() called with Binance exit price
8. Winners call claim-payout() from frontend → STX sent
9. New market auto-opens → cycle repeats
```

---

## x402 Micropayment API

External AI agents and developers can purchase prediction data pay-per-request — no API keys, no subscriptions.

| Endpoint | Price | Returns |
|----------|-------|---------|
| `GET /api/x402/predictions/latest` | 0.1 STX | Latest predictions with agent data |
| `GET /api/x402/agents/:id/stats` | 0.05 STX | Agent accuracy, history, win rate |

**Flow:**
```
1. Client  →  GET /api/x402/predictions/latest
2. Server  →  HTTP 402 + { payTo, amount: "100000", asset: "STX" }
3. Client  →  Signs STX tx + retries with payment-signature header
4. Server  →  Verifies via facilitator → settles on Stacks
5. Server  →  Returns prediction data JSON
```
