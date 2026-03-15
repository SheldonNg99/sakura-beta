// lib/stacks.ts
// Stacks wallet connect utilities for SakuraBeta

import { AppConfig, UserSession, showConnect } from '@stacks/connect'
import { STACKS_TESTNET } from '@stacks/network'
import { fetchCallReadOnlyFunction, uintCV, boolCV } from '@stacks/transactions'

// -- Config --

export const appConfig = new AppConfig(['store_write', 'publish_data'])
export const userSession = new UserSession({ appConfig })
export const network = STACKS_TESTNET

// Contract details -- update after testnet deployment
export const SAKURA_CONTRACT_ADDRESS = process.env.NEXT_PUBLIC_STACKS_CONTRACT_ADDRESS || ''
export const SAKURA_CONTRACT_NAME = 'sakura-market'

// -- Wallet Connect --

export async function connectWallet(onSuccess: () => void) {
  const { request } = await import('@stacks/connect')
  
  const response = await request('getAddresses')
  
  if (response?.addresses?.length > 0) {
    const stxAddress = response.addresses.find(
      (a: any) => a.symbol === 'STX'
    )
    if (stxAddress) {
      localStorage.setItem('stacks_address', stxAddress.address)
      onSuccess()
    }
  }
}

export function disconnectWallet() {
  localStorage.removeItem('stacks_address')
}

export function getWalletAddress(): string | null {
  return localStorage.getItem('stacks_address')
}

export function isWalletConnected(): boolean {
  return !!localStorage.getItem('stacks_address')
}

// -- Contract Calls --

export async function placeBetOnChain(
  marketId: number,
  position: boolean,
  amount: number,
  onSuccess: (txId: string) => void,
  onCancel: () => void
) {
  const { openContractCall } = await import('@stacks/connect')

  await openContractCall({
    contractAddress: SAKURA_CONTRACT_ADDRESS,
    contractName: SAKURA_CONTRACT_NAME,
    functionName: 'place-bet',
    functionArgs: [
      uintCV(marketId),
      boolCV(position),
      uintCV(amount),
    ],
    appDetails: {
      name: 'SakuraBeta',
      icon: '/favicon.ico',
    },
    onFinish: (data) => onSuccess(data.txId),
    onCancel,
  })
}

// -- Read Only --

export async function getMarketFromChain(marketId: number) {
  const result = await fetchCallReadOnlyFunction({
    contractAddress: SAKURA_CONTRACT_ADDRESS,
    contractName: SAKURA_CONTRACT_NAME,
    functionName: 'get-market',
    functionArgs: [uintCV(marketId)],
    network,
    senderAddress: SAKURA_CONTRACT_ADDRESS,
  })
  return result
}