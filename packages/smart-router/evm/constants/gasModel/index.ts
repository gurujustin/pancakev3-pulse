import { ChainId, Token } from '@pancakeswap/sdk'
import { ethereumTokens, bscTokens, pulseTestnetTokens, goerliTestnetTokens } from '@pancakeswap/tokens'

export const usdGasTokensByChain: { [chainId in ChainId]?: Token[] } = {
  [ChainId.ETHEREUM]: [ethereumTokens.usdt],
  [ChainId.GOERLI]: [goerliTestnetTokens.usdc],
  [ChainId.BSC]: [bscTokens.busd],
  [ChainId.PULSE_TESTNET]: [pulseTestnetTokens.busd],
}

export const nativeWrappedTokenByChain: { [chainId in ChainId]?: Token } = {
  [ChainId.ETHEREUM]: ethereumTokens.weth,
  [ChainId.GOERLI]: goerliTestnetTokens.weth,
  [ChainId.BSC]: bscTokens.wbnb,
  [ChainId.PULSE_TESTNET]: pulseTestnetTokens.wbnb,
}

export * from './v2'
export * from './v3'
export * from './stableSwap'
