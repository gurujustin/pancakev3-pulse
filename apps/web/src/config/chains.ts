import { ChainId } from '@pancakeswap/sdk'
import memoize from 'lodash/memoize'
import invert from 'lodash/invert'
import { bsc, goerli, mainnet } from 'wagmi/chains'

export const CHAIN_QUERY_NAME = {
  [ChainId.ETHEREUM]: 'eth',
  [ChainId.GOERLI]: 'goerli',
  [ChainId.BSC]: 'bsc',
  [ChainId.PULSE_TESTNET]: 'pulsechainV4',
} as const satisfies Record<ChainId, string>

const pulseTestnet = {
  id: 943,
  network: 'pulsechainV4',
  name: 'PulseChain V4',
  testnet: true,
  nativeCurrency: { name: 'V4 Pulse', symbol: 'v4PLS', decimals: 18 },
  rpcUrls: {
    default: {
      http: ['https://rpc.v4.testnet.pulsechain.com'],
      webSocket: ['wss://ws.v4.testnet.pulsechain.com'],
    },
    public: {
      http: ['https://rpc.v4.testnet.pulsechain.com'],
      webSocket: ['wss://ws.v4.testnet.pulsechain.com'],
    },
  },
  blockExplorers: {
    default: {
      name: 'PulseScan',
      url: 'https://scan.v4.testnet.pulsechain.com',
    },
  },
  contracts: {
    ensRegistry: {
      address: '0x00000000000C2E074eC69A0dFb2997BA6C7d2e1e',
    },
    multicall3: {
      address: '0x4c5936F34BA40B40B461236d315992e6D118E042',
      blockCreated: 14353601,
    },
  },
} as const

const CHAIN_QUERY_NAME_TO_ID = invert(CHAIN_QUERY_NAME)

export const getChainId = memoize((chainName: string) => {
  if (!chainName) return undefined
  return CHAIN_QUERY_NAME_TO_ID[chainName] ? +CHAIN_QUERY_NAME_TO_ID[chainName] : undefined
})

export const CHAINS = [pulseTestnet, bsc, goerli]
