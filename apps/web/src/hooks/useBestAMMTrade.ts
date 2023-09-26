import { useQuery } from '@tanstack/react-query'
import { useDeferredValue, useMemo } from 'react'
import {
  SmartRouter,
  PoolType,
  QuoteProvider,
  SmartRouterTrade,
  BATCH_MULTICALL_CONFIGS,
} from '@pancakeswap/smart-router/evm'
import { ChainId, CurrencyAmount, TradeType, Currency } from '@pancakeswap/sdk'
import { useDebounce, usePropsChanged } from '@pancakeswap/hooks'
import { isDesktop } from 'react-device-detect'

import { useIsWrapping } from 'hooks/useWrapCallback'
import { provider } from 'utils/wagmi'
import { useCurrentBlock } from 'state/block/hooks'
import { useFeeDataWithGasPrice } from 'state/user/hooks'
import { viemClients } from 'utils/viem'
import { WorkerEvent } from 'quote-worker'
import { QUOTING_API } from 'config/constants/endpoints'

import {
  useCommonPools as useCommonPoolsWithTicks,
  useCommonPoolsLite,
  PoolsWithState,
  CommonPoolsParams,
} from './useCommonPools'

class WorkerProxy {
  id = 0

  // eslint-disable-next-line no-useless-constructor
  constructor(protected worker: Worker) {}

  public postMessage = async (message: any) => {
    if (!this.worker) {
      throw new Error('Worker not initialized')
    }

    const id = this.id++
    const promise = new Promise((resolve, reject) => {
      const handler = (e) => {
        const [eventId, data] = e.data
        if (id === eventId) {
          this.worker.removeEventListener('message', handler)
          if (data.success === false) {
            reject(data.error)
          } else {
            resolve(data.result)
          }
        }
      }
      this.worker.addEventListener('message', handler)
    })

    this.worker.postMessage([id, message])
    return promise
  }

  public getBestTrade = async (params: WorkerEvent[1]['params']) => {
    return this.postMessage({
      cmd: 'getBestTrade',
      params,
    })
  }
}

const worker =
  typeof window !== 'undefined' && typeof Worker !== 'undefined'
    ? new WorkerProxy(new Worker(new URL('../quote-worker.ts', import.meta.url)))
    : undefined

const worker2 =
  typeof window !== 'undefined' && typeof Worker !== 'undefined'
    ? new WorkerProxy(new Worker(new URL('../quote-worker.ts', import.meta.url)))
    : undefined

// Revalidate interval in milliseconds
const REVALIDATE_AFTER = {
  [ChainId.PULSE_TESTNET]: 15_000,
  [ChainId.BSC]: 15_000,
  [ChainId.ETHEREUM]: 20_000,
  [ChainId.GOERLI]: 20_000,
}

interface FactoryOptions {
  // use to identify hook
  key: string
  useCommonPools: (currencyA?: Currency, currencyB?: Currency, params?: CommonPoolsParams) => PoolsWithState
  getBestTrade?: typeof SmartRouter.getBestTrade
  quoteProvider: QuoteProvider

  // Decrease the size of batch getting quotes for better performance
  quoterOptimization?: boolean
}

interface Options {
  amount?: CurrencyAmount<Currency>
  baseCurrency?: Currency
  currency?: Currency
  tradeType?: TradeType
  maxHops?: number
  maxSplits?: number
  v2Swap?: boolean
  v3Swap?: boolean
  stableSwap?: boolean
  enabled?: boolean
  autoRevalidate?: boolean
}

interface useBestAMMTradeOptions extends Options {
  type?: 'offchain' | 'quoter' | 'auto' | 'api'
}

const isLowEndDevice = typeof window !== 'undefined' && !(isDesktop && typeof window.requestIdleCallback === 'function')

