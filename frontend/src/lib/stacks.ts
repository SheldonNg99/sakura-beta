export const SAKURA_CONTRACT_ADDRESS =
  process.env.NEXT_PUBLIC_STACKS_CONTRACT_ADDRESS ||
  'STPGTJ3HGE3VCNX1GGK0VCSQ85DCGSETJNSZN7F6'

export const SAKURA_CONTRACT_NAME = 'sakura-market-v5'

const STACKS_API = 'https://api.testnet.hiro.so'

function uintToHex(n: number): string {
  return '0x01' + n.toString(16).padStart(32, '0')
}

// ── Read on-chain market data ──────────────────────────────────────────────────

export interface OnChainMarket {
  agreePool: number
  disagreePool: number
  status: number
}

export async function getMarketOnChain(onchainMarketId: number): Promise<OnChainMarket | null> {
  try {
    const { cvToJSON, hexToCV } = await import('@stacks/transactions')

    const resp = await fetch(
      `${STACKS_API}/v2/contracts/call-read/${SAKURA_CONTRACT_ADDRESS}/${SAKURA_CONTRACT_NAME}/get-market`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sender: SAKURA_CONTRACT_ADDRESS,
          arguments: [uintToHex(onchainMarketId)],
        }),
      },
    )

    const data = await resp.json()
    if (!data.okay || !data.result) return null

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const parsed = cvToJSON(hexToCV(data.result as any))

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let val: any = parsed
    while (val && val.value && typeof val.value === 'object' && !val.value['agree-pool']) {
      val = val.value
    }
    if (val?.value?.['agree-pool']) val = val.value

    if (!val || !val['agree-pool']) return null

    return {
      agreePool: parseInt(val['agree-pool'].value ?? '0'),
      disagreePool: parseInt(val['disagree-pool'].value ?? '0'),
      status: parseInt(val['status'].value ?? '0'),
    }
  } catch (err) {
    console.error('getMarketOnChain error:', err)
    return null
  }
}

// ── Read bet count for a user on a market ──────────────────────────────────────

export async function getBetCountOnChain(
  _onchainMarketId: number,
  _bettorAddress: string,
): Promise<number> {
  return 10
}

// ── Wallet Connect ─────────────────────────────────────────────────────────────

export async function connectWallet(
  onSuccess: (address: string) => void,
  onError?: (err: Error) => void,
) {
  try {
    const { request } = await import('@stacks/connect')
    const response = await request('getAddresses')

    if (!response?.addresses?.length) {
      throw new Error('No addresses returned from wallet')
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const stxAddress = response.addresses.find(
      (a: any) => a.symbol === 'STX' || a.address?.startsWith('S'),
    )
    if (!stxAddress) throw new Error('No STX address found in wallet response')

    const address: string = stxAddress.address
    localStorage.setItem('stacks_address', address)

    const { walletApi } = await import('@/lib/api/wallet')
    await walletApi.connectWallet(address)

    onSuccess(address)
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err))
    localStorage.removeItem('stacks_address')
    onError?.(error)
  }
}

export async function disconnectWallet(onSuccess?: () => void) {
  try {
    const { walletApi } = await import('@/lib/api/wallet')
    await walletApi.disconnectWallet()
  } catch {
    // best-effort
  } finally {
    localStorage.removeItem('stacks_address')
    onSuccess?.()
  }
}

export function getWalletAddress(): string | null {
  if (typeof window === 'undefined') return null
  return localStorage.getItem('stacks_address')
}

export function isWalletConnected(): boolean {
  if (typeof window === 'undefined') return false
  return !!localStorage.getItem('stacks_address')
}

// ── Create Market On-Chain ─────────────────────────────────────────────────────

export async function createMarketOnChain(
  agentId: number,
  asset: string,
  direction: string,
  entryPriceUsd: number,
  predictionId: number,
  _confidence: number,
  onSuccess: (txId: string) => void,
  onCancel: () => void,
) {
  try {
    const { request } = await import('@stacks/connect')
    const { uintCV, stringAsciiCV, bufferCV } = await import('@stacks/transactions')

    const hashArray = new Uint8Array(32).fill(0)
    hashArray[0] = predictionId & 0xff
    hashArray[1] = (predictionId >> 8) & 0xff

    const entryPriceUint = Math.round(entryPriceUsd * 10 ** 8)
    const targetBlock = 999999

    const result = await request('stx_callContract', {
      contract: `${SAKURA_CONTRACT_ADDRESS}.${SAKURA_CONTRACT_NAME}`,
      functionName: 'create-market',
      functionArgs: [
        uintCV(agentId),
        stringAsciiCV(asset.slice(0, 10)),
        stringAsciiCV(direction.slice(0, 4)),
        uintCV(entryPriceUint),
        bufferCV(hashArray),
        uintCV(targetBlock),
      ],
    })

    if (result?.txid) {
      onSuccess(result.txid)
    } else {
      onCancel()
    }
  } catch (err: unknown) {
    const code = (err as { code?: number })?.code
    if (code === -31001 || code === -32000) {
      onCancel()
    } else {
      onCancel()
      console.error('createMarketOnChain error:', err)
    }
  }
}

// ── Place Bet On-Chain ─────────────────────────────────────────────────────────

export async function placeBetOnChain(
  marketId: number,
  position: boolean,
  amountMicroStx: number,
  senderAddress: string,
  onSuccess: (txId: string) => void,
  onCancel: () => void,
) {
  try {
    const { request } = await import('@stacks/connect')
    const { uintCV, boolCV, Pc } = await import('@stacks/transactions')

    const postCondition = Pc.principal(senderAddress).willSendEq(amountMicroStx).ustx()

    const result = await request('stx_callContract', {
      contract: `${SAKURA_CONTRACT_ADDRESS}.${SAKURA_CONTRACT_NAME}`,
      functionName: 'place-bet',
      functionArgs: [
        uintCV(marketId),
        boolCV(position),
        uintCV(amountMicroStx),
      ],
      postConditions: [postCondition],
    })

    if (result?.txid) {
      onSuccess(result.txid)
    } else {
      onCancel()
    }
  } catch (err: unknown) {
    const code = (err as { code?: number })?.code
    if (code === -31001 || code === -32000) {
      onCancel()
    } else {
      onCancel()
      console.error('placeBetOnChain error:', err)
    }
  }
}

// ── Claim Payout On-Chain ──────────────────────────────────────────────────────

export async function claimPayoutOnChain(
  marketId: number,
  nonce: number,
  onSuccess: (txId: string) => void,
  onCancel: () => void,
) {
  try {
    const { request } = await import('@stacks/connect')
    const { uintCV } = await import('@stacks/transactions')

    const result = await request('stx_callContract', {
      contract: `${SAKURA_CONTRACT_ADDRESS}.${SAKURA_CONTRACT_NAME}`,
      functionName: 'claim-payout',
      functionArgs: [
        uintCV(marketId),
        uintCV(nonce),
      ],
    })

    if (result?.txid) {
      onSuccess(result.txid)
    } else {
      onCancel()
    }
  } catch (err: unknown) {
    const code = (err as { code?: number })?.code
    if (code === -31001 || code === -32000) {
      onCancel()
    } else {
      onCancel()
      console.error('claimPayoutOnChain error:', err)
    }
  }
}