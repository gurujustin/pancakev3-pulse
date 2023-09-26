import {
  AutoColumn,
  AutoRow,
  Box,
  Button,
  CardBody,
  Dots,
  Message,
  MessageText,
  PreTitle,
  RowBetween,
  Spinner,
  Text,
} from '@pancakeswap/uikit'
import { GreyCard } from 'components/Card'
import { CurrencyLogo } from 'components/Logo'
import { Bound } from 'config/constants/types'
import { useToken } from 'hooks/Tokens'
import { usePairContract, useV3MigratorContract } from 'hooks/useContract'
import { immutableMiddleware, useSWRContract } from 'hooks/useSWRContract'
import useTokenBalance from 'hooks/useTokenBalance'
import useTransactionDeadline from 'hooks/useTransactionDeadline'
import { useDerivedPositionInfo } from 'hooks/v3/useDerivedPositionInfo'
import useV3DerivedInfo from 'hooks/v3/useV3DerivedInfo'
import { useRouter } from 'next/router'
import { useCallback, useEffect, useMemo, useState } from 'react'

import { splitSignature } from '@ethersproject/bytes'
import { TransactionResponse } from '@ethersproject/providers'
import { Trans, useTranslation } from '@pancakeswap/localization'
import { CurrencyAmount, ERC20Token, Fraction, Pair, Price, WNATIVE, ZERO } from '@pancakeswap/sdk'
import { AtomBox } from '@pancakeswap/ui'
import { useUserSlippagePercent } from '@pancakeswap/utils/user'
import { FeeAmount, Pool, Position, priceToClosestTick, TickMath } from '@pancakeswap/v3-sdk'
import { useWeb3LibraryContext } from '@pancakeswap/wagmi'
import { CommitButton } from 'components/CommitButton'
import LiquidityChartRangeInput from 'components/LiquidityChartRangeInput'
import { ROUTER_ADDRESS } from 'config/constants/exchange'
import useActiveWeb3React from 'hooks/useActiveWeb3React'
import { ApprovalState, useApproveCallback } from 'hooks/useApproveCallback'
import { useV2Pair } from 'hooks/usePairs'
import useTotalSupply from 'hooks/useTotalSupply'
import { useIsTransactionPending, useTransactionAdder } from 'state/transactions/hooks'
import { calculateGasMargin } from 'utils'
import { formatCurrencyAmount } from 'utils/formatCurrencyAmount'
import { unwrappedToken } from 'utils/wrappedCurrency'
import { isUserRejected } from 'utils/sentry'
import { ResponsiveTwoColumns } from 'views/AddLiquidityV3'
import FeeSelector from './formViews/V3FormView/components/FeeSelector'
import RangeSelector from './formViews/V3FormView/components/RangeSelector'
import RateToggle from './formViews/V3FormView/components/RateToggle'
import { useRangeHopCallbacks } from './formViews/V3FormView/form/hooks/useRangeHopCallbacks'
import { useV3MintActionHandlers } from './formViews/V3FormView/form/hooks/useV3MintActionHandlers'
import { HandleFeePoolSelectFn } from './types'
import { useV3FormState } from './formViews/V3FormView/form/reducer'

export function Migrate({ v2PairAddress }: { v2PairAddress: string }) {
  const pairContract = usePairContract(v2PairAddress)

  const { data: token0Address } = useSWRContract([pairContract, 'token0'], { use: [immutableMiddleware] })
  const { data: token1Address } = useSWRContract([pairContract, 'token1'], { use: [immutableMiddleware] })

  const token0 = useToken(token0Address)
  const token1 = useToken(token1Address)

  const [, pair] = useV2Pair(token0, token1)
  const totalSupply = useTotalSupply(pair?.liquidityToken)

  if (!token0Address || !token1Address || !pair || !totalSupply)
    return (
      <AtomBox width="100%" justifyContent="center" alignItems="center" display="flex" minHeight="screenMd">
        <Spinner />
      </AtomBox>
    )

  return (
    <V2PairMigrate
      v2PairAddress={v2PairAddress}
      token0={token0}
      token1={token1}
      pair={pair}
      v2LPTotalSupply={totalSupply}
    />
  )
}

const percentageToMigrate = 100

