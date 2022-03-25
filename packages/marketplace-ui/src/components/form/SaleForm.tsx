import {
  Alert,
  Box,
  Button,
  Collapse,
  Flex,
  Icon,
  Input,
  useDisclosure,
  VStack,
} from "@chakra-ui/react";
import { yupResolver } from "@hookform/resolvers/yup";
import { DataV2, Metadata } from "@metaplex-foundation/mpl-token-metadata";
import { NATIVE_MINT } from "@solana/spl-token";
import { useWallet } from "@solana/wallet-adapter-react";
import { Keypair, PublicKey } from "@solana/web3.js";
import {
  FIXED_CURVE_FEES,
  MarketplaceSdk,
} from "@strata-foundation/marketplace-sdk";
import {
  usePrimaryClaimedTokenRef,
  useProvider,
} from "@strata-foundation/react";
import {
  getMintInfo,
  sendMultipleInstructions,
} from "@strata-foundation/spl-utils";
import { useRouter } from "next/router";
import React from "react";
import { useAsyncCallback } from "react-async-hook";
import { FormProvider, useForm } from "react-hook-form";
import { BsChevronDown } from "react-icons/bs";
import * as yup from "yup";
import { useMarketplaceSdk } from "../../contexts/marketplaceSdkContext";
import { NFT_STORAGE_API_KEY } from "../../constants";
import { route, routes } from "../../utils/routes";
import { Disclosures, disclosuresSchema, IDisclosures } from "./Disclosures";
import { FormControlWithError } from "./FormControlWithError";
import { MintSelect } from "./MintSelect";
import { IMetadataFormProps, TokenMetadataInputs } from "./TokenMetadataInputs";
import {
  IUseExistingMintProps,
  UseExistingMintInputs,
} from "./UseExistingMintInputs";

interface IMarketplaceFormProps
  extends IMetadataFormProps,
    IUseExistingMintProps {
  mint: string;
  quantity: number;
  price: number;
  curve: string;
  decimals?: number;
  disclosures: IDisclosures;
}

const validationSchema = yup.object({
  useExistingMint: yup.boolean(),
  existingMint: yup.string().when("useExistingMint", {
    is: true,
    then: yup.string().required(),
  }),
  decimals: yup
    .number()
    .nullable()
    .transform((v) => {
      return v === "" || isNaN(v) ? null : v;
    })
    .when("useExistingMint", {
      is: false,
      then: yup.number().min(0).required(),
    }),
  mint: yup.string().required(),
  image: yup.mixed(),
  name: yup.string().when("useExistingMint", {
    is: false,
    then: yup.string().required().min(2),
  }),
  description: yup.string().when("useExistingMint", {
    is: false,
    then: yup.string().required().min(2),
  }),
  quantity: yup.number().required().min(1).integer(),
  price: yup.number().required().min(0),
  curve: yup.string(),
  disclosures: disclosuresSchema,
});

async function createMarket(
  marketplaceSdk: MarketplaceSdk,
  values: IMarketplaceFormProps,
  nftStorageApiKey: string | undefined = NFT_STORAGE_API_KEY
): Promise<PublicKey> {
  const mint = new PublicKey(values.mint);

  const targetMintKeypair = Keypair.generate();
  let metadata;
  if (values.useExistingMint) {
    const existingMint = new PublicKey(values.existingMint!);
    const fetched = await marketplaceSdk.tokenMetadataSdk.getMetadata(
      await Metadata.getPDA(existingMint)
    );
    if (!fetched) {
      throw new Error("Existing mint must have metaplex token metadata");
    }

    values.decimals = (
      await getMintInfo(marketplaceSdk.provider, existingMint)
    ).decimals;

    metadata = new DataV2({ ...fetched.data, collection: null, uses: null });
  } else {
    const uri = await marketplaceSdk.tokenMetadataSdk.uploadMetadata({
      provider: values.provider,
      name: values.name!,
      symbol: "",
      description: values.description,
      image: values.image,
      mint: targetMintKeypair.publicKey,
      attributes: [
        {
          trait_type: "is_strata_sale",
          display_type: "Strata Sale",
          value: "true",
        },
      ],
      nftStorageApiKey,
    });
    metadata = new DataV2({
      // Max name len 32
      name: values.name!.substring(0, 32),
      symbol: "",
      uri,
      sellerFeeBasisPoints: 0,
      creators: null,
      collection: null,
      uses: null,
    });
  }

  const instructions = [];
  const signers = [];
  const marketItemInstrs = await marketplaceSdk.createMarketItemInstructions({
    targetMintKeypair,
    metadata,
    quantity: values.quantity,
    price: values.price,
    baseMint: mint,
    bondingArgs: {
      curve: values.curve ? new PublicKey(values.curve) : undefined,
      targetMintDecimals: values.decimals,
    },
  });
  instructions.push(...marketItemInstrs.instructions);
  signers.push(...marketItemInstrs.signers);

  if (values.useExistingMint) {
    const retrievalInstrs =
      await marketplaceSdk.createRetrievalCurveForSetSupplyInstructions({
        reserveAuthority: marketplaceSdk.provider.wallet.publicKey,
        supplyMint: new PublicKey(values.existingMint!),
        supplyAmount: values.quantity,
        targetMint: targetMintKeypair.publicKey,
      });
    instructions.push(retrievalInstrs.instructions);
    signers.push(retrievalInstrs.signers);
  }

  await sendMultipleInstructions(
    marketplaceSdk.tokenBondingSdk.errors || new Map(),
    marketplaceSdk.provider,
    instructions,
    signers
  );

  return targetMintKeypair.publicKey;
}

