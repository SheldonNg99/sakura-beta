#!/usr/bin/env node
/**
 * Called by stacks_client.py to call close-market or resolve-market on-chain.
 * Usage: node contract_call.js <function_name> <arg1> [arg2]
 * 
 * Functions:
 *   close-market <market_id>
 *   resolve-market <market_id> <agent_correct: true|false>
 * 
 * Prints JSON { txid: "..." } to stdout on success, or exits with code 1 on failure.
 */

const {
  makeContractCall,
  broadcastTransaction,
  uintCV,
  boolCV,
  AnchorMode,
  PostConditionMode,
} = require('@stacks/transactions');
const { STACKS_TESTNET } = require('@stacks/network');

async function main() {
  const [,, functionName, ...args] = process.argv;

  const contractAddress = process.env.STACKS_CONTRACT_ADDRESS;
  const deployerKey = process.env.STACKS_DEPLOYER_KEY;
  const contractName = process.env.STACKS_CONTRACT_NAME || 'sakura-market-v5';

  if (!contractAddress || !deployerKey) {
    console.error('Missing STACKS_CONTRACT_ADDRESS or STACKS_DEPLOYER_KEY');
    process.exit(1);
  }

  if (!functionName) {
    console.error('Usage: node contract_call.js <function_name> <args...>');
    process.exit(1);
  }

  const network = STACKS_TESTNET;

  let functionArgs;

  switch (functionName) {
    case 'close-market':
      functionArgs = [uintCV(parseInt(args[0]))];
      break;

    case 'resolve-market':
      functionArgs = [
        uintCV(parseInt(args[0])),
        boolCV(args[1] === 'true'),
      ];
      break;

    default:
      console.error(`Unknown function: ${functionName}`);
      process.exit(1);
  }

  const txOptions = {
    contractAddress,
    contractName,
    functionName,
    functionArgs,
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

    console.log(JSON.stringify({ txid: result.txid }));
  } catch (err) {
    console.error('Error:', err.message);
    process.exit(1);
  }
}

main();