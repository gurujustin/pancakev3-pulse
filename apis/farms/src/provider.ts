import { StaticJsonRpcProvider } from '@ethersproject/providers'

export const bscProvider = new StaticJsonRpcProvider(
  {
    url: BSC_NODE,
    skipFetchSetup: true,
  },
  56,
)

export const pulseTestnetProvider = new StaticJsonRpcProvider(
  {
    url: PULSE_TESTNET_NODE,
    skipFetchSetup: true,
  },
  943,
)

export const goerliProvider = new StaticJsonRpcProvider(
  {
    url: GOERLI_NODE,
    skipFetchSetup: true,
  },
  5,
)

export const ethProvider = new StaticJsonRpcProvider(
  {
    url: ETH_NODE,
    skipFetchSetup: true,
  },
  1,
)
