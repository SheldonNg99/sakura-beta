#!/usr/bin/env node
/**
 * Called by stacks_client.py to create a market on-chain.
 * Usage: node create_market.js <agent_id> <asset> <direction> <entry_price_uint> <prediction_hash_hex> <target_block>
 * Prints the on-chain market ID to stdout on success, or exits with code 1 on failure.
 */

const {
  makeContractCall,
  broadcastTransaction,
  uintCV,
  stringAsciiCV,
  bufferCV,
  AnchorMode,
  PostConditionMode,
} = require('@stacks/transactions');
const { STACKS_TESTNET } = require('@stacks/network');

async function main() {
  const [,, agentId, asset, direction, entryPrice, predHashHex, targetBlock] = process.argv;

  const contractAddress = process.env.STACKS_CONTRACT_ADDRESS;
  const deployerKey = process.env.STACKS_DEPLOYER_KEY;

  if (!contractAddress || !deployerKey) {
    console.error('Missing STACKS_CONTRACT_ADDRESS or STACKS_DEPLOYER_KEY');
    process.exit(1);
  }

  const network = STACKS_TESTNET;

  const txOptions = {
    contractAddress,
    contractName: 'sakura-market-v3',
    functionName: 'create-market',
    functionArgs: [
      uintCV(parseInt(agentId)),
      stringAsciiCV(asset),
      stringAsciiCV(direction),
      uintCV(parseInt(entryPrice)),
      bufferCV(Buffer.from(predHashHex, 'hex')),
      uintCV(parseInt(targetBlock)),
    ],
    senderKey: deployerKey,
    network,
    anchorMode: AnchorMode.OnChainOnly,
    postConditionMode: PostConditionMode.Allow,
    fee: 10000,
  };

  try {
    const tx = await makeContractCall(txOptions);
    const result = await broadcastTransaction({ transaction: tx, network });

    if (result.error) {
      console.error('Broadcast error:', result.error, result.reason);
      process.exit(1);
    }

    // Wait for confirmation and get market count
    // For now just print the txid — we'll use market-count to get the ID
    console.log(JSON.stringify({ txid: result.txid }));
  } catch (err) {
    console.error('Error:', err.message);
    process.exit(1);
  }
}

main();