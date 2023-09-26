import { ChainId, Currency } from "@pancakeswap/sdk";
import { useMemo } from "react";
import { WrappedTokenInfo } from "@pancakeswap/token-lists";
import styled from "styled-components";
import { useHttpLocations } from "@pancakeswap/hooks";

import { TokenLogo } from "../TokenLogo";
import { BinanceIcon } from "../Svg";
import { getTokenLogoURL } from "./utils";

const StyledLogo = styled(TokenLogo)<{ size: string }>`
  width: ${({ size }) => size};
  height: ${({ size }) => size};
  border-radius: 50%;
`;

export function CurrencyLogo({
  currency,
  size = "24px",
  style,
}: {
  currency?: Currency;
  size?: string;
  style?: React.CSSProperties;
}) {
  const uriLocations = useHttpLocations(currency instanceof WrappedTokenInfo ? currency.logoURI : undefined);

  const srcs: string[] = useMemo(() => {
    if (currency?.isNative) return [];

    if (currency?.isToken) {
      const tokenLogoURL = getTokenLogoURL(currency);

      if (currency instanceof WrappedTokenInfo) {
        if (!tokenLogoURL) return [...uriLocations];
        return [...uriLocations, tokenLogoURL];
      }
      if (!tokenLogoURL) return [];
      return [tokenLogoURL];
    }
    return [];
  }, [currency, uriLocations]);

  if (currency?.isNative) {
    if (currency.chainId === ChainId.BSC) {
      return <BinanceIcon width={size} style={style} />;
    }
    return (
      <StyledLogo
        size={size}
        srcs={[`https://assets.pancakeswap.finance/web/chains/${currency.chainId}.png`]}
        width={size}
        style={style}
      />
    );
  }

  return <StyledLogo size={size} srcs={srcs} alt={`${currency?.symbol ?? "token"} logo`} style={style} />;
}