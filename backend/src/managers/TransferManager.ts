import { address, AccountRole, createSolanaRpc } from '@solana/kit';
import type { TransactionSigner, Address, Rpc, SolanaRpcApi } from '@solana/kit';
import {
  findAssociatedTokenPda,
  getCreateAssociatedTokenIdempotentInstruction,
  getTransferCheckedInstruction,
  TOKEN_PROGRAM_ADDRESS,
} from '@solana-program/token';
import {
  TOKEN_2022_PROGRAM_ADDRESS,
  findAssociatedTokenPda as findAssociatedTokenPda2022,
  getTransferCheckedInstruction as getTransferCheckedInstruction2022,
  getCreateAssociatedTokenIdempotentInstruction as getCreateAssociatedTokenIdempotentInstruction2022,
} from '@solana-program/token-2022';
import { getTransferSolInstruction } from '@solana-program/system';
import type { SerializedInstruction } from '../types';

const SOL_MINT = 'So11111111111111111111111111111111111111112';

const rpcUrl = process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';
const rpc: Rpc<SolanaRpcApi> = createSolanaRpc(rpcUrl);

export class TransferManager {
  /**
   * Determine the token program for a given mint by checking the onchain account owner.
   */
  private async getTokenProgram(mint: string): Promise<Address> {
    const accountInfo = await rpc.getAccountInfo(address(mint), { encoding: 'base64' }).send();
    const owner = accountInfo.value?.owner;

    if (owner === TOKEN_2022_PROGRAM_ADDRESS) {
      return TOKEN_2022_PROGRAM_ADDRESS;
    }
    return TOKEN_PROGRAM_ADDRESS;
  }

  /**
   * Build serialized instructions for a token transfer.
   * - SOL: single SystemProgram.transferSol instruction
   * - SPL tokens: create destination ATA (idempotent) + transferChecked
   * - Automatically detects Token vs Token-2022 mints
   */
  async getTransferInstructions(
    mint: string,
    amount: string,
    ownerAddress: string,
    destinationAddress: string,
    decimals: number,
  ): Promise<SerializedInstruction[]> {
    const owner = address(ownerAddress);
    const destination = address(destinationAddress);
    const signer = this.createNoopSigner(ownerAddress);

    if (mint === SOL_MINT) {
      const ix = getTransferSolInstruction({
        source: signer,
        destination,
        amount: BigInt(amount),
      });
      return [this.kitIxToSerialized(ix)];
    }

    // Detect token program
    const tokenProgram = await this.getTokenProgram(mint);
    const isToken2022 = tokenProgram === TOKEN_2022_PROGRAM_ADDRESS;
    const tokenMint = address(mint);

    console.log(`[Transfer] mint=${mint} program=${isToken2022 ? 'Token2022' : 'Token'}`);

    // Derive ATAs using the correct program
    const findAta = isToken2022 ? findAssociatedTokenPda2022 : findAssociatedTokenPda;

    const [sourceAta] = await findAta({
      owner,
      mint: tokenMint,
      tokenProgram,
    });

    const [destAta] = await findAta({
      owner: destination,
      mint: tokenMint,
      tokenProgram,
    });

    const instructions: SerializedInstruction[] = [];

    // Create destination ATA if it doesn't exist (idempotent)
    const createAtaIx = isToken2022
      ? getCreateAssociatedTokenIdempotentInstruction2022({
          payer: signer,
          ata: destAta,
          owner: destination,
          mint: tokenMint,
        })
      : getCreateAssociatedTokenIdempotentInstruction({
          payer: signer,
          ata: destAta,
          owner: destination,
          mint: tokenMint,
        });
    instructions.push(this.kitIxToSerialized(createAtaIx));

    // Transfer checked instruction
    const transferIx = isToken2022
      ? getTransferCheckedInstruction2022({
          source: sourceAta,
          mint: tokenMint,
          destination: destAta,
          authority: signer,
          amount: BigInt(amount),
          decimals,
        })
      : getTransferCheckedInstruction({
          source: sourceAta,
          mint: tokenMint,
          destination: destAta,
          authority: signer,
          amount: BigInt(amount),
          decimals,
        });
    instructions.push(this.kitIxToSerialized(transferIx));

    return instructions;
  }

  private createNoopSigner(walletAddr: string): TransactionSigner {
    return {
      address: address(walletAddr),
      signTransactions: async (txs: any[]) => txs.map(() => ({})),
    } as TransactionSigner;
  }

  private kitIxToSerialized(ix: any): SerializedInstruction {
    return {
      programId: ix.programAddress as string,
      accounts: (ix.accounts ?? []).map((acc: any) => ({
        pubkey: acc.address as string,
        isSigner: acc.role === AccountRole.WRITABLE_SIGNER || acc.role === AccountRole.READONLY_SIGNER,
        isWritable: acc.role === AccountRole.WRITABLE_SIGNER || acc.role === AccountRole.WRITABLE,
      })),
      data: Buffer.from(ix.data ?? new Uint8Array()).toString('base64'),
    };
  }
}
