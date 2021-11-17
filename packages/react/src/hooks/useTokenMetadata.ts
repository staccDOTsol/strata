import { useWallet } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";
import { ITokenWithMetaAndAccount } from "@strata-foundation/spl-token-collective";
import {
  decodeMetadata,
  getMetadata,
  Metadata,
  SplTokenMetadata,
} from "@strata-foundation/spl-utils";
import { usePublicKey, useStrataSdks } from ".";
import { useAsync } from "react-async-hook";
import { useClaimedTokenRef } from "./tokenRef";
import { useAccount } from "./useAccount";
import { useAssociatedAccount } from "./useAssociatedAccount";
import { useMint } from "./useMint";
import { useMemo } from "react";

export interface IUseTokenMetadataResult extends ITokenWithMetaAndAccount {
  loading: boolean;
  error: Error | undefined;
}

/**
 * Get the token account and all metaplex + token collective metadata around the token
 *
 * @param token
 * @returns
 */
export function useTokenMetadata(
  token: PublicKey | undefined
): IUseTokenMetadataResult {
  const {
    result: metadataAccountKeyStr,
    loading,
    error,
  } = useAsync(
    async (token: string | undefined) =>
      token ? getMetadata(token) : undefined,
    [token?.toBase58()]
  );
  const metadataAccountKey = usePublicKey(metadataAccountKeyStr);
  const parser = useMemo(
    () => (_: any, acct: any) => decodeMetadata(acct.data),
    []
  );

  const { info: metadata, loading: accountLoading } = useAccount(
    metadataAccountKey,
    parser
  );

  const { tokenMetdataSdk: splTokenMetdataSdk } = useStrataSdks();
  const getEditionInfo = splTokenMetdataSdk
    ? splTokenMetdataSdk.getEditionInfo
    : () => Promise.resolve([]);
  const { result: editionInfo } = useAsync(
    async (metadata: Metadata | undefined) =>
      (await splTokenMetdataSdk?.getEditionInfo(metadata)) || [],
    [metadata]
  );

  const wallet = useWallet();
  const { associatedAccount } = useAssociatedAccount(wallet.publicKey, token);
  const {
    result: data,
    loading: dataLoading,
    error: dataError,
  } = useAsync(SplTokenMetadata.getArweaveMetadata, [metadata?.data.uri]);
  const {
    result: image,
    loading: imageLoading,
    error: imageError,
  } = useAsync(SplTokenMetadata.getImage, [metadata?.data.uri]);
  const mint = useMint(token);

  const { info: tokenRef } = useClaimedTokenRef(wallet.publicKey || undefined);
  return {
    tokenRef,
    loading: Boolean(
      token && (loading || accountLoading || dataLoading || imageLoading)
    ),
    error: error || dataError || imageError,
    mint,
    metadata,
    metadataKey: metadataAccountKey,
    data,
    image: image,
    account: associatedAccount,
    description: data?.description,
    publicKey: metadataAccountKey,
    ...editionInfo,
  };
}
