import { formatUnits } from '@ethersproject/units'
import { getPoolsConfig, getPoolContractBySousId, SUPPORTED_CHAIN_IDS, isLegacyPool } from '@pancakeswap/pools'
import { describe, it } from 'vitest'
import { provider } from 'utils/wagmi'
import { ChainId } from '@pancakeswap/sdk'

describe.concurrent('Config pools', () => {
  for (const chainId of SUPPORTED_CHAIN_IDS) {
    const pools = getPoolsConfig(chainId)
    // Pool 0 is special (cake pool)
    // Pool 78 is a broken pool, not used, and break the tests
    const idsToRemove = chainId === ChainId.BSC ? [0, 78] : []
    // Test only against the last 10 pools, for performance concern
    const poolsToTest = pools.filter((pool) => !idsToRemove.includes(pool.sousId)).slice(0, 10)

    it.each(pools.map((pool) => pool.sousId))('Pool #%d has an unique sousId', (sousId) => {
      const duplicates = pools.filter((p) => sousId === p.sousId)
      expect(duplicates).toHaveLength(1)
    })
    it.each(pools.map((pool) => [pool.sousId, pool.contractAddress]))(
      'Pool #%d has an unique contract address',
      (_, contractAddress) => {
        const duplicates = pools.filter((p) => contractAddress === p.contractAddress)
        expect(duplicates).toHaveLength(1)
      },
    )
    it.each(poolsToTest.filter((pool) => pool.earningToken.symbol !== 'BNB'))(
      'Pool %p has the correct earning token',
      async (pool) => {
        const contract = getPoolContractBySousId({ sousId: pool.sousId, chainId, provider: provider({ chainId }) })
        const rewardTokenAddress = await contract.rewardToken()
        expect(rewardTokenAddress.toLowerCase()).toBe(pool.earningToken.address.toLowerCase())
      },
      10000,
    )
    it.each(poolsToTest.filter((pool) => pool.stakingToken.symbol !== 'BNB'))(
      'Pool %p has the correct staking token',
      async (pool) => {
        let stakingTokenAddress = null
        try {
          const contract = getPoolContractBySousId({ sousId: pool.sousId, chainId, provider: provider({ chainId }) })
          stakingTokenAddress = await contract.stakedToken()
        } catch (error) {
          const contract = getPoolContractBySousId({ sousId: pool.sousId, chainId, provider: provider({ chainId }) })
          stakingTokenAddress = await contract.syrup()
        }

        expect(stakingTokenAddress.toLowerCase()).toBe(pool.stakingToken.address.toLowerCase())
      },
      10000,
    )

    it.each(poolsToTest.filter((pool) => pool.stakingToken.symbol !== 'BNB'))(
      'Pool %p has the correct tokenPerBlock',
      async (pool) => {
        const contract = getPoolContractBySousId({ sousId: pool.sousId, chainId, provider: provider({ chainId }) })
        if (isLegacyPool(pool)) {
          const rewardPerBlock = await contract.rewardPerBlock()

          expect(String(parseFloat(formatUnits(rewardPerBlock, pool.earningToken.decimals)))).toBe(pool.tokenPerBlock)
        } else {
          const rewardPerSecond = await contract.rewardPerSecond()

          expect(String(parseFloat(formatUnits(rewardPerSecond, pool.earningToken.decimals)))).toBe(pool.tokenPerSecond)
        }
      },
      10000,
    )
  }
})
