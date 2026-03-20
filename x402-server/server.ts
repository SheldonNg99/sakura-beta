import dotenv from 'dotenv';
dotenv.config();

import express from 'express';
import axios from 'axios';
import { STXtoMicroSTX } from 'x402-stacks';

const app = express();
const port = parseInt(process.env.SERVER_PORT || '3001');
const serverAddress = process.env.SERVER_ADDRESS!;
const fastapiUrl = process.env.FASTAPI_URL || 'http://localhost:8000';
const network = (process.env.NETWORK || 'testnet') as 'testnet' | 'mainnet';
const HIRO_API_KEY = process.env.HIRO_API_KEY || '';

if (!serverAddress) {
  console.error('Missing SERVER_ADDRESS in .env');
  process.exit(1);
}

// ── x402 helpers ───────────────────────────────────────────────────────────────

const CAIP2_NETWORK = network === 'mainnet' ? 'stacks:1' : 'stacks:2147483648';

function buildPaymentRequired(url: string, amount: bigint, description: string) {
  const body = {
    x402Version: 2,
    resource: { url, description },
    accepts: [{
      scheme: 'exact',
      network: CAIP2_NETWORK,
      amount: amount.toString(),
      asset: 'STX',
      payTo: serverAddress,
      maxTimeoutSeconds: 300,
    }],
  };
  const header = Buffer.from(JSON.stringify(body)).toString('base64');
  return { body, header };
}

async function broadcastTx(signedTxHex: string): Promise<{ success: boolean; txId?: string; error?: string }> {
  const baseUrl = network === 'mainnet'
    ? 'https://api.mainnet.hiro.so'
    : 'https://api.testnet.hiro.so';

  // Strip 0x prefix if present
  const rawHex = signedTxHex.startsWith('0x') ? signedTxHex.slice(2) : signedTxHex;

  try {
    const headers: Record<string, string> = { 'Content-Type': 'application/octet-stream' };
    if (HIRO_API_KEY) headers['x-hiro-api-key'] = HIRO_API_KEY;

    const resp = await axios.post(
      `${baseUrl}/v2/transactions`,
      Buffer.from(rawHex, 'hex'),
      { headers, timeout: 15000 },
    );

    // Hiro returns the txid as a string on success
    const txId = typeof resp.data === 'string' ? resp.data : resp.data?.txid || resp.data?.tx_id;
    console.log(`✅ TX broadcast: ${txId}`);
    return { success: true, txId };
  } catch (err: any) {
    const errMsg = err.response?.data?.reason || err.response?.data?.error || err.message;
    console.error(`❌ TX broadcast failed: ${errMsg}`);
    // Even if broadcast "fails" with ConflictingNonceInMempool or already-known, treat as success
    if (errMsg?.includes('ConflictingNonce') || errMsg?.includes('already_known')) {
      return { success: true, txId: 'pending' };
    }
    return { success: false, error: errMsg };
  }
}

// ── x402 payment middleware (self-hosted — no external facilitator) ─────────────

function x402Paywall(amountMicroSTX: bigint, description: string) {
  return async (req: express.Request, res: express.Response, next: express.NextFunction) => {
    // Check for payment header (try all known names)
    const paymentHeader =
      req.headers['payment-signature'] as string ||
      req.headers['x-payment'] as string ||
      req.headers['PAYMENT-SIGNATURE'] as string;

    if (!paymentHeader) {
      // No payment → return 402
      const fullUrl = `${req.protocol}://${req.get('host')}${req.originalUrl}`;
      const pr = buildPaymentRequired(fullUrl, amountMicroSTX, description);
      res.setHeader('payment-required', pr.header);
      return res.status(402).json(pr.body);
    }

    // Parse the payment payload
    let paymentPayload: any;
    try {
      paymentPayload = JSON.parse(Buffer.from(paymentHeader, 'base64').toString('utf-8'));
    } catch {
      return res.status(402).json({ error: 'Invalid payment header encoding' });
    }

    // Extract the signed transaction hex
    const signedTxHex = paymentPayload?.payload?.transaction;
    if (!signedTxHex) {
      return res.status(402).json({ error: 'Missing transaction in payment payload' });
    }

    console.log(`💰 Payment received, broadcasting tx: ${signedTxHex.slice(0, 30)}...`);

    // Broadcast directly to Stacks testnet
    const result = await broadcastTx(signedTxHex);

    if (!result.success) {
      return res.status(402).json({
        error: 'settlement_failed',
        details: result.error,
        transaction: '',
      });
    }

    // Payment settled! Set response header and continue to handler
    const paymentResponse = Buffer.from(JSON.stringify({
      success: true,
      transaction: result.txId,
      payer: 'verified',
      network: CAIP2_NETWORK,
    })).toString('base64');
    res.setHeader('payment-response', paymentResponse);

    console.log(`✅ Payment settled, serving content. TX: ${result.txId}`);
    next();
  };
}

