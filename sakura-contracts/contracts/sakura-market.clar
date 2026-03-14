;; SakuraBeta - AI Agent Prediction Market
;; Handles USDCx bets and automatic payouts on Stacks
;; Version: 1.0 

;; --- Constants -----------------------------------
(define-constant CONTRACT-OWNER tx-sender)
(define-constant ERR-MARKET-CLOSED (err u100))
(define-constant ERR-MARKET-NOT-FOUND (err u101))
(define-constant ERR-ALREADY-CLAIMED (err u102))
(define-constant ERR-UNAUTHORIZED (err u103))
(define-constant ERR-WRONG-SIDE (err u104))
(define-constant ERR-NOT-RESOLVED (err u105))

;; Status codes (uint - cheaper than strings)
;; 0 = open, 1 = closed, 2 = resolved
(define-constant STATUS-OPEN u0)
(define-constant STATUS-CLOSED u1)
(define-constant STATUS-RESOLVED u2)

;; 5% creator fee on total pool when agent is correct
(define-constant CREATOR-FEE-BPS u500)
(define-constant BPS-DENOMINATOR u10000)

;; --- Data Storage -------------------------------

(define-map markets
  { market-id: uint }
  {
    agent-id: uint,
    asset: (string-ascii 10),          ;; e.g. "BTC-USD"
    direction: (string-ascii 4),       ;; "up" or "down"
    entry-price: uint,                 ;; price * 10^8
    prediction-hash: (buff 32),        ;; sha256 of prediction -- tamper-proof
    target-block: uint,                ;; Stacks block height for resolution
    status: uint,                      ;; 0=open 1=closed 2=resolved
    agree-pool: uint,                  ;; total USDCx on agree side (6 decimals)
    disagree-pool: uint,               ;; total USDCx on disagree side (6 decimals)
    outcome: (optional bool),          ;; true=agent correct false=agent wrong
    creator: principal                 ;; agent creator -- receives 5% fee on correct prediction
  }
)

;; nonce in key prevents overwrite bug -- each bet is a unique record
(define-map bets
  { market-id: uint, bettor: principal, nonce: uint }
  {
    position: bool,    ;; true=agree false=disagree
    amount: uint,      ;; USDCx amount (6 decimals)
    claimed: bool
  }
)

;; Track bet count per user per market -- used to generate nonce
(define-map bet-count
  { market-id: uint, bettor: principal }
  { count: uint }
)

(define-data-var market-count uint u0)

;; -- Public Functions ------------------------------------------

;; Create a new market -- called by backend when agent generates prediction
(define-public (create-market
  (agent-id uint)
  (asset (string-ascii 10))
  (direction (string-ascii 4))
  (entry-price uint)
  (prediction-hash (buff 32))
  (target-block uint)
)
  (let ((market-id (+ (var-get market-count) u1)))
    (asserts! (is-eq tx-sender CONTRACT-OWNER) ERR-UNAUTHORIZED)
    (map-set markets { market-id: market-id }
      {
        agent-id: agent-id,
        asset: asset,
        direction: direction,
        entry-price: entry-price,
        prediction-hash: prediction-hash,
        target-block: target-block,
        status: STATUS-OPEN,
        agree-pool: u0,
        disagree-pool: u0,
        outcome: none,
        creator: tx-sender
      }
    )
    (var-set market-count market-id)
    (ok market-id)
  )
)

;; Place a bet -- user bets USDCx for or against the agent
(define-public (place-bet (market-id uint) (position bool) (amount uint))
  (let (
    (market (unwrap! (map-get? markets { market-id: market-id }) ERR-MARKET-NOT-FOUND))
    (current-count (default-to { count: u0 }
      (map-get? bet-count { market-id: market-id, bettor: tx-sender })))
    (nonce (get count current-count))
  )
    ;; Market must be open
    (asserts! (is-eq (get status market) STATUS-OPEN) ERR-MARKET-CLOSED)
    ;; Transfer USDCx from bettor to this contract
    (try! (contract-call? .usdcx transfer amount tx-sender CONTRACT-OWNER none))
    ;; Record bet with nonce -- prevents overwrite
    (map-set bets { market-id: market-id, bettor: tx-sender, nonce: nonce }
      { position: position, amount: amount, claimed: false })
    ;; Increment nonce for next bet
    (map-set bet-count { market-id: market-id, bettor: tx-sender }
      { count: (+ nonce u1) })
    ;; Update pool totals
    (if position
      (map-set markets { market-id: market-id }
        (merge market { agree-pool: (+ (get agree-pool market) amount) }))
      (map-set markets { market-id: market-id }
        (merge market { disagree-pool: (+ (get disagree-pool market) amount) }))
    )
    (ok nonce)
  )
)