export function useBestAMMTrade({ type = 'quoter', ...params }: useBestAMMTradeOptions) {
  const { amount, baseCurrency, currency, autoRevalidate, enabled = true } = params
  const isWrapping = useIsWrapping(baseCurrency, currency, amount?.toExact())

  const isQuoterEnabled = useMemo(
    () => Boolean(!isWrapping && (type === 'quoter' || type === 'auto')),
    [type, isWrapping],
  )

  const isQuoterAPIEnabled = useMemo(() => Boolean(!isWrapping && type === 'api'), [isWrapping, type])

  const isOffChainEnabled = useMemo(
    () => Boolean(!isWrapping && !isLowEndDevice && (type === 'offchain' || type === 'auto')),
    [isWrapping, type],
  )

  const offChainAutoRevalidate = typeof autoRevalidate === 'boolean' ? autoRevalidate : isOffChainEnabled
  const bestTradeFromOffchain = useBestAMMTradeFromOffchain({
    ...params,
    enabled: Boolean(enabled && isOffChainEnabled),
    autoRevalidate: offChainAutoRevalidate,
  })
  const apiAutoRevalidate =
    typeof autoRevalidate === 'boolean' ? autoRevalidate : isQuoterAPIEnabled && !isOffChainEnabled

  // switch to api when it's stable
  // const _bestTradeFromQuoterApi = useBestAMMTradeFromQuoterApi({
  //   ...params,
  //   enabled: Boolean(enabled && isQuoterAPIEnabled),
  //   autoRevalidate: apiAutoRevalidate,
  // })
  const bestTradeFromQuoterApi = useBestAMMTradeFromQuoterWorker2({
    ...params,
    enabled: Boolean(enabled && isQuoterAPIEnabled),
    autoRevalidate: apiAutoRevalidate,
  })

  const quoterAutoRevalidate =
    typeof autoRevalidate === 'boolean' ? autoRevalidate : isQuoterEnabled && !isOffChainEnabled

  const bestTradeFromQuoterWorker = useBestAMMTradeFromQuoterWorker({
    ...params,
    enabled: Boolean(enabled && isQuoterEnabled && !isQuoterAPIEnabled),
    autoRevalidate: quoterAutoRevalidate,
  })

  return useMemo(() => {
    const { trade: tradeFromOffchain } = bestTradeFromOffchain
    const { trade: tradeFromQuoterWorker } = bestTradeFromQuoterWorker
    const { trade: tradeFromApi } = bestTradeFromQuoterApi

    const quoterTrade = tradeFromApi || tradeFromQuoterWorker
    const bestTradeFromQuoter_ = isQuoterAPIEnabled ? bestTradeFromQuoterApi : bestTradeFromQuoterWorker

    if (!tradeFromOffchain && !quoterTrade) {
      return bestTradeFromOffchain
    }
    if (!tradeFromOffchain || !quoterTrade) {
      // console.log(
      //   `[BEST Trade] Existing ${tradeFromOffchain ? 'Offchain' : 'Quoter'} trade is used`,
      //   tradeFromOffchain || tradeFromQuoter,
      // )
      return tradeFromOffchain ? bestTradeFromOffchain : bestTradeFromQuoter_
    }

    if (
      quoterTrade.blockNumber &&
      tradeFromOffchain.blockNumber &&
      BigInt(quoterTrade.blockNumber) > BigInt(tradeFromOffchain.blockNumber)
    ) {
      // console.log('[BEST Trade] Quoter trade is used', tradeFromQuoter)
      return bestTradeFromQuoter_
    }

    // console.log('[BEST Trade] Offchain trade is used', tradeFromOffchain)
    return bestTradeFromOffchain
  }, [bestTradeFromOffchain, bestTradeFromQuoterApi, bestTradeFromQuoterWorker, isQuoterAPIEnabled])
}

function bestTradeHookFactory({
  key,
  useCommonPools,
  quoteProvider,
  quoterOptimization = true,
  getBestTrade = SmartRouter.getBestTrade,
}: FactoryOptions) {
  return function useBestTrade({
    amount,
    baseCurrency,
    currency,
    tradeType,
    maxHops,
    maxSplits,
    v2Swap = true,
    v3Swap = true,
    stableSwap = true,
    enabled = true,
    autoRevalidate,
  }: Options) {
    const { gasPrice } = useFeeDataWithGasPrice()
    const currenciesUpdated = usePropsChanged(baseCurrency, currency)

    const blockNumber = useCurrentBlock()
    const {
      refresh,
      pools: candidatePools,
      loading,
      syncing,
    } = useCommonPools(baseCurrency || amount?.currency, currency, {
      blockNumber,
      allowInconsistentBlock: true,
      enabled,
    })
    const poolProvider = useMemo(() => SmartRouter.createStaticPoolProvider(candidatePools), [candidatePools])
    const deferQuotientRaw = useDeferredValue(amount?.quotient.toString())
    const deferQuotient = useDebounce(deferQuotientRaw, 500)

    const poolTypes = useMemo(() => {
      const types: PoolType[] = []
      if (v2Swap) {
        types.push(PoolType.V2)
      }
      if (v3Swap) {
        types.push(PoolType.V3)
      }
      if (stableSwap) {
        types.push(PoolType.STABLE)
      }
      return types
    }, [v2Swap, v3Swap, stableSwap])

    const {
      data: trade,
      status,
      fetchStatus,
      isPreviousData,
      error,
    } = useQuery<SmartRouterTrade<TradeType>, Error>({
      queryKey: [
        key,
        currency?.chainId,
        amount?.currency.symbol,
        currency?.symbol,
        tradeType,
        deferQuotient,
        maxHops,
        maxSplits,
        poolTypes,
      ],
      queryFn: async () => {
        const deferAmount = CurrencyAmount.fromRawAmount(amount.currency, deferQuotient)
        const label = `[BEST_AMM](${key}) chain ${currency.chainId}, ${deferAmount.toExact()} ${
          amount.currency.symbol
        } -> ${currency.symbol}, tradeType ${tradeType}`
        SmartRouter.log(label)
        SmartRouter.metric(label, candidatePools)
        const res = await getBestTrade(deferAmount, currency, tradeType, {
          gasPriceWei: gasPrice
            ? BigInt(gasPrice)
            : async () => BigInt(await (await provider({ chainId: amount.currency.chainId }).getGasPrice()).toString()),
          maxHops,
          poolProvider,
          maxSplits,
          quoteProvider,
          allowedPoolTypes: poolTypes,
          quoterOptimization,
        })
        if (res) {
          SmartRouter.metric(
            label,
            res.inputAmount.toExact(),
            res.inputAmount.currency.symbol,
            '->',
            res.outputAmount.toExact(),
            res.outputAmount.currency.symbol,
            res.routes,
          )
        }
        SmartRouter.log(label, res)
        return {
          ...res,
          blockNumber,
        }
      },
      enabled: !!(amount && currency && candidatePools && !loading && deferQuotient && enabled),
      refetchOnWindowFocus: false,
      keepPreviousData: !currenciesUpdated,
      retry: false,
      staleTime: autoRevalidate ? REVALIDATE_AFTER[amount?.currency.chainId] : 0,
      refetchInterval: autoRevalidate && REVALIDATE_AFTER[amount?.currency.chainId],
    })

    const isValidating = fetchStatus === 'fetching'
    const isLoading = status === 'loading' || isPreviousData

    return {
      refresh,
      trade,
      isLoading: isLoading || loading,
      isStale: trade?.blockNumber !== blockNumber,
      error,
      syncing:
        syncing || isValidating || (amount?.quotient.toString() !== deferQuotient && deferQuotient !== undefined),
    }
  }
}

export const useBestAMMTradeFromOffchain = bestTradeHookFactory({
  key: 'useBestAMMTradeFromOffchain',
  useCommonPools: useCommonPoolsWithTicks,
  quoteProvider: SmartRouter.createOffChainQuoteProvider(),
})

const onChainQuoteProvider = SmartRouter.createQuoteProvider({ onChainProvider: viemClients })

export const useBestAMMTradeFromQuoter = bestTradeHookFactory({
  key: 'useBestAMMTradeFromQuoter',
  useCommonPools: useCommonPoolsLite,
  quoteProvider: onChainQuoteProvider,
  // Since quotes are fetched on chain, which relies on network IO, not calculated offchain, we don't need to further optimize
  quoterOptimization: false,
})