export const SaleForm: React.FC<{
  nftStorageApiKey?: string;
}> = ({ nftStorageApiKey = NFT_STORAGE_API_KEY }) => {
  const formProps = useForm<IMarketplaceFormProps>({
    resolver: yupResolver(validationSchema),
  });
  const {
    register,
    handleSubmit,
    setValue,
    formState: { errors, isSubmitting },
    watch,
  } = formProps;
  const { publicKey } = useWallet();
  const { info: tokenRef } = usePrimaryClaimedTokenRef(publicKey);
  const { awaitingApproval } = useProvider();
  const { execute, loading, error } = useAsyncCallback(createMarket);
  const { marketplaceSdk } = useMarketplaceSdk();
  const router = useRouter();
  const { isOpen, onToggle } = useDisclosure();

  const onSubmit = async (values: IMarketplaceFormProps) => {
    const mintKey = await execute(marketplaceSdk!, values, nftStorageApiKey);
    router.push(
      route(values.decimals === 0 ? routes.sale : routes.tokenOffering, {
        mintKey: mintKey.toBase58(),
      }),
      undefined,
      { shallow: true }
    );
  };

  const useExistingMint = watch("useExistingMint");

  return (
    <FormProvider {...formProps}>
      <form onSubmit={handleSubmit(onSubmit)}>
        <VStack spacing={8}>
          <UseExistingMintInputs />
          <Box w="full">
            <Collapse in={!useExistingMint} animateOpacity>
              <VStack spacing={8}>
                <TokenMetadataInputs entityName="token" />
                <FormControlWithError
                  id="decimals"
                  help="The number of decimals on this mint"
                  label="Mint Decimals"
                  errors={errors}
                >
                  <Input
                    type="number"
                    min={0}
                    step={0.000000000001}
                    {...register("decimals")}
                  />
                </FormControlWithError>
              </VStack>
            </Collapse>
          </Box>
          <FormControlWithError
            id="quantity"
            help="The quantity to stop selling at"
            label="Quantity"
            errors={errors}
          >
            <Input type="number" min={1} step={1} {...register("quantity")} />
          </FormControlWithError>
          <FormControlWithError
            id="mint"
            help={`The mint that should be used to purchase this, example ${NATIVE_MINT.toBase58()}`}
            label="Purchase Mint"
            errors={errors}
          >
            {tokenRef && (
              <Button
                variant="link"
                onClick={() => setValue("mint", tokenRef.mint.toBase58())}
              >
                Use my Social Token
              </Button>
            )}
            <MintSelect
              value={watch("mint")}
              onChange={(s) => setValue("mint", s)}
            />{" "}
          </FormControlWithError>
          <FormControlWithError
            id="price"
            help="The price of the item"
            label="Price"
            errors={errors}
          >
            <Input
              type="number"
              min={0}
              step={0.0000000001}
              {...register("price")}
            />
          </FormControlWithError>

          <Disclosures fees={FIXED_CURVE_FEES} />

          <Flex alignItems="flex-start" direction="column" w="full">
            <Button
              textAlign="left"
              rightIcon={<Icon as={BsChevronDown} />}
              variant="link"
              onClick={onToggle}
            >
              Advanced Settings
            </Button>
            <Box w="full">
              <Collapse in={isOpen} animateOpacity>
                <FormControlWithError
                  id="curve"
                  help="The pricing curve to use for this item"
                  label="Curve"
                  errors={errors}
                >
                  <Input {...register("curve")} />
                </FormControlWithError>
              </Collapse>
            </Box>
          </Flex>

          {error && (
            <Alert status="error">
              <Alert status="error">{error.toString()}</Alert>
            </Alert>
          )}

          <Button
            type="submit"
            alignSelf="flex-end"
            colorScheme="primary"
            isLoading={isSubmitting || loading}
            loadingText={awaitingApproval ? "Awaiting Approval" : "Loading"}
          >
            Create Sale
          </Button>
        </VStack>
      </form>
    </FormProvider>
  );
};
