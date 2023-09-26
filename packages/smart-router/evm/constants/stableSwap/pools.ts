import { ChainId } from '@pancakeswap/sdk'

import { StableSwapPool } from './types'
import { pools as bscPools } from './56'
import { pools as pulseTestnetPools } from './97'

export type StableSwapPoolMap<TChainId extends number> = {
  [chainId in TChainId]: StableSwapPool[]
}

export const isStableSwapSupported = (chainId: number): chainId is StableSupportedChainId =>
  STABLE_SUPPORTED_CHAIN_IDS.includes(chainId)

export const STABLE_SUPPORTED_CHAIN_IDS = [ChainId.BSC, ChainId.PULSE_TESTNET] as const

export type StableSupportedChainId = (typeof STABLE_SUPPORTED_CHAIN_IDS)[number]

export const STABLE_POOL_MAP = {
  [ChainId.BSC]: bscPools,
  [ChainId.PULSE_TESTNET]: pulseTestnetPools,
} satisfies StableSwapPoolMap<StableSupportedChainId>