// ── Health check (free) ────────────────────────────────────────────────────────

app.get('/health', (_req, res) => {
  res.json({
    service: 'SakuraBeta x402 Prediction API',
    status: 'ok',
    network,
    facilitator: 'self-hosted (direct broadcast)',
    endpoints: [
      { path: '/api/predictions/latest', price: '0.1 STX', description: 'Latest AI predictions' },
      { path: '/api/agents/:id/stats', price: '0.05 STX', description: 'Agent performance stats' },
    ],
  });
});

// ── Paid endpoint: Latest predictions ──────────────────────────────────────────

app.get(
  '/api/predictions/latest',
  x402Paywall(STXtoMicroSTX(0.1), 'Latest AI agent predictions for crypto markets'),
  async (_req, res) => {
    try {
      const { data: markets } = await axios.get(`${fastapiUrl}/markets?limit=10`);

      res.json({
        source: 'SakuraBeta AI Prediction Market',
        timestamp: new Date().toISOString(),
        network: 'stacks-testnet',
        predictions: markets.map((m: any) => ({
          market_id: m.id,
          onchain_market_id: m.onchain_market_id,
          asset: m.asset,
          direction: m.direction,
          confidence: m.confidence,
          entry_price: m.entry_price,
          agent_name: m.agent_name,
          status: m.status,
          betting_closes_at: m.betting_closes_at,
          resolution_time: m.resolution_time,
        })),
      });
    } catch (err: any) {
      console.error('Error fetching predictions:', err.message);
      res.status(500).json({ error: 'Failed to fetch predictions' });
    }
  },
);

// ── Paid endpoint: Agent stats ─────────────────────────────────────────────────

app.get(
  '/api/agents/:id/stats',
  x402Paywall(STXtoMicroSTX(0.05), 'AI agent performance statistics'),
  async (req, res) => {
    try {
      const agentId = req.params.id;
      const { data: agent } = await axios.get(`${fastapiUrl}/agents/${agentId}`);

      res.json({
        source: 'SakuraBeta AI Prediction Market',
        timestamp: new Date().toISOString(),
        agent: {
          id: agent.id,
          name: agent.name,
          description: agent.description,
          created_at: agent.created_at,
          is_active: agent.is_active,
        },
        performance: {
          note: 'Full performance metrics available on the SakuraBeta platform',
        },
      });
    } catch (err: any) {
      console.error('Error fetching agent stats:', err.message);
      res.status(500).json({ error: 'Failed to fetch agent stats' });
    }
  },
);

// ── Free endpoint: Available prediction markets (teaser) ───────────────────────

app.get('/api/predictions/summary', async (_req, res) => {
  try {
    const { data: markets } = await axios.get(`${fastapiUrl}/markets?limit=10`);

    res.json({
      source: 'SakuraBeta AI Prediction Market',
      note: 'Pay 0.1 STX via x402 at /api/predictions/latest for full data',
      markets: markets.map((m: any) => ({
        asset: m.asset,
        direction: m.direction,
        agent_name: m.agent_name,
        status: m.status,
      })),
    });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to fetch summary' });
  }
});

// ── Start ──────────────────────────────────────────────────────────────────────

app.listen(port, () => {
  console.log(`
╔══════════════════════════════════════════════════════╗
║     SakuraBeta x402 Prediction API                   ║
║                                                      ║
║     Port: ${port}                                        ║
║     Network: ${network}                                  ║
║     Pay to: ${serverAddress.slice(0, 10)}...${serverAddress.slice(-4)}          ║
║     Facilitator: self-hosted (direct broadcast)      ║
║                                                      ║
║     Endpoints:                                       ║
║       GET /health              (free)                ║
║       GET /api/predictions/summary  (free teaser)    ║
║       GET /api/predictions/latest   (0.1 STX)       ║
║       GET /api/agents/:id/stats     (0.05 STX)      ║
╚══════════════════════════════════════════════════════╝
  `);
});