import { ChainId } from '@pancakeswap/sdk'
import { getNodeRealUrlV2 } from 'utils/nodeReal'

export const SERVER_NODES = {
  [ChainId.BSC]: process.env.NEXT_PUBLIC_NODE_PRODUCTION,
  [ChainId.PULSE_TESTNET]: 'https://rpc.v4.testnet.pulsechain.com/',
  [ChainId.ETHEREUM]: getNodeRealUrlV2(ChainId.ETHEREUM, process.env.SERVER_NODE_REAL_API_ETH),
  [ChainId.GOERLI]: getNodeRealUrlV2(ChainId.GOERLI, process.env.SERVER_NODE_REAL_API_GOERLI),
} satisfies Record<ChainId, string>

export const PUBLIC_NODES = {
  [ChainId.BSC]: process.env.NEXT_PUBLIC_NODE_PRODUCTION,
  [ChainId.PULSE_TESTNET]: 'https://rpc.v4.testnet.pulsechain.com/',
  [ChainId.ETHEREUM]: getNodeRealUrlV2(ChainId.ETHEREUM, process.env.NEXT_PUBLIC_NODE_REAL_API_ETH),
  [ChainId.GOERLI]: getNodeRealUrlV2(ChainId.GOERLI, process.env.NEXT_PUBLIC_NODE_REAL_API_GOERLI),
} satisfies Record<ChainId, string>
