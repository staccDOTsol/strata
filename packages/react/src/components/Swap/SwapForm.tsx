import {
  Box,
  Button,
  Center,
  Divider,
  Flex,
  HStack,
  Icon,
  IconButton,
  Input,
  InputGroup,
  InputRightElement,
  Link,
  Menu,
  MenuButton, ScaleFade,
  Text,
  Tooltip,
  VStack
} from "@chakra-ui/react";
import { yupResolver } from "@hookform/resolvers/yup";
import { useWallet } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";
import {
  ITokenBonding,
  SplTokenBonding
} from "@strata-foundation/spl-token-bonding";
import { BondingPricing } from "@strata-foundation/spl-token-bonding/dist/lib/pricing";
import React, { useEffect, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { BsChevronDown } from "react-icons/bs";
import { RiArrowUpDownFill, RiInformationLine } from "react-icons/ri";
import * as yup from "yup";
import { useFtxPayLink, useProvider, useTokenMetadata } from "../../hooks";

export interface ISwapFormValues {
  topAmount: number;
  bottomAmount: number;
  slippage: number;
}

const validationSchema = yup
  .object({
    topAmount: yup.number().required().moreThan(0),
    bottomAmount: yup.number().required().moreThan(0),
    slippage: yup.number().required().moreThan(0),
  })
  .required();

const humanReadablePercentage = (u32: number) => {
  if (u32 && u32 !== 0) {
    return ((u32 / 4294967295) * 100).toFixed(2);
  }
  return 0;
};

export interface ISwapFormProps {
  isSubmitting: boolean;
  onConnectWallet: () => void;
  onFlipTokens: (tokenBonding: PublicKey) => void;
  onBuyBase: (tokenBonding: PublicKey) => void;
  onSubmit: (values: ISwapFormValues) => Promise<void>;
  tokenBonding: ITokenBonding;
  pricing: BondingPricing;
  baseOptions: React.ReactNode; // MenuList
  targetOptions: React.ReactNode; // MenuList
  base: {
    name: string;
    ticker: string;
    icon: React.ReactNode;
    publicKey: PublicKey;
  };
  target: {
    name: string;
    ticker: string;
    icon: React.ReactNode;
    publicKey: PublicKey;
  };
  ownedBase: number;
  spendCap: number;
  feeAmount?: number;
}

function roundToDecimals(num: number, decimals: number): number {
  return Math.trunc(num * Math.pow(10, decimals)) / Math.pow(10, decimals);
}


function Royalties({ tokenBonding, isBuying, formRef }: { tokenBonding: ITokenBonding, isBuying: boolean, formRef: React.MutableRefObject<HTMLInputElement> }) {
  const baseRoyalties = isBuying ? tokenBonding.buyBaseRoyaltyPercentage : tokenBonding.sellBaseRoyaltyPercentage;
  const targetRoyalties = isBuying ? tokenBonding.buyTargetRoyaltyPercentage : tokenBonding.sellTargetRoyaltyPercentage;
  const { metadata: baseMeta } = useTokenMetadata(tokenBonding.baseMint);
  const { metadata: targetMeta } = useTokenMetadata(tokenBonding.targetMint);

  return <>
    { baseRoyalties > 0 && <Flex justify="space-between" alignItems="center">
      <HStack>
        <Text>{baseMeta?.data.symbol} Royalties</Text>
        <Tooltip
          placement="top"
          label={`A percentage of every ${baseMeta?.data.symbol} token minted goes to the person who has claimed this token`}
          portalProps={{ containerRef: formRef }}
        >
          <Flex>
            <Icon
              w={5}
              h={5}
              as={RiInformationLine}
              _hover={{ color: "indigo.500", cursor: "pointer" }}
            />
          </Flex>
        </Tooltip>
      </HStack>
      <Flex>
        {humanReadablePercentage(baseRoyalties)}
        %
      </Flex>
    </Flex> }
    { targetRoyalties > 0 && <Flex justify="space-between" alignItems="center">
      <HStack>
        <Text>{targetMeta?.data.symbol} Royalties</Text>
        <Tooltip
          placement="top"
          label={`A percentage of every ${baseMeta?.data.symbol} token minted goes to the person who has claimed this token`}
          portalProps={{ containerRef: formRef }}
        >
          <Flex>
            <Icon
              w={5}
              h={5}
              as={RiInformationLine}
              _hover={{ color: "indigo.500", cursor: "pointer" }}
            />
          </Flex>
        </Tooltip>
      </HStack>
      <Flex>
        {humanReadablePercentage(targetRoyalties)}
        %
      </Flex>
    </Flex> }
  </>
}

export const SwapForm = ({
  isSubmitting,
  onConnectWallet,
  onFlipTokens,
  onBuyBase,
  onSubmit,
  tokenBonding,
  pricing,
  base,
  target,
  ownedBase,
  spendCap,
  feeAmount,
  baseOptions,
  targetOptions
}: ISwapFormProps) => {
  const formRef = useRef() as React.MutableRefObject<HTMLInputElement>;
  const { connected } = useWallet();
  const { awaitingApproval } = useProvider();
  const ftxPayLink = useFtxPayLink();
  const [rate, setRate] = useState<string>("--");
  const [fee, setFee] = useState<string>("--");
  const {
    register,
    handleSubmit,
    watch,
    reset,
    setValue,
    formState: { errors },
  } = useForm<ISwapFormValues>({
    defaultValues: {
      topAmount: undefined,
      bottomAmount: undefined,
      slippage: 1,
    },
    resolver: yupResolver(validationSchema),
  });
  const isBaseSol = base.publicKey.equals(SplTokenBonding.WRAPPED_SOL_MINT);
  const topAmount = watch("topAmount");
  const slippage = watch("slippage");
  const hasBaseAmount = ownedBase >= +(topAmount || 0);
  const moreThanSpendCap = +(topAmount || 0) > spendCap;

  const lowMint = pricing.hierarchy.lowest(base.publicKey, target.publicKey);
  const highMint = lowMint.equals(base.publicKey) ? target.publicKey : base.publicKey;
  const isBuying = lowMint.equals(target.publicKey);

  const handleConnectWallet = () => onConnectWallet();

  const handleUseMax = () =>
    setValue("topAmount", ownedBase >= spendCap ? spendCap : ownedBase);

  const handleFlipTokens = () => {
    onFlipTokens(tokenBonding.publicKey);
    reset();
  };

  const handleBuyBase = () => {
    if (isBaseSol) {
      window.open(ftxPayLink);
    } else {
      onBuyBase(tokenBonding.publicKey);
    }
  };

  const handleSwap = async (values: ISwapFormValues) => {
    await onSubmit(values);
    reset();
  };

  useEffect(() => {
    if (topAmount && topAmount >= 0 && tokenBonding && pricing) {
      const amount = pricing.swap(+topAmount, base.publicKey, target.publicKey);

      setValue("bottomAmount", roundToDecimals(amount, 9));
      setRate(`${roundToDecimals(amount / topAmount, 9)}`);
      setFee(`${feeAmount}`);
    } else {
      reset({ slippage: slippage });
      setRate("--");
      setFee("--");
    }
  }, [
    topAmount,
    feeAmount,
    setValue,
    setRate,
    tokenBonding,
    pricing,
    slippage,
  ]);

  return (
    <Box ref={formRef} w="full">
      <form onSubmit={handleSubmit(handleSwap)}>
        <VStack spacing={4} padding={4} align="stretch" color="gray.500">
          <Flex flexDir="column">
            <Flex justifyContent="space-between">
              <Text color="gray.600" fontSize="xs">
                You Pay
              </Text>
              <Link color="indigo.500" fontSize="xs" onClick={handleBuyBase}>
                Buy More {base.ticker}
              </Link>
            </Flex>
            <InputGroup size="lg">
              <Input
                isInvalid={!!errors.topAmount}
                isDisabled={!connected}
                id="topAmount"
                borderColor="gray.200"
                placeholder="0"
                type="number"
                fontSize="2xl"
                fontWeight="semibold"
                _placeholder={{ color: "gray.200" }}
                step={0.0000000001}
                min={0}
                {...register("topAmount")}
              />
              <InputRightElement
                w="auto"
                justifyContent="end"
                paddingX={1.5}
                rounded="lg"
              >
                {connected && (
                  <Menu>
                    <MenuButton
                      cursor="pointer"
                      isDisabled={!connected}
                      as={Button}
                      rightIcon={<BsChevronDown />}
                      leftIcon={
                        <Center
                          w={8}
                          h={8}
                          color="white"
                          bg="indigo.500"
                          rounded="full"
                        >
                          {base.icon}
                        </Center>
                      }
                      borderRadius="20px 6px 6px 20px"
                      paddingX={1.5}
                      bgColor="gray.200"
                    >
                      {base.ticker}
                    </MenuButton>
                    { baseOptions }
                    
                  </Menu>
                )}
              </InputRightElement>
            </InputGroup>
          </Flex>
          <HStack
            justify="center"
            alignItems="center"
            position="relative"
            paddingY={2}
          >
            <Divider color="gray.200" />
            <Flex>
              {!connected && (
                <Button
                  size="xs"
                  colorScheme="gray"
                  variant="outline"
                  onClick={handleConnectWallet}
                >
                  Connect Wallet
                </Button>
              )}
              {connected && (
                <Button
                  size="xs"
                  colorScheme="indigo"
                  variant="ghost"
                  onClick={handleUseMax}
                >
                  Use Max ({ownedBase > spendCap ? spendCap : ownedBase}{" "}
                  {base.ticker})
                </Button>
              )}
            </Flex>
            <Divider color="gray.200" />
            <IconButton
              isDisabled={!connected}
              aria-label="Flip Tokens"
              size="sm"
              colorScheme="gray"
              rounded="full"
              position="absolute"
              right={2}
              onClick={handleFlipTokens}
              icon={<Icon as={RiArrowUpDownFill} w={5} h={5} />}
            />
          </HStack>
          <Flex flexDir="column">
            <Text color="gray.600" fontSize="xs">
              You Receive
            </Text>
            <InputGroup size="lg">
              <Input
                isInvalid={!!errors.bottomAmount}
                isReadOnly
                isDisabled={!connected}
                id="bottomAmount"
                borderColor="gray.200"
                placeholder="0"
                type="number"
                fontSize="2xl"
                fontWeight="semibold"
                step={0.0000000001}
                min={0}
                _placeholder={{ color: "gray.200" }}
                _hover={{ cursor: "not-allowed" }}
                _focus={{ outline: "none", borderColor: "gray.200" }}
                {...register("bottomAmount")}
              />
              <InputRightElement
                zIndex={0}
                w="auto"
                justifyContent="end"
                paddingX={1.5}
                rounded="lg"
              >
                {connected && (
                  <Menu>
                    <MenuButton
                      rightIcon={<BsChevronDown />}
                      isDisabled={!connected}
                      as={Button}
                      leftIcon={
                        <Center
                          w={8}
                          h={8}
                          color="white"
                          bg="indigo.500"
                          rounded="full"
                        >
                          {target.icon}
                        </Center>
                      }
                      borderRadius="20px 6px 6px 20px"
                      paddingX={1.5}
                      bgColor="gray.200"
                    >
                      {target.ticker}
                    </MenuButton>
                    { targetOptions }
                  </Menu>
                )}
              </InputRightElement>
            </InputGroup>
          </Flex>
          <VStack
            spacing={1}
            padding={4}
            align="stretch"
            color="gray.400"
            borderColor="gray.200"
            borderWidth="1px"
            rounded="lg"
            fontSize="sm"
          >
            <Flex justify="space-between" alignItems="center">
              <Text>Rate</Text>
              <Text>
                {rate !== "--"
                  ? `1 ${base.ticker} ≈ ${rate} ${target.ticker}`
                  : rate}
              </Text>
            </Flex>
            <Flex justify="space-between" alignItems="center">
              <HStack>
                <Text>Slippage</Text>
                <Tooltip
                  isDisabled={!connected}
                  placement="top"
                  label="Your transaction will fail if the price changes unfavorably more than this percentage."
                  portalProps={{ containerRef: formRef }}
                >
                  <Flex>
                    <Icon
                      w={5}
                      h={5}
                      as={RiInformationLine}
                      _hover={{ color: "indigo.500", cursor: "pointer" }}
                    />
                  </Flex>
                </Tooltip>
              </HStack>
              <InputGroup size="sm" w="60px">
                <Input
                  isInvalid={!!errors.slippage}
                  isDisabled={!connected}
                  id="slippage"
                  borderColor="gray.200"
                  textAlign="right"
                  rounded="lg"
                  placeholder="0"
                  type="number"
                  fontWeight="semibold"
                  step={1}
                  min={1}
                  max={90}
                  paddingRight={5}
                  paddingLeft={1}
                  {...register("slippage")}
                />
                <InputRightElement
                  w={4}
                  justifyContent="end"
                  paddingRight={1.5}
                  rounded="lg"
                >
                  <Text margin={0}>%</Text>
                </InputRightElement>
              </InputGroup>
            </Flex>
            <Flex justify="space-between" alignItems="center">
              <Text>Estimated Fees</Text>
              <Flex>{fee}</Flex>
            </Flex>
            { pricing.hierarchy.path(base.publicKey, target.publicKey).map(h => 
              <Royalties formRef={formRef} tokenBonding={h.tokenBonding} isBuying={isBuying} />
            )}
          </VStack>
          <Box position="relative">
            <ScaleFade
              initialScale={0.9}
              in={!hasBaseAmount || moreThanSpendCap}
            >
              <Center
                bgColor="gray.500"
                rounded="md"
                paddingY={2}
                color="white"
                w="full"
                position="absolute"
                top={-10}
                fontSize="sm"
              >
                {moreThanSpendCap && (
                  <Text>
                    Spend Cap is {spendCap} {base.ticker}. Please adjust amount
                  </Text>
                )}
                {!moreThanSpendCap && (
                  <Text>
                    Insufficent funds for this trade.{" "}
                    <Text as="u">
                      <Link
                        color="indigo.100"
                        _hover={{ color: "indigo.200" }}
                        onClick={handleBuyBase}
                      >
                        {`Buy more now.`}
                      </Link>
                    </Text>
                  </Text>
                )}
              </Center>
            </ScaleFade>
            <Button
              isDisabled={!connected || !hasBaseAmount || moreThanSpendCap}
              w="full"
              colorScheme="indigo"
              size="lg"
              type="submit"
              isLoading={awaitingApproval || isSubmitting}
              loadingText={
                awaitingApproval
                  ? "Awaiting Approval"
                  : "Swapping"
              }
            >
              Trade
            </Button>
          </Box>
        </VStack>
      </form>
    </Box>
  );
};