;; Close betting -- called by backend 60s before target time
(define-public (close-market (market-id uint))
  (let ((market (unwrap! (map-get? markets { market-id: market-id }) ERR-MARKET-NOT-FOUND)))
    (asserts! (is-eq tx-sender CONTRACT-OWNER) ERR-UNAUTHORIZED)
    (asserts! (is-eq (get status market) STATUS-OPEN) ERR-MARKET-CLOSED)
    (map-set markets { market-id: market-id }
      (merge market { status: STATUS-CLOSED }))
    (ok true)
  )
)

;; Resolve market -- called by backend after Binance price check
;; agent-correct = true if AI prediction was right
(define-public (resolve-market (market-id uint) (agent-correct bool))
  (let (
    (market (unwrap! (map-get? markets { market-id: market-id }) ERR-MARKET-NOT-FOUND))
    (total-pool (+ (get agree-pool market) (get disagree-pool market)))
    (creator-fee (/ (* total-pool CREATOR-FEE-BPS) BPS-DENOMINATOR))
    (creator (get creator market))
  )
    (asserts! (is-eq tx-sender CONTRACT-OWNER) ERR-UNAUTHORIZED)
    (asserts! (is-eq (get status market) STATUS-CLOSED) ERR-MARKET-CLOSED)
    (map-set markets { market-id: market-id }
      (merge market { status: STATUS-RESOLVED, outcome: (some agent-correct) }))
    (if (and agent-correct (> creator-fee u0))
      (try! (contract-call? .usdcx transfer creator-fee CONTRACT-OWNER creator none))
      true
    )
    (ok true)
  )
)

;; Claim payout -- winner calls this after market resolves
(define-public (claim-payout (market-id uint) (nonce uint))
  (let (
    (market (unwrap! (map-get? markets { market-id: market-id }) ERR-MARKET-NOT-FOUND))
    (bet (unwrap! (map-get? bets { market-id: market-id, bettor: tx-sender, nonce: nonce })
      ERR-MARKET-NOT-FOUND))
    (outcome (unwrap! (get outcome market) ERR-NOT-RESOLVED))
    (total-pool (+ (get agree-pool market) (get disagree-pool market)))
    (creator-fee (if outcome (/ (* total-pool CREATOR-FEE-BPS) BPS-DENOMINATOR) u0))
    (distributable (- total-pool creator-fee))
    (winning-pool (if outcome (get agree-pool market) (get disagree-pool market)))
    (payout (/ (* (get amount bet) distributable) winning-pool))
    (winner tx-sender)
  )
    (asserts! (is-eq (get status market) STATUS-RESOLVED) ERR-NOT-RESOLVED)
    (asserts! (is-eq (get position bet) outcome) ERR-WRONG-SIDE)
    (asserts! (not (get claimed bet)) ERR-ALREADY-CLAIMED)
    (map-set bets { market-id: market-id, bettor: tx-sender, nonce: nonce }
      (merge bet { claimed: true }))
    (try! (contract-call? .usdcx transfer payout CONTRACT-OWNER winner none))
    (ok payout)
  )
)

;; --- Read-Only Functions --------------------------------------

(define-read-only (get-market (market-id uint))
  (map-get? markets { market-id: market-id })
)

(define-read-only (get-bet (market-id uint) (bettor principal) (nonce uint))
  (map-get? bets { market-id: market-id, bettor: bettor, nonce: nonce })
)

(define-read-only (get-market-count)
  (var-get market-count)
)

(define-read-only (get-bet-count (market-id uint) (bettor principal))
  (default-to { count: u0 }
    (map-get? bet-count { market-id: market-id, bettor: bettor }))
)