function V2PairMigrate({
  v2PairAddress,
  token0,
  token1,
  pair,
  v2LPTotalSupply,
}: {
  v2PairAddress: string
  token0: ERC20Token
  token1: ERC20Token
  pair: Pair
  v2LPTotalSupply: CurrencyAmount<ERC20Token>
}) {
  const {
    t,
    currentLanguage: { locale },
  } = useTranslation()
  const { chainId, account } = useActiveWeb3React()
  const { balance: pairBalance } = useTokenBalance(v2PairAddress)

  const router = useRouter()

  const { reserve0, reserve1 } = pair

  const token0Value = useMemo(
    () =>
      CurrencyAmount.fromRawAmount(
        token0,
        (BigInt(pairBalance.toString()) * reserve0.quotient) / v2LPTotalSupply.quotient,
      ),
    [token0, pairBalance, reserve0.quotient, v2LPTotalSupply.quotient],
  )
  const token1Value = useMemo(
    () =>
      CurrencyAmount.fromRawAmount(
        token1,
        (BigInt(pairBalance.toString()) * reserve1.quotient) / v2LPTotalSupply.quotient,
      ),
    [token1, pairBalance, reserve1.quotient, v2LPTotalSupply.quotient],
  )

  const [feeAmount, setFeeAmount] = useState(FeeAmount.MEDIUM)

  const handleFeePoolSelect = useCallback<HandleFeePoolSelectFn>(({ feeAmount: newFeeAmount }) => {
    setFeeAmount(newFeeAmount)
  }, [])

  const { position: existingPosition } = useDerivedPositionInfo(undefined)

  // mint state
  const formState = useV3FormState()
  const { rightRangeTypedValue, leftRangeTypedValue } = formState

  const [baseToken, setBaseToken] = useState(token0)

  const { pool, ticks, price, pricesAtTicks, noLiquidity, invalidRange, outOfRange, invertPrice, ticksAtLimit } =
    useV3DerivedInfo(
      token0 ?? undefined,
      token1 ?? undefined,
      feeAmount,
      baseToken ?? undefined,
      existingPosition,
      formState,
    )
  const { onLeftRangeInput, onRightRangeInput, onBothRangeInput } = useV3MintActionHandlers(noLiquidity)

  // get spot prices + price difference
  const v2SpotPrice = useMemo(
    () => new Price(token0, token1, reserve0.quotient, reserve1.quotient),
    [token0, token1, reserve0, reserve1],
  )
  const v3SpotPrice = pool?.token0Price ?? undefined

  let priceDifferenceFraction: Fraction | undefined =
    v2SpotPrice && v3SpotPrice ? v3SpotPrice.divide(v2SpotPrice).subtract(1).multiply(100) : undefined
  if (priceDifferenceFraction?.lessThan(ZERO)) {
    priceDifferenceFraction = priceDifferenceFraction.multiply(-1)
  }

  const largePriceDifference = priceDifferenceFraction && !priceDifferenceFraction?.lessThan(2n)

  // modal and loading
  // capital efficiency warning
  const [showCapitalEfficiencyWarning, setShowCapitalEfficiencyWarning] = useState<boolean>(false)

  useEffect(() => {
    setShowCapitalEfficiencyWarning(false)
  }, [token0, token1, feeAmount, onLeftRangeInput, onRightRangeInput])

  useEffect(() => {
    if (feeAmount) {
      onLeftRangeInput('')
      onRightRangeInput('')
    }
    // NOTE: ignore exhaustive-deps to avoid infinite re-render
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [feeAmount])

  const { minPrice, maxPrice } = router.query

  const currency0 = unwrappedToken(token0)
  const currency1 = unwrappedToken(token1)

  useEffect(() => {
    if (minPrice && typeof minPrice === 'string' && minPrice !== leftRangeTypedValue && !leftRangeTypedValue) {
      onLeftRangeInput(minPrice)
    }
    if (maxPrice && typeof maxPrice === 'string' && maxPrice !== rightRangeTypedValue && !rightRangeTypedValue) {
      onRightRangeInput(maxPrice)
    }
  }, [minPrice, maxPrice, onRightRangeInput, onLeftRangeInput, leftRangeTypedValue, rightRangeTypedValue])
  // txn values
  const deadline = useTransactionDeadline() // custom from users settings

  const { [Bound.LOWER]: tickLower, [Bound.UPPER]: tickUpper } = ticks
  const { [Bound.LOWER]: priceLower, [Bound.UPPER]: priceUpper } = pricesAtTicks

  const [allowedSlippage] = useUserSlippagePercent()

  // the v3 tick is either the pool's tickCurrent, or the tick closest to the v2 spot price
  const tick = pool?.tickCurrent ?? priceToClosestTick(v2SpotPrice)
  // the price is either the current v3 price, or the price at the tick
  const sqrtPrice = pool?.sqrtRatioX96 ?? TickMath.getSqrtRatioAtTick(tick)
  const position =
    typeof tickLower === 'number' && typeof tickUpper === 'number' && !invalidRange
      ? Position.fromAmounts({
          pool: pool ?? new Pool(token0, token1, feeAmount, sqrtPrice, 0, tick, []),
          tickLower,
          tickUpper,
          amount0: token0Value.quotient,
          amount1: token1Value.quotient,
          useFullPrecision: true, // we want full precision for the theoretical position
        })
      : undefined

  const { amount0: v3Amount0Min, amount1: v3Amount1Min } = useMemo(
    () => (position ? position.mintAmountsWithSlippage(allowedSlippage) : { amount0: undefined, amount1: undefined }),
    [position, allowedSlippage],
  )

  const refund0 = useMemo(
    () => position && CurrencyAmount.fromRawAmount(token0, token0Value.quotient - position.amount0.quotient),
    [token0Value, position, token0],
  )
  const refund1 = useMemo(
    () => position && CurrencyAmount.fromRawAmount(token1, token1Value.quotient - position.amount1.quotient),
    [token1Value, position, token1],
  )

  const { getDecrementLower, getIncrementLower, getDecrementUpper, getIncrementUpper, getSetFullRange } =
    useRangeHopCallbacks(
      baseToken ?? undefined,
      baseToken.equals(token0) ? token1 : token0,
      feeAmount,
      tickLower,
      tickUpper,
      pool,
    )

  const [confirmingMigration, setConfirmingMigration] = useState<boolean>(false)
  const [pendingMigrationHash, setPendingMigrationHash] = useState<string | null>(null)

  const addTransaction = useTransactionAdder()
  const isMigrationPending = useIsTransactionPending(pendingMigrationHash ?? undefined)

  const migrator = useV3MigratorContract()
  const [signatureData, setSignatureData] = useState<{ v: number; r: string; s: string; deadline: number } | null>(null)
  const [approval, approveCallback] = useApproveCallback(
    CurrencyAmount.fromRawAmount(pair.liquidityToken, pairBalance.toString()),
    ROUTER_ADDRESS[chainId],
  )
  const library = useWeb3LibraryContext()

  const pairContractRead = usePairContract(pair?.liquidityToken?.address, false)

  const approve = useCallback(async () => {
    // try to gather a signature for permission
    const nonce = await pairContractRead.nonces(account)

    const EIP712Domain = [
      { name: 'name', type: 'string' },
      { name: 'version', type: 'string' },
      { name: 'chainId', type: 'uint256' },
      { name: 'verifyingContract', type: 'address' },
    ]
    const domain = {
      name: 'Pancake LPs',
      version: '1',
      chainId,
      verifyingContract: pair.liquidityToken.address,
    }
    const Permit = [
      { name: 'owner', type: 'address' },
      { name: 'spender', type: 'address' },
      { name: 'value', type: 'uint256' },
      { name: 'nonce', type: 'uint256' },
      { name: 'deadline', type: 'uint256' },
    ]
    const message = {
      owner: account,
      spender: migrator.address,
      value: pairBalance.toString(),
      nonce: nonce.toHexString(),
      deadline: deadline.toNumber(),
    }
    const data = JSON.stringify({
      types: {
        EIP712Domain,
        Permit,
      },
      domain,
      primaryType: 'Permit',
      message,
    })
    library
      .send('eth_signTypedData_v4', [account, data])
      .then(splitSignature)
      .then((signature) => {
        setSignatureData({
          v: signature.v,
          r: signature.r,
          s: signature.s,
          deadline: deadline.toNumber(),
        })
      })
      .catch((err) => {
        // for all errors other than 4001 (EIP-1193 user rejected request), fall back to manual approve
        if (!isUserRejected(err)) {
          approveCallback()
        }
      })
  }, [
    pairContractRead,
    account,
    chainId,
    pair.liquidityToken.address,
    migrator.address,
    pairBalance,
    deadline,
    library,
    approveCallback,
  ])

  const migrate = useCallback(() => {
    if (
      !migrator ||
      !account ||
      !deadline ||
      typeof tickLower !== 'number' ||
      typeof tickUpper !== 'number' ||
      !v3Amount0Min ||
      !v3Amount1Min ||
      !chainId
    )
      return

    const deadlineToUse = signatureData?.deadline ?? deadline

    const data: string[] = []

    // permit if necessary
    if (signatureData) {
      data.push(
        migrator.interface.encodeFunctionData('selfPermit', [
          pair.liquidityToken.address,
          `0x${pairBalance.toString(16)}`,
          deadlineToUse,
          signatureData.v,
          signatureData.r,
          signatureData.s,
        ]),
      )
    }

    // create/initialize pool if necessary
    if (noLiquidity) {
      data.push(
        migrator.interface.encodeFunctionData('createAndInitializePoolIfNecessary', [
          token0.address,
          token1.address,
          feeAmount,
          `0x${sqrtPrice.toString(16)}`,
        ]),
      )
    }

    // TODO could save gas by not doing this in multicall
    data.push(
      migrator.interface.encodeFunctionData('migrate', [
        {
          pair: pair.liquidityToken.address,
          liquidityToMigrate: `0x${pairBalance.toString(16)}`,
          percentageToMigrate,
          token0: token0.address,
          token1: token1.address,
          fee: feeAmount,
          tickLower,
          tickUpper,
          amount0Min: `0x${v3Amount0Min.toString(16)}`,
          amount1Min: `0x${v3Amount1Min.toString(16)}`,
          recipient: account,
          deadline: deadlineToUse,
          refundAsETH: true, // hard-code this for now
        },
      ]),
    )

    setConfirmingMigration(true)

    migrator.estimateGas
      .multicall(data)
      .then((gasEstimate) => {
        return migrator
          .multicall(data, { gasLimit: calculateGasMargin(gasEstimate) })
          .then((response: TransactionResponse) => {
            addTransaction(response, {
              type: 'migrate-v3',
              translatableSummary: {
                text: 'Migrated %symbolA% %symbolB% V2 liquidity to V3',
                data: { symbolA: currency0.symbol, symbolB: currency1.symbol },
              },
            })
            setPendingMigrationHash(response.hash)
          })
      })
      .catch((e) => {
        console.error(e)
        setConfirmingMigration(false)
      })
  }, [
    chainId,
    migrator,
    noLiquidity,
    token0,
    token1,
    feeAmount,
    pairBalance,
    tickLower,
    tickUpper,
    sqrtPrice,
    v3Amount0Min,
    v3Amount1Min,
    account,
    deadline,
    signatureData,
    addTransaction,
    pair,
    currency0,
    currency1,
  ])

  const isSuccessfullyMigrated = !!pendingMigrationHash && BigInt(pairBalance.toString()) === ZERO

  return (
    <CardBody>
      <ResponsiveTwoColumns>
        <AutoColumn alignSelf="start" gap="16px">
          <PreTitle>{t('Migrating from V2')}</PreTitle>
          <GreyCard>
            <AutoColumn gap="8px">
              <AutoRow justifyContent="space-between">
                <AutoRow gap="4px" flex={1}>
                  <CurrencyLogo currency={token0} />
                  <Text color="textSubtle" small>
                    {token0?.symbol}
                  </Text>
                </AutoRow>
                <Text bold>{token0Value.toSignificant(6)}</Text>
              </AutoRow>
              <AutoRow>
                <AutoRow gap="4px" flex={1}>
                  <CurrencyLogo currency={token1} />
                  <Text color="textSubtle" small>
                    {token1?.symbol}
                  </Text>
                </AutoRow>
                <Text bold>{token1Value.toSignificant(6)}</Text>
              </AutoRow>
            </AutoColumn>
          </GreyCard>
          <FeeSelector
            currencyA={token0 ?? undefined}
            currencyB={token1 ?? undefined}
            handleFeePoolSelect={handleFeePoolSelect}
            feeAmount={feeAmount}
          />
          <AutoColumn gap="8px">
            <PreTitle>{t('Deposit Amount')}</PreTitle>
            <GreyCard>
              <AutoColumn gap="8px">
                <AutoRow justifyContent="space-between">
                  <AutoRow gap="4px" flex={1}>
                    <CurrencyLogo currency={token0} />
                    <Text color="textSubtle" small>
                      {token0?.symbol}
                    </Text>
                  </AutoRow>
                  {position && <Text bold>{position.amount0.toSignificant(6)}</Text>}
                </AutoRow>
                <AutoRow>
                  <AutoRow gap="4px" flex={1}>
                    <CurrencyLogo currency={token1} />
                    <Text color="textSubtle" small>
                      {token1?.symbol}
                    </Text>
                  </AutoRow>
                  {position && <Text bold>{position.amount1.toSignificant(6)}</Text>}
                </AutoRow>
                {position && chainId && refund0 && refund1 ? (
                  <Text color="textSubtle">
                    At least {formatCurrencyAmount(refund0, 4, locale)}{' '}
                    {chainId && WNATIVE[chainId]?.equals(token0) ? 'ETH' : token0.symbol} and{' '}
                    {formatCurrencyAmount(refund1, 4, locale)}{' '}
                    {chainId && WNATIVE[chainId]?.equals(token1) ? 'ETH' : token1.symbol} will be refunded to your
                    wallet due to selected price range.
                  </Text>
                ) : null}
              </AutoColumn>
            </GreyCard>
          </AutoColumn>
        </AutoColumn>
        <AutoColumn alignSelf="flex-start" gap="16px">
          <RowBetween>
            <PreTitle>{t('Set Price Range')}</PreTitle>
            <RateToggle
              currencyA={invertPrice ? currency1 : currency0}
              handleRateToggle={() => {
                onLeftRangeInput('')
                onRightRangeInput('')
                setBaseToken((base) => (base.equals(token0) ? token1 : token0))
              }}
            />
          </RowBetween>
          {noLiquidity && (
            <AtomBox>
              <Message variant="warning">
                <MessageText>
                  {t(
                    'You are the first liquidity provider for this PancakeSwap V3 pool. Your liquidity will migrate at the current V2 price.',
                  )}
                  <MessageText>
                    {t('Your transaction cost will be much higher as it includes the gas to create the pool.')}
                  </MessageText>
                </MessageText>
              </Message>

              {v2SpotPrice && (
                <AutoColumn gap="sm" style={{ marginTop: '12px' }}>
                  <RowBetween>
                    <Text>
                      <Text>V2 {invertPrice ? currency1.symbol : currency0.symbol} Price:</Text>{' '}
                      {invertPrice
                        ? `${v2SpotPrice?.invert()?.toSignificant(6)} ${currency0.symbol}`
                        : `${v2SpotPrice?.toSignificant(6)} ${currency1.symbol}`}
                    </Text>
                  </RowBetween>
                </AutoColumn>
              )}
            </AtomBox>
          )}
          {largePriceDifference ? (
            <GreyCard>
              <AutoColumn gap="sm">
                <RowBetween>
                  <Text fontSize={14}>V2 {invertPrice ? currency1.symbol : currency0.symbol} Price:</Text>
                  <Text fontSize={14}>
                    {invertPrice
                      ? `${v2SpotPrice?.invert()?.toSignificant(6)} ${currency0.symbol}`
                      : `${v2SpotPrice?.toSignificant(6)} ${currency1.symbol}`}
                  </Text>
                </RowBetween>

                <RowBetween>
                  <Text fontSize={14}>V3 {invertPrice ? currency1.symbol : currency0.symbol} Price:</Text>
                  <Text fontSize={14}>
                    {invertPrice
                      ? `${v3SpotPrice?.invert()?.toSignificant(6)} ${currency0.symbol}`
                      : `${v3SpotPrice?.toSignificant(6)} ${currency1.symbol}`}
                  </Text>
                </RowBetween>

                <RowBetween>
                  <Text fontSize={14} color="inherit">
                    {t('Price Difference')}:
                  </Text>
                  <Text fontSize={14} color="inherit">
                    {priceDifferenceFraction?.toSignificant(4)}%
                  </Text>
                </RowBetween>
              </AutoColumn>
              <Text fontSize={14} style={{ marginTop: 8, fontWeight: 400 }}>
                {t('You should only deposit liquidity into PancakeSwap V3 at a price you believe is correct.')} <br />
                {t(
                  'If the price seems incorrect, you can either make a swap to move the price or wait for someone else to do so.',
                )}
              </Text>
            </GreyCard>
          ) : !noLiquidity && v3SpotPrice ? (
            <RowBetween>
              <Text fontSize={14}>V3 {invertPrice ? currency1.symbol : currency0.symbol} Price:</Text>
              <Text fontSize={14}>
                {invertPrice
                  ? `${v3SpotPrice?.invert()?.toSignificant(6)} ${currency0.symbol}`
                  : `${v3SpotPrice?.toSignificant(6)} ${currency1.symbol}`}
              </Text>
            </RowBetween>
          ) : null}

          <LiquidityChartRangeInput
            currencyA={baseToken ?? undefined}
            currencyB={baseToken.equals(token0) ? token1 : token0 ?? undefined}
            feeAmount={feeAmount}
            ticksAtLimit={ticksAtLimit}
            price={price ? parseFloat((invertPrice ? price.invert() : price).toSignificant(8)) : undefined}
            priceLower={priceLower}
            priceUpper={priceUpper}
            onLeftRangeInput={onLeftRangeInput}
            onRightRangeInput={onRightRangeInput}
            onBothRangeInput={onBothRangeInput}
            interactive
          />
          <RangeSelector
            priceLower={priceLower}
            priceUpper={priceUpper}
            getDecrementLower={getDecrementLower}
            getIncrementLower={getIncrementLower}
            getDecrementUpper={getDecrementUpper}
            getIncrementUpper={getIncrementUpper}
            onLeftRangeInput={onLeftRangeInput}
            onRightRangeInput={onRightRangeInput}
            currencyA={invertPrice ? currency1 : currency0}
            currencyB={invertPrice ? currency0 : currency1}
            feeAmount={feeAmount}
            ticksAtLimit={ticksAtLimit}
          />
          {showCapitalEfficiencyWarning ? (
            <Message variant="warning">
              <Box>
                <Text fontSize="16px">{t('Efficiency Comparison')}</Text>
                <Text color="textSubtle">
                  {t('Full range positions may earn less fees than concentrated positions.')}
                </Text>
                <Button
                  mt="16px"
                  onClick={() => {
                    setShowCapitalEfficiencyWarning(false)
                    getSetFullRange()
                  }}
                  scale="md"
                  variant="danger"
                >
                  {t('I understand')}
                </Button>
              </Box>
            </Message>
          ) : (
            <Button
              onClick={() => {
                setShowCapitalEfficiencyWarning(true)
              }}
              variant="secondary"
              scale="sm"
            >
              {t('Full Range')}
            </Button>
          )}
          {outOfRange ? (
            <Message variant="warning">
              <RowBetween>
                <Text ml="12px" fontSize="12px">
                  {t(
                    'Your position will not earn fees or be used in trades until the market price moves into your range.',
                  )}
                </Text>
              </RowBetween>
            </Message>
          ) : null}
          {invalidRange ? (
            <Message variant="warning">
              <MessageText>{t('Invalid range selected. The min price must be lower than the max price.')}</MessageText>
            </Message>
          ) : null}
          <AutoColumn gap="md">
            {!isSuccessfullyMigrated && !isMigrationPending ? (
              <AutoColumn gap="md" style={{ flex: '1' }}>
                <CommitButton
                  variant={approval === ApprovalState.APPROVED || signatureData !== null ? 'success' : 'primary'}
                  disabled={
                    approval !== ApprovalState.NOT_APPROVED ||
                    signatureData !== null ||
                    !v3Amount0Min ||
                    !v3Amount1Min ||
                    invalidRange ||
                    confirmingMigration
                  }
                  onClick={approve}
                >
                  {approval === ApprovalState.PENDING ? (
                    <Dots>
                      <Trans>Enabling</Trans>
                    </Dots>
                  ) : approval === ApprovalState.APPROVED || signatureData !== null ? (
                    <Trans>Enabled</Trans>
                  ) : (
                    <Trans>Enable</Trans>
                  )}
                </CommitButton>
              </AutoColumn>
            ) : null}
            <AutoColumn gap="md" style={{ flex: '1' }}>
              <CommitButton
                variant={isSuccessfullyMigrated ? 'success' : 'primary'}
                disabled={
                  !v3Amount0Min ||
                  !v3Amount1Min ||
                  invalidRange ||
                  (approval !== ApprovalState.APPROVED && signatureData === null) ||
                  confirmingMigration ||
                  isMigrationPending ||
                  isSuccessfullyMigrated
                }
                onClick={migrate}
              >
                {isSuccessfullyMigrated ? (
                  'Success!'
                ) : isMigrationPending ? (
                  <Dots>
                    <Trans>Migrating</Trans>
                  </Dots>
                ) : (
                  <Trans>Migrate</Trans>
                )}
              </CommitButton>
            </AutoColumn>
          </AutoColumn>
        </AutoColumn>
      </ResponsiveTwoColumns>
    </CardBody>
  )
}
