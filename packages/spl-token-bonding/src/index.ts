import * as anchor from "@wum.bo/anchor";
import {
  SYSVAR_CLOCK_PUBKEY,
  SYSVAR_RENT_PUBKEY,
  Account,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  Signer,
  SystemInstruction,
  Keypair,
} from "@solana/web3.js";
import {
  getMintInfo,
  createMintInstructions,
  createTokenAccountInstrs,
  connection,
} from "@project-serum/common";
import BN, { max } from "bn.js";
import { Program, IdlTypes, TypesCoder } from "@wum.bo/anchor";
import {
  SplTokenBondingIDL,
  TokenBondingV0,
  SplTokenBondingIDLJson,
} from "./generated/spl-token-bonding";
import {
  AccountLayout,
  NATIVE_MINT,
  MintInfo,
  TOKEN_PROGRAM_ID,
  Token,
  ASSOCIATED_TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import {
  amountAsNum,
  asDecimal,
  LogCurveV0,
  startFinishLogCurve,
  supplyAsNum,
  targetToBaseLogCurve,
} from "./pricing";

export * from "./generated/spl-token-bonding";

type InitializeLogCurveV0Args = IdlTypes<SplTokenBondingIDL>["InitializeLogCurveV0Args"];

interface LogCurveDefaults {
  g: BN;
  c: BN;
  taylorIterations: number;
}

interface InitializeLogCurveArgs extends LogCurveDefaults {
  payer?: PublicKey;
}

interface CreateTokenBondingArgs {
  payer?: PublicKey;
  curve: PublicKey;
  baseMint: PublicKey;
  targetMint?: PublicKey; // If not provided, will create one with `targetMintDecimals`
  targetMintDecimals?: number; // If target mint not provded, create with these decimals
  baseRoyalties?: PublicKey; // If not provided, create an Associated Token Account with baseRoyaltiesOwner
  baseRoyaltiesOwner?: PublicKey; // If base royalties not provided, will create it with this owner. Otherwise, will use wallet.publicKey
  targetRoyalties?: PublicKey; // If not provided, create an Associated Token Account with targetRoyaltiesOwner
  targetRoyaltiesOwner?: PublicKey; // If target royalties not provided, will create it with this owner. Otherwise, will use wallet.publicKey
  authority?: PublicKey;
  baseRoyaltyPercentage: number;
  targetRoyaltyPercentage: number;
  mintCap?: BN;
  buyFrozen?: boolean;
}

interface UpdateTokenBondingArgs {
  tokenBonding: PublicKey;
  baseRoyaltyPercentage?: number;
  targetRoyaltyPercentage?: number;
  authority?: PublicKey | null;
  buyFrozen?: boolean;
}

interface InstructionResult<A> {
  instructions: TransactionInstruction[];
  signers: Signer[];
  output: A;
}

interface BuyV0Args {
  tokenBonding: PublicKey;
  source?: PublicKey; // Will use ATA of sourceAuthority if not provided
  destination?: PublicKey; // Will use ATA of sourceAuthority if not provided
  sourceAuthority?: PublicKey; // Wallet public key if not provided
  desiredTargetAmount: BN;
  slippage: number; // Decimal number. max price will be (1 + slippage) * price_for_desired_target_amount
}

interface SellV0Args {
  tokenBonding: PublicKey;
  source?: PublicKey; // Will use ATA of sourceAuthority if not provided
  destination?: PublicKey; // Will use ATA of sourceAuthority if not provided
  sourceAuthority?: PublicKey; // Wallet public key if not provided
  targetAmount: BN;
  slippage: number; // Decimal number. max price will be (1 + slippage) * price_for_desired_target_amount
}

export class SplTokenBonding {
  program: Program<SplTokenBondingIDL>;

  constructor(program: Program<SplTokenBondingIDL>) {
    this.program = program;
  }

  get provider() {
    return this.program.provider;
  }

  get programId() {
    return this.program.programId;
  }

  get rpc() {
    return this.program.rpc;
  }

  get instruction() {
    return this.program.instruction;
  }

  get wallet() {
    return this.provider.wallet;
  }

  get account() {
    return this.program.account;
  }

  get defaults(): {
    baseRoyaltyPercentage: number;
    targetRoyaltyPercentage: number;
    targetMintDecimals: number;
    mintCap: null;
    buyFrozen: boolean;
  } {
    return {
      baseRoyaltyPercentage: 5,
      targetRoyaltyPercentage: 10,
      targetMintDecimals: 9,
      mintCap: null,
      buyFrozen: false,
    };
  }

  sendInstructions(instructions: TransactionInstruction[], signers: Signer[]): Promise<string> {
    const tx = new Transaction();
    tx.add(...instructions);
    return this.provider.send(tx, signers);
  }

  async initializeLogCurveInstructions({
    payer = this.wallet.publicKey,
    g,
    c,
    taylorIterations,
  }: InitializeLogCurveArgs): Promise<InstructionResult<{ curve: PublicKey }>> {
    const args: InitializeLogCurveV0Args = {
      g,
      c,
      taylorIterations,
    };

    const curveKeypair = anchor.web3.Keypair.generate();
    const curve = curveKeypair.publicKey;

    return {
      output: {
        curve,
      },
      signers: [curveKeypair],
      instructions: [
        SystemProgram.createAccount({
          fromPubkey: payer,
          newAccountPubkey: curve,
          space: 500,
          lamports: await this.provider.connection.getMinimumBalanceForRentExemption(500),
          programId: this.programId,
        }),
        await this.instruction.createLogCurveV0(args, {
          accounts: {
            payer,
            curve,
            systemProgram: SystemProgram.programId,
            rent: SYSVAR_RENT_PUBKEY,
          },
        }),
      ],
    };
  }

  async initializeLogCurve(args: InitializeLogCurveArgs): Promise<PublicKey> {
    const {
      output: { curve },
      instructions,
      signers,
    } = await this.initializeLogCurveInstructions(args);
    if (instructions.length == 0) {
      return curve;
    }

    await this.sendInstructions(instructions, signers);
    return curve;
  }

  async createTokenBondingInstructions({
    authority = this.wallet.publicKey,
    payer = this.wallet.publicKey,
    curve,
    baseMint,
    targetMint,
    baseRoyalties,
    baseRoyaltiesOwner = this.wallet.publicKey,
    targetRoyalties,
    targetRoyaltiesOwner = this.wallet.publicKey,
    baseRoyaltyPercentage,
    targetRoyaltyPercentage,
    mintCap,
    targetMintDecimals,
    buyFrozen = false,
  }: CreateTokenBondingArgs): Promise<InstructionResult<{ tokenBonding: PublicKey }>> {
    if (!targetMint) {
      if (targetRoyalties) {
        throw new Error("Cannot define target royalties if mint is not defined");
      }

      if (!targetMintDecimals) {
        throw new Error("Cannot define mint without decimals ");
      }
    }
    const programId = this.programId;
    const provider = this.provider;

    const instructions: TransactionInstruction[] = [];
    const signers = [];
    let shouldCreateMint = false;
    if (!targetMint) {
      const targetMintKeypair = anchor.web3.Keypair.generate();
      signers.push(targetMintKeypair);
      targetMint = targetMintKeypair.publicKey;
      shouldCreateMint = true;
    }

    const [targetMintAuthority, targetMintAuthorityBumpSeed] = await PublicKey.findProgramAddress(
      [Buffer.from("target-authority", "utf-8"), targetMint.toBuffer()],
      programId
    );

    if (shouldCreateMint) {
      instructions.push(
        ...(await createMintInstructions(
          provider,
          targetMintAuthority,
          targetMint,
          targetMintDecimals
        ))
      );
    }

    const [tokenBonding, bumpSeed] = await PublicKey.findProgramAddress(
      [Buffer.from("token-bonding", "utf-8"), targetMint.toBuffer()],
      programId
    );

    const [baseStorage, baseStorageBumpSeed] = await PublicKey.findProgramAddress(
      [Buffer.from("base-storage", "utf-8"), tokenBonding.toBuffer()],
      programId
    );

    const [baseStorageAuthority, baseStorageAuthorityBumpSeed] = await PublicKey.findProgramAddress(
      [Buffer.from("storage-authority", "utf-8"), baseStorage.toBuffer()],
      programId
    );

    if (!targetRoyalties) {
      targetRoyalties = await Token.getAssociatedTokenAddress(
        ASSOCIATED_TOKEN_PROGRAM_ID,
        TOKEN_PROGRAM_ID,
        targetMint,
        targetRoyaltiesOwner
      );

      if (!(await this.accountExists(targetRoyalties))) {
        console.log("Creating target royalties...");
        instructions.push(
          Token.createAssociatedTokenAccountInstruction(
            ASSOCIATED_TOKEN_PROGRAM_ID,
            TOKEN_PROGRAM_ID,
            targetMint,
            targetRoyalties,
            targetRoyaltiesOwner,
            payer
          )
        );
      }
    }

    if (!baseRoyalties) {
      baseRoyalties = await Token.getAssociatedTokenAddress(
        ASSOCIATED_TOKEN_PROGRAM_ID,
        TOKEN_PROGRAM_ID,
        baseMint,
        baseRoyaltiesOwner
      );

      if (!(await this.accountExists(baseRoyalties))) {
        console.log("Creating base royalties...");
        instructions.push(
          Token.createAssociatedTokenAccountInstruction(
            ASSOCIATED_TOKEN_PROGRAM_ID,
            TOKEN_PROGRAM_ID,
            baseMint,
            baseRoyalties,
            baseRoyaltiesOwner,
            payer
          )
        );
      }
    }

    instructions.push(
      await this.instruction.initializeTokenBondingV0(
        {
          baseRoyaltyPercentage,
          targetRoyaltyPercentage,
          mintCap,
          tokenBondingAuthority: authority,
          bumpSeed,
          baseStorageBumpSeed,
          baseStorageAuthorityBumpSeed,
          targetMintAuthorityBumpSeed,
          buyFrozen,
        },
        {
          accounts: {
            payer: payer,
            curve,
            tokenBonding,
            baseMint: baseMint,
            targetMint: targetMint,
            baseStorage,
            baseStorageAuthority,
            baseRoyalties,
            targetRoyalties,
            tokenProgram: TOKEN_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
            rent: SYSVAR_RENT_PUBKEY,
          },
        }
      )
    );

    return {
      output: {
        tokenBonding,
      },
      instructions,
      signers,
    };
  }

  async accountExists(account: anchor.web3.PublicKey): Promise<boolean> {
    return Boolean(await this.provider.connection.getAccountInfo(account));
  }

  async createTokenBonding(args: CreateTokenBondingArgs): Promise<PublicKey> {
    const {
      output: { tokenBonding },
      instructions,
      signers,
    } = await this.createTokenBondingInstructions(args);
    await this.sendInstructions(instructions, signers);
    return tokenBonding;
  }

  async updateTokenBondingInstructions({
    tokenBonding,
    baseRoyaltyPercentage,
    targetRoyaltyPercentage,
    authority,
    buyFrozen,
  }: UpdateTokenBondingArgs): Promise<InstructionResult<null>> {
    const tokenBondingAcct = await this.account.tokenBondingV0.fetch(tokenBonding);
    if (!tokenBondingAcct.authority) {
      throw new Error("Cannot update a token bonding account that has no authority");
    }

    const args: IdlTypes<SplTokenBondingIDL>["UpdateTokenBondingV0Args"] = {
      baseRoyaltyPercentage: baseRoyaltyPercentage || tokenBondingAcct.baseRoyaltyPercentage,
      targetRoyaltyPercentage: targetRoyaltyPercentage || tokenBondingAcct.targetRoyaltyPercentage,
      tokenBondingAuthority: authority === null ? null : authority || tokenBondingAcct.authority,
      buyFrozen: typeof buyFrozen === "undefined" ? tokenBondingAcct.buyFrozen : buyFrozen,
    };

    return {
      output: null,
      signers: [],
      instructions: [
        await this.instruction.updateTokenBondingV0(args, {
          accounts: {
            tokenBonding,
            authority: (tokenBondingAcct.authority as PublicKey)!,
          },
        }),
      ],
    };
  }

  async updateTokenBonding(args: UpdateTokenBondingArgs): Promise<void> {
    const { instructions, signers } = await this.updateTokenBondingInstructions(args);
    await this.sendInstructions(instructions, signers);
  }

  async createTemporaryWSolAccount({
    payer,
    owner,
    amount,
  }: {
    owner: PublicKey;
    payer: PublicKey;
    amount: number;
  }): Promise<{
    signer: Keypair;
    firstInstructions: TransactionInstruction[];
    lastInstructions: TransactionInstruction[];
  }> {
    const balanceNeeded = await Token.getMinBalanceRentForExemptAccount(this.provider.connection);

    // Create a new account
    const newAccount = anchor.web3.Keypair.generate();

    return {
      firstInstructions: [
        SystemProgram.createAccount({
          fromPubkey: payer,
          newAccountPubkey: newAccount.publicKey,
          lamports: balanceNeeded + amount,
          space: AccountLayout.span,
          programId: TOKEN_PROGRAM_ID,
        }),
        Token.createInitAccountInstruction(
          TOKEN_PROGRAM_ID,
          NATIVE_MINT,
          newAccount.publicKey,
          owner
        ),
      ],
      lastInstructions: [
        Token.createCloseAccountInstruction(
          TOKEN_PROGRAM_ID,
          newAccount.publicKey,
          owner,
          owner,
          []
        ),
      ],
      signer: newAccount,
    };
  }

  async buyV0Instructions({
    tokenBonding,
    source,
    sourceAuthority = this.wallet.publicKey,
    destination,
    desiredTargetAmount,
    slippage,
  }: BuyV0Args): Promise<InstructionResult<null>> {
    const tokenBondingAcct = await this.account.tokenBondingV0.fetch(tokenBonding);
    // @ts-ignore
    const curve = await this.getLogCurve(tokenBondingAcct.curve);
    const targetMint = await getMintInfo(this.provider, tokenBondingAcct.targetMint);
    const baseMint = await getMintInfo(this.provider, tokenBondingAcct.baseMint);
    const targetMintAuthority = await PublicKey.createProgramAddress(
      [
        Buffer.from("target-authority", "utf-8"),
        tokenBondingAcct.targetMint.toBuffer(),
        new BN(tokenBondingAcct.targetMintAuthorityBumpSeed).toBuffer(),
      ],
      this.programId
    );

    const instructions = [];
    const signers = [];
    if (!destination) {
      destination = await Token.getAssociatedTokenAddress(
        ASSOCIATED_TOKEN_PROGRAM_ID,
        TOKEN_PROGRAM_ID,
        tokenBondingAcct.targetMint,
        sourceAuthority
      );

      if (!(await this.accountExists(destination))) {
        console.log("Creating target account");
        instructions.push(
          Token.createAssociatedTokenAccountInstruction(
            ASSOCIATED_TOKEN_PROGRAM_ID,
            TOKEN_PROGRAM_ID,
            tokenBondingAcct.targetMint,
            destination,
            sourceAuthority,
            sourceAuthority
          )
        );
      }
    }

    const desiredTargetAmountNum = amountAsNum(desiredTargetAmount, targetMint);
    const neededAmount =
      desiredTargetAmountNum * (1 / (1 - asDecimal(tokenBondingAcct.targetRoyaltyPercentage)));
    const logCurveAmount = targetToBaseLogCurve(
      curve,
      targetMint,
      tokenBondingAcct.baseRoyaltyPercentage,
      tokenBondingAcct.targetRoyaltyPercentage
    )(neededAmount);
    const maxPrice = Math.ceil(logCurveAmount * (1 + slippage) * Math.pow(10, baseMint.decimals));

    let lastInstructions = [];
    if (!source) {
      if (tokenBondingAcct.baseMint.toBase58() === NATIVE_MINT.toBase58()) {
        const {
          signer,
          firstInstructions,
          lastInstructions: lastInstrs,
        } = await this.createTemporaryWSolAccount({
          payer: sourceAuthority,
          owner: sourceAuthority,
          amount: maxPrice,
        });
        source = signer.publicKey;
        signers.push(signer);
        instructions.push(...firstInstructions);
        lastInstructions.push(...lastInstrs);
      } else {
        source = await Token.getAssociatedTokenAddress(
          ASSOCIATED_TOKEN_PROGRAM_ID,
          TOKEN_PROGRAM_ID,
          tokenBondingAcct.baseMint,
          sourceAuthority
        );

        if (!(await this.accountExists(source))) {
          throw new Error("Source account does not exist");
        }
      }
    }

    const args: IdlTypes<SplTokenBondingIDL>["BuyV0Args"] = {
      targetAmount: new BN(Math.floor(neededAmount * Math.pow(10, targetMint.decimals))),
      maximumPrice: new BN(maxPrice),
    };
    const accounts = {
      accounts: {
        tokenBonding,
        // @ts-ignore
        curve: tokenBondingAcct.curve,
        baseMint: tokenBondingAcct.baseMint,
        targetMint: tokenBondingAcct.targetMint,
        targetMintAuthority,
        baseStorage: tokenBondingAcct.baseStorage,
        baseRoyalties: tokenBondingAcct.baseRoyalties,
        targetRoyalties: tokenBondingAcct.targetRoyalties,
        source,
        sourceAuthority,
        destination,
        tokenProgram: TOKEN_PROGRAM_ID,
      },
    };
    instructions.push(await this.instruction.buyV0(args, accounts));
    instructions.push(...lastInstructions);

    return {
      output: null,
      signers,
      instructions,
    };
  }

  async buyV0(args: BuyV0Args): Promise<void> {
    const { instructions, signers } = await this.buyV0Instructions(args);
    await this.sendInstructions(instructions, signers);
  }

  async sellV0Instructions({
    tokenBonding,
    source,
    sourceAuthority = this.wallet.publicKey,
    destination,
    targetAmount,
    slippage,
  }: SellV0Args): Promise<InstructionResult<null>> {
    const tokenBondingAcct = await this.account.tokenBondingV0.fetch(tokenBonding);
    // @ts-ignore
    const curve = await this.getLogCurve(tokenBondingAcct.curve);
    const targetMint = await getMintInfo(this.provider, tokenBondingAcct.targetMint);

    const baseStorageAuthority = await PublicKey.createProgramAddress(
      [
        Buffer.from("storage-authority", "utf-8"),
        tokenBondingAcct.baseStorage.toBuffer(),
        new BN(tokenBondingAcct.baseStorageAuthorityBumpSeed).toBuffer(),
      ],
      this.programId
    );

    const instructions = [];
    const signers = [];
    if (!source) {
      source = await Token.getAssociatedTokenAddress(
        ASSOCIATED_TOKEN_PROGRAM_ID,
        TOKEN_PROGRAM_ID,
        tokenBondingAcct.targetMint,
        sourceAuthority
      );

      if (!(await this.accountExists(source))) {
        throw new Error("Source account does not exist");
      }
    }

    const lastInstructions = [];
    if (!destination) {
      if (tokenBondingAcct.baseMint.toBase58() === NATIVE_MINT.toBase58()) {
        const {
          signer,
          firstInstructions,
          lastInstructions: lastInstrs,
        } = await this.createTemporaryWSolAccount({
          payer: sourceAuthority,
          owner: sourceAuthority,
          amount: 0,
        });
        destination = signer.publicKey;
        signers.push(signer);
        instructions.push(...firstInstructions);
        lastInstructions.push(...lastInstrs);
      } else {
        destination = await Token.getAssociatedTokenAddress(
          ASSOCIATED_TOKEN_PROGRAM_ID,
          TOKEN_PROGRAM_ID,
          tokenBondingAcct.baseMint,
          sourceAuthority
        );

        if (!(await this.accountExists(destination))) {
          console.log("Creating base account");
          instructions.push(
            Token.createAssociatedTokenAccountInstruction(
              ASSOCIATED_TOKEN_PROGRAM_ID,
              TOKEN_PROGRAM_ID,
              tokenBondingAcct.baseMint,
              destination,
              sourceAuthority,
              sourceAuthority
            )
          );
        }
      }
    }

    const targetAmountNum = amountAsNum(targetAmount, targetMint);
    const reclaimedAmount = startFinishLogCurve(curve)(
      supplyAsNum(targetMint) - targetAmountNum,
      targetAmountNum
    );
    const minPrice = Math.ceil(
      reclaimedAmount * (1 - slippage) * Math.pow(10, targetMint.decimals)
    );
    const args: IdlTypes<SplTokenBondingIDL>["SellV0Args"] = {
      targetAmount,
      minimumPrice: new BN(minPrice),
    };
    const accounts = {
      accounts: {
        tokenBonding,
        // @ts-ignore
        curve: tokenBondingAcct.curve,
        baseMint: tokenBondingAcct.baseMint,
        targetMint: tokenBondingAcct.targetMint,
        baseStorage: tokenBondingAcct.baseStorage,
        baseStorageAuthority,
        source,
        sourceAuthority,
        destination,
        tokenProgram: TOKEN_PROGRAM_ID,
      },
    };
    instructions.push(await this.instruction.sellV0(args, accounts));
    instructions.push(...lastInstructions);

    return {
      output: null,
      signers,
      instructions,
    };
  }

  async sellV0(args: SellV0Args): Promise<void> {
    const { instructions, signers } = await this.sellV0Instructions(args);
    await this.sendInstructions(instructions, signers);
  }

  async getLogCurve(key: PublicKey): Promise<LogCurveV0> {
    // @ts-ignore
    return (await this.account.curveV0.fetch(key)).curve.logCurveV0 as LogCurveV0;
  }
}
