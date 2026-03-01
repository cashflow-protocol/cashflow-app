import { bs58 } from "@coral-xyz/anchor/dist/cjs/utils/bytes";
import { AddressLookupTableAccount, AddressLookupTableProgram, ComputeBudgetProgram, Connection, Keypair, PublicKey, SYSVAR_INSTRUCTIONS_PUBKEY, TransactionMessage, VersionedTransaction } from "@solana/web3.js";
import { ASSOCIATED_TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from "@solana/spl-token";

export class LookupManager {
    //TODO: if needed I can create a custom LookupTable for every user's Squad. and add his vault address, cloudKey, deviceKey, hardware wallets, etc
    private connection: Connection;
    private owner: Keypair;
    private lookupTableAddress = new PublicKey('F5LgntbBxG6n4cSkxd9bpDi8qMm8TWVL8mxe7722gpi');
    private accounts = [
        //TODO: add all programs: Kamino, Jup Lend, Drift
        //TODO: add all stablecoin mints
        //TODO: add our fee wallet
        //TODO: add @heymike/send fee wallet

        TOKEN_PROGRAM_ID,
        TOKEN_2022_PROGRAM_ID,
        ASSOCIATED_TOKEN_PROGRAM_ID,
    ];
    public static lookupTable: AddressLookupTableAccount | undefined = undefined;
    public static lookupTables: AddressLookupTableAccount[] = [];

    constructor() {
        this.connection = new Connection(process.env.SOLANA_RPC!, 'processed');
        this.owner = Keypair.fromSecretKey(bs58.decode(process.env.ADMIN_PRIVATE_KEY!));
    }

    async init(){
        this.accounts.push(this.owner.publicKey);

        console.log('[LookupManager] Accounts:', this.accounts);
    }

    async createLookupTable() {
        const { blockhash } = await this.connection.getLatestBlockhash('confirmed');
        const slot = await this.connection.getSlot();
      
        const [lookupTableIx, lookupTableAddress] = AddressLookupTableProgram.createLookupTable({
            authority: this.owner.publicKey,
            payer: this.owner.publicKey,
            recentSlot: slot,
        });
      
        console.log('ALT address:', lookupTableAddress.toBase58());

        const tx = new VersionedTransaction(
            new TransactionMessage({
                payerKey: this.owner.publicKey,
                recentBlockhash: blockhash,
                instructions: [
                    ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 100000 }),
                    lookupTableIx
                ],
            }).compileToV0Message()
        );
        tx.sign([this.owner]);
        const { signature } = await SendManager.sendTransaction(tx);
        console.log('[LookupManager] ALT created:', signature);
      
        return lookupTableAddress;
    }

    async tryToUpdateLookupTable() {
        const lookupTable = await this.connection.getAddressLookupTable(this.lookupTableAddress);
        LookupManager.lookupTable = lookupTable?.value || undefined;
        console.log('[LookupManager] Lookup table:', LookupManager.lookupTable);
        if (!LookupManager.lookupTable){
            throw new Error('[LookupManager] Failed to get lookup table');
        }
        LookupManager.lookupTables.push(LookupManager.lookupTable);
        console.log('[LookupManager] Lookup tables:', LookupManager.lookupTables);

        const currentAddresses = LookupManager.lookupTable.state.addresses || [];
        const newAddresses = this.accounts.filter(
            (acc) => !currentAddresses.some((cur) => cur.equals(acc))
        );
        console.log('[LookupManager] New addresses:', newAddresses);


        if (newAddresses.length == 0) {
            console.log('[LookupManager] No new addresses to add');
            return;
        }

        const extendLookupTableIx = AddressLookupTableProgram.extendLookupTable({
            lookupTable: this.lookupTableAddress,
            authority: this.owner.publicKey,
            payer: this.owner.publicKey,
            addresses: newAddresses,
        }); 

        const { blockhash } = await this.connection.getLatestBlockhash('confirmed');

        const tx = new VersionedTransaction(
            new TransactionMessage({
                payerKey: this.owner.publicKey,
                recentBlockhash: blockhash,
                instructions: [extendLookupTableIx],
            }).compileToV0Message()
        );
        tx.sign([this.owner]);
        const { signature } = await SendManager.sendTransaction(tx);
        console.log('[LookupManager] Lookup table extended:', signature);
    }

    async deactivateLookupTable(lookupTableAddress: PublicKey) {
        const deactivateLookupTableIx = AddressLookupTableProgram.deactivateLookupTable({
            lookupTable: lookupTableAddress,
            authority: this.owner.publicKey,
        });
        const { blockhash } = await this.connection.getLatestBlockhash('confirmed');

        const tx = new VersionedTransaction(
            new TransactionMessage({
                payerKey: this.owner.publicKey,
                recentBlockhash: blockhash,
                instructions: [deactivateLookupTableIx],
            }).compileToV0Message()
        );
        tx.sign([this.owner]);
        const { signature } = await SendManager.sendTransaction(tx);
        console.log('[LookupManager] Lookup table deactivated:', signature);
    }

    async closeLookupTable(lookupTableAddress: PublicKey) {
        const closeLookupTableIx = AddressLookupTableProgram.closeLookupTable({
            lookupTable: lookupTableAddress,
            authority: this.owner.publicKey,
            recipient: this.owner.publicKey,
        });
        const { blockhash } = await this.connection.getLatestBlockhash('confirmed');

        const tx = new VersionedTransaction(
            new TransactionMessage({
                payerKey: this.owner.publicKey,
                recentBlockhash: blockhash,
                instructions: [closeLookupTableIx],
            }).compileToV0Message()
        );
        tx.sign([this.owner]);
        const { signature } = await SendManager.sendTransaction(tx);
        console.log('[LookupManager] Lookup table closed:', signature);
    }

    static instance: LookupManager;
    static getInstance(): LookupManager {
        if (!LookupManager.instance) {
            LookupManager.instance = new LookupManager();
        }
        return LookupManager.instance;
    }
}