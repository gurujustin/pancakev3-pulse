import { formatEther } from '@ethersproject/units'
import { MultiCallV2 } from '@pancakeswap/multicall'
import { ChainId } from '@pancakeswap/sdk'
import BigNumber from 'bignumber.js'
import { masterChefAddresses, masterChefV3Addresses } from './const'
import { farmV2FetchFarms, FetchFarmsParams, fetchMasterChefV2Data } from './v2/fetchFarmsV2'
import {
  farmV3FetchFarms,
  fetchMasterChefV3Data,
  fetchCommonTokenUSDValue,
  CommonPrice,
  LPTvl,
  getCakeApr,
} from './fetchFarmsV3'
import { FarmConfigV3, FarmV3DataWithPrice } from './types'

const supportedChainId = [ChainId.GOERLI, ChainId.BSC, ChainId.PULSE_TESTNET, ChainId.ETHEREUM]
const supportedChainIdV3 = [ChainId.GOERLI, ChainId.BSC, ChainId.PULSE_TESTNET, ChainId.ETHEREUM]
export const bCakeSupportedChainId = [ChainId.BSC]

export function createFarmFetcher(multicallv2: MultiCallV2) {
  const fetchFarms = async (
    params: {
      isTestnet: boolean
    } & Pick<FetchFarmsParams, 'chainId' | 'farms'>,
  ) => {
    const { isTestnet, farms, chainId } = params
    const masterChefAddress = isTestnet ? masterChefAddresses[ChainId.PULSE_TESTNET] : masterChefAddresses[ChainId.BSC]
    const { poolLength, totalRegularAllocPoint, totalSpecialAllocPoint, cakePerBlock } = await fetchMasterChefV2Data({
      isTestnet,
      multicallv2,
      masterChefAddress,
    })
    const regularCakePerBlock = formatEther(cakePerBlock)
    const farmsWithPrice = await farmV2FetchFarms({
      multicallv2,
      masterChefAddress,
      isTestnet,
      chainId,
      farms: farms.filter((f) => !f.pid || poolLength.gt(f.pid)),
      totalRegularAllocPoint,
      totalSpecialAllocPoint,
    })

    return {
      farmsWithPrice,
      poolLength: poolLength.toNumber(),
      regularCakePerBlock: +regularCakePerBlock,
    }
  }

  return {
    fetchFarms,
    isChainSupported: (chainId: number) => supportedChainId.includes(chainId),
    supportedChainId,
    isTestnet: (chainId: number) => ![ChainId.BSC, ChainId.ETHEREUM].includes(chainId),
  }
}

export function createFarmFetcherV3(multicallv2: MultiCallV2) {
  const fetchFarms = async ({
    farms,
    chainId,
    commonPrice,
  }: {
    chainId: ChainId
    farms: FarmConfigV3[]
    commonPrice: CommonPrice
  }) => {
    const masterChefAddress = masterChefV3Addresses[chainId]
    if (!masterChefAddress) {
      throw new Error('Unsupported chain')
    }

    try {
      const { poolLength, totalAllocPoint, latestPeriodCakePerSecond } = await fetchMasterChefV3Data({
        multicallv2,
        masterChefAddress,
        chainId,
      })

      const cakePerSecond = new BigNumber(latestPeriodCakePerSecond.toString()).div(1e18).div(1e12).toString()

      const farmsWithPrice = await farmV3FetchFarms({
        farms,
        chainId,
        multicallv2,
        masterChefAddress,
        totalAllocPoint,
        commonPrice,
      })

      return {
        poolLength: poolLength.toNumber(),
        farmsWithPrice,
        cakePerSecond,
      }
    } catch (error) {
      console.error(error)
      throw error
    }
  }

  const getCakeAprAndTVL = (farm: FarmV3DataWithPrice, lpTVL: LPTvl, cakePrice: string, cakePerSecond: string) => {
    const tvl = new BigNumber(farm.tokenPriceBusd)
      .times(lpTVL.token0)
      .plus(new BigNumber(farm.quoteTokenPriceBusd).times(lpTVL.token1))

    const cakeApr = getCakeApr(farm.poolWeight, tvl, cakePrice, cakePerSecond)

    return {
      activeTvlUSD: tvl.toString(),
      activeTvlUSDUpdatedAt: lpTVL.updatedAt,
      cakeApr,
    }
  }

  return {
    fetchFarms,
    getCakeAprAndTVL,
    isChainSupported: (chainId: number) => supportedChainIdV3.includes(chainId),
    supportedChainId: supportedChainIdV3,
    isTestnet: (chainId: number) => ![ChainId.BSC, ChainId.ETHEREUM].includes(chainId),
  }
}

export * from './v2/apr'
export * from './v2/farmsPriceHelpers'
export * from './types'
export * from './v2/deserializeFarmUserData'
export * from './v2/deserializeFarm'
export { FARM_AUCTION_HOSTING_IN_SECONDS } from './const'
export * from './v2/filterFarmsByQuery'

export { masterChefV3Addresses, fetchCommonTokenUSDValue }
