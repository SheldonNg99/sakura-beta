import dotenv from 'dotenv';
dotenv.config();

import axios from 'axios';
import { makeSTXTokenTransfer } from '@stacks/transactions';
import { privateKeyToAccount } from 'x402-stacks';

const SERVER_URL = `http://localhost:${process.env.SERVER_PORT || 3001}`;
const PRIVATE_KEY = process.env.CLIENT_PRIVATE_KEY!;
const NETWORK = (process.env.NETWORK || 'testnet') as 'testnet' | 'mainnet';
const HIRO_API_KEY = process.env.HIRO_API_KEY || '';

if (!PRIVATE_KEY) {
  console.error('Missing CLIENT_PRIVATE_KEY in .env');
  process.exit(1);
}

function getSenderAddress(): string {
  return privateKeyToAccount(PRIVATE_KEY, NETWORK).address;
}

async function fetchNonce(address: string): Promise<bigint> {
  const baseUrl = NETWORK === 'mainnet'
    ? 'https://api.mainnet.hiro.so'
    : 'https://api.testnet.hiro.so';
  const url = `${baseUrl}/v2/accounts/${address}?proof=0`;
  const headers: Record<string, string> = {};
  if (HIRO_API_KEY) headers['x-hiro-api-key'] = HIRO_API_KEY;
  const resp = await fetch(url, { headers });
  if (!resp.ok) throw new Error(`Nonce fetch failed: ${resp.status}`);
  const data = await resp.json() as { nonce: number };
  return BigInt(data.nonce);
}

async function signSTXPayment(recipient: string, amountMicroSTX: bigint): Promise<string> {
  const nonce = await fetchNonce(getSenderAddress());
  const tx = await makeSTXTokenTransfer({
    recipient,
    amount: amountMicroSTX,
    senderKey: PRIVATE_KEY,
    network: NETWORK,
    fee: 2000n,
    nonce,
    memo: 'x402-payment',
  });
  const serialized = tx.serialize();
  if (typeof serialized === 'string') {
    return serialized.startsWith('0x') ? serialized : '0x' + serialized;
  }
  return '0x' + Buffer.from(serialized).toString('hex');
}

async function paidRequest(url: string): Promise<any> {
  // Step 1: Request resource → expect 402
  let response;
  try {
    response = await axios.get(url);
    return { data: response.data, headers: response.headers };
  } catch (err: any) {
    if (err.response?.status !== 402) throw err;
    response = err.response;
  }

  // Step 2: Parse payment requirements
  let payReq: any = null;
  const prHeader = response.headers['payment-required'];
  if (prHeader) {
    try {
      const decoded = JSON.parse(Buffer.from(prHeader, 'base64').toString('utf-8'));
      if (Array.isArray(decoded.accepts) && decoded.accepts[0]?.amount) payReq = decoded.accepts[0];
      else if (decoded.paymentRequirements?.amount) payReq = decoded.paymentRequirements;
      else if (decoded.amount && decoded.payTo) payReq = decoded;
    } catch { /* */ }
  }
  if (!payReq && response.data?.accepts?.[0]?.amount) payReq = response.data.accepts[0];
  if (!payReq) throw new Error('Could not parse payment requirements');

  const amountMicroSTX = BigInt(payReq.amount);
  const recipient = payReq.payTo;
  console.log(`   📝 Payment: ${Number(amountMicroSTX) / 1_000_000} STX → ${recipient.slice(0, 10)}...`);

  // Step 3: Sign STX transfer
  console.log('   🔑 Signing transaction...');
  const signedTxHex = await signSTXPayment(recipient, amountMicroSTX);

  // Step 4: Build x402 payment header
  const paymentPayload = {
    x402Version: 2,
    payload: { transaction: signedTxHex },
    accepted: {
      scheme: payReq.scheme || 'exact',
      network: payReq.network,
      amount: payReq.amount,
      asset: payReq.asset || 'STX',
      payTo: payReq.payTo,
    },
  };
  const encoded = Buffer.from(JSON.stringify(paymentPayload)).toString('base64');

  // Step 5: Retry with payment
  console.log('   📤 Sending payment...');
  const paidResponse = await axios.get(url, {
    headers: {
      'payment-signature': encoded,
      'X-PAYMENT': encoded,
    },
  });

  return { data: paidResponse.data, headers: paidResponse.headers };
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  const senderAddress = getSenderAddress();

  console.log('\n🤖 SakuraBeta x402 Demo Client');
  console.log('━'.repeat(50));
  console.log(`Network: ${NETWORK}`);
  console.log(`Server:  ${SERVER_URL}`);
  console.log(`Wallet:  ${senderAddress}`);
  console.log('━'.repeat(50));

  // ── Free summary ───────────────────────────────────────────────────────────

  console.log('\n📋 Step 1: Fetching free prediction summary...');
  try {
    const summary = await axios.get(`${SERVER_URL}/api/predictions/summary`);
    console.log('✅ Free summary received:');
    console.log(JSON.stringify(summary.data, null, 2));
  } catch (err: any) {
    console.error('❌ Summary failed:', err.message);
  }

  // ── Paid predictions (0.1 STX) ─────────────────────────────────────────────

  console.log('\n💰 Step 2: Fetching PAID predictions (0.1 STX via x402)...');
  console.log('   → GET → HTTP 402 → sign STX tx → retry with payment header');
  try {
    const result = await paidRequest(`${SERVER_URL}/api/predictions/latest`);
    console.log('✅ Paid predictions received!');
    console.log(JSON.stringify(result.data, null, 2));

    const prHeader = result.headers['payment-response'];
    if (prHeader) {
      try {
        const decoded = JSON.parse(Buffer.from(prHeader, 'base64').toString());
        console.log('\n💸 Payment settled on Stacks:');
        console.log(`   TX: ${decoded.transaction}`);
        console.log(`   Network: ${decoded.network}`);
      } catch { /* */ }
    }
  } catch (err: any) {
    if (err.response?.status === 402) {
      console.log('⚠️  Payment failed:', JSON.stringify(err.response.data));
    } else {
      console.error('❌ Failed:', err.message);
    }
  }

  console.log('\n' + '━'.repeat(50));
  console.log('🎉 x402 Demo Complete');
  console.log('   AI agent paid micro-STX for prediction data via HTTP');
  console.log('   No API keys. No subscriptions. Just pay-per-request.');
  console.log('━'.repeat(50));
}

main().catch(console.error);