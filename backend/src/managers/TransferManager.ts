import { address, AccountRole } from '@solana/kit';
import type { TransactionSigner } from '@solana/kit';
import {
  findAssociatedTokenPda,
  getCreateAssociatedTokenIdempotentInstruction,
  getTransferCheckedInstruction,
  TOKEN_PROGRAM_ADDRESS,
} from '@solana-program/token';
import { getTransferSolInstruction } from '@solana-program/system';
import type { SerializedInstruction } from '../types';

const SOL_MINT = 'So11111111111111111111111111111111111111112';

export class TransferManager {
  /**
   * Build serialized instructions for a token transfer.
   * - SOL: single SystemProgram.transferSol instruction
   * - SPL tokens: create destination ATA (idempotent) + transferChecked
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

    // SPL token transfer
    const tokenMint = address(mint);

    const [sourceAta] = await findAssociatedTokenPda({
      owner,
      mint: tokenMint,
      tokenProgram: TOKEN_PROGRAM_ADDRESS,
    });

    const [destAta] = await findAssociatedTokenPda({
      owner: destination,
      mint: tokenMint,
      tokenProgram: TOKEN_PROGRAM_ADDRESS,
    });

    const instructions: SerializedInstruction[] = [];

    // Create destination ATA if it doesn't exist (idempotent)
    instructions.push(
      this.kitIxToSerialized(
        getCreateAssociatedTokenIdempotentInstruction({
          payer: signer,
          ata: destAta,
          owner: destination,
          mint: tokenMint,
        }),
      ),
    );

    // Transfer checked instruction
    instructions.push(
      this.kitIxToSerialized(
        getTransferCheckedInstruction({
          source: sourceAta,
          mint: tokenMint,
          destination: destAta,
          authority: signer,
          amount: BigInt(amount),
          decimals,
        }),
      ),
    );

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
