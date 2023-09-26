import { useCallback, useTransition } from 'react'
import { Currency } from '@pancakeswap/sdk'
import { Field, selectCurrency, switchCurrencies, typeInput, setRecipient } from './actions'
import { useAppDispatch } from '../index'

export function useSwapActionHandlers(): {
  onCurrencySelection: (field: Field, currency: Currency) => void
  onSwitchTokens: () => void
  onUserInput: (field: Field, typedValue: string) => void
  onChangeRecipient: (recipient: string | null) => void
} {
  const [, startTransition] = useTransition()
  const dispatch = useAppDispatch()

  const onSwitchTokens = useCallback(() => {
    dispatch(switchCurrencies())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const onCurrencySelection = useCallback((field: Field, currency: Currency) => {
    dispatch(
      selectCurrency({
        field,
        currencyId: currency?.isToken ? currency.address : currency?.isNative ? currency.symbol : '',
      }),
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const onUserInput = useCallback((field: Field, typedValue: string) => {
    startTransition(() => {
      dispatch(typeInput({ field, typedValue }))
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const onChangeRecipient = useCallback((recipient: string | null) => {
    dispatch(setRecipient({ recipient }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return {
    onSwitchTokens,
    onCurrencySelection,
    onUserInput,
    onChangeRecipient,
  }
}
