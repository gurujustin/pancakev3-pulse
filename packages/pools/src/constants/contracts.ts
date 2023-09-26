import { ChainId } from '@pancakeswap/sdk'

import { SupportedChainId } from './supportedChains'

export type ContractAddresses<T extends ChainId = SupportedChainId> = {
  [chainId in T]: string
}

export const ICAKE = {
  [ChainId.BSC]: '0x3C458828D1622F5f4d526eb0d24Da8C4Eb8F07b1',
  [ChainId.PULSE_TESTNET]: '',
} as ContractAddresses

export const CAKE_VAULT = {
  [ChainId.BSC]: '0x45c54210128a065de780C4B0Df3d16664f7f859e',
  [ChainId.PULSE_TESTNET]: '0x683433ba14e8F26774D43D3E90DA6Dd7a22044Fe',
} as ContractAddresses

export const CAKE_FLEXIBLE_SIDE_VAULT = {
  [ChainId.BSC]: '0x615e896A8C2CA8470A2e9dc2E9552998f8658Ea0',
  [ChainId.PULSE_TESTNET]: '',
} as ContractAddresses