export const useBestAMMTradeFromQuoterApi = bestTradeHookFactory({
  key: 'useBestAMMTradeFromQuoterApi',
  useCommonPools: useCommonPoolsLite,
  quoteProvider: onChainQuoteProvider,
  getBestTrade: async (
    amount,
    currency,
    tradeType,
    { maxHops, maxSplits, gasPriceWei, allowedPoolTypes, poolProvider },
  ) => {
    const candidatePools = await poolProvider.getCandidatePools(amount.currency, currency, {
      protocols: allowedPoolTypes,
    })

    const serverRes = await fetch(`${QUOTING_API}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        chainId: currency.chainId,
        currency: SmartRouter.Transformer.serializeCurrency(currency),
        tradeType,
        amount: {
          currency: SmartRouter.Transformer.serializeCurrency(amount.currency),
          value: amount.quotient.toString(),
        },
        gasPriceWei: typeof gasPriceWei !== 'function' ? gasPriceWei?.toString() : undefined,
        maxHops,
        maxSplits,
        poolTypes: allowedPoolTypes,
        candidatePools: candidatePools.map(SmartRouter.Transformer.serializePool),
      }),
    })
    const serializedRes = await serverRes.json()
    return SmartRouter.Transformer.parseTrade(currency.chainId, serializedRes)
  },
  // Since quotes are fetched on chain, which relies on network IO, not calculated offchain, we don't need to further optimize
  quoterOptimization: false,
})

const createWorkerGetBestTrade = (quoteWorker: typeof worker): typeof SmartRouter.getBestTrade => {
  return async (amount, currency, tradeType, { maxHops, maxSplits, allowedPoolTypes, poolProvider, gasPriceWei }) => {
    const candidatePools = await poolProvider.getCandidatePools(amount.currency, currency, {
      protocols: allowedPoolTypes,
    })

    const result = await quoteWorker.getBestTrade({
      chainId: currency.chainId,
      currency: SmartRouter.Transformer.serializeCurrency(currency),
      tradeType,
      amount: {
        currency: SmartRouter.Transformer.serializeCurrency(amount.currency),
        value: amount.quotient.toString(),
      },
      gasPriceWei: typeof gasPriceWei !== 'function' ? gasPriceWei?.toString() : undefined,
      maxHops,
      maxSplits,
      poolTypes: allowedPoolTypes,
      candidatePools: candidatePools.map(SmartRouter.Transformer.serializePool),
    })
    return SmartRouter.Transformer.parseTrade(currency.chainId, result as any)
  }
}

export const useBestAMMTradeFromQuoterWorker = bestTradeHookFactory({
  key: 'useBestAMMTradeFromQuoterWorker',
  useCommonPools: useCommonPoolsLite,
  quoteProvider: onChainQuoteProvider,
  getBestTrade: createWorkerGetBestTrade(worker),
  // Since quotes are fetched on chain, which relies on network IO, not calculated offchain, we don't need to further optimize
  quoterOptimization: false,
})

const onChainQuoteProvider2 = SmartRouter.createQuoteProvider({
  onChainProvider: viemClients,
  multicallConfigs: {
    ...BATCH_MULTICALL_CONFIGS,
    [ChainId.BSC]: {
      ...BATCH_MULTICALL_CONFIGS[ChainId.BSC],
      defaultConfig: {
        multicallChunk: 150,
        gasLimitOverride: 1_000_000,
      },
    },
  },
})
export const useBestAMMTradeFromQuoterWorker2 = bestTradeHookFactory({
  key: 'useBestAMMTradeFromQuoterWorker2',
  useCommonPools: useCommonPoolsLite,
  quoteProvider: onChainQuoteProvider2,
  getBestTrade: createWorkerGetBestTrade(worker2),
  // Since quotes are fetched on chain, which relies on network IO, not calculated offchain, we don't need to further optimize
  quoterOptimization: false,
})
