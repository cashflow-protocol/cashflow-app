import {
    address,
    pipe,
    createSolanaRpc,
    createTransactionMessage,
    setTransactionMessageFeePayer,
    setTransactionMessageLifetimeUsingBlockhash,
    appendTransactionMessageInstruction,
    getBase64EncodedWireTransaction,
    createKeyPairSignerFromBytes,
    getBase58Encoder,
    signTransactionMessageWithSigners,
} from '@solana/kit';
import type { Address, Rpc, SolanaRpcApi, KeyPairSigner } from '@solana/kit';
import {
    fetchAddressLookupTable,
    getCreateLookupTableInstructionAsync,
    getExtendLookupTableInstruction,
    getDeactivateLookupTableInstruction,
    getCloseLookupTableInstruction,
} from '@solana-program/address-lookup-table';
import type { AddressLookupTable } from '@solana-program/address-lookup-table';
import { getSetComputeUnitPriceInstruction } from '@solana-program/compute-budget';
import { TOKEN_PROGRAM_ADDRESS, ASSOCIATED_TOKEN_PROGRAM_ADDRESS } from '@solana-program/token';
import { TOKEN_2022_PROGRAM_ADDRESS } from '@solana-program/token-2022';

export async function initialiseLookupManager() {
    try {
        const lookupManager = LookupManager.getInstance();
        await lookupManager.init();
        console.log('MigrationManager', 'migrate', '✅ LookupManager initialized');
        await lookupManager.tryToUpdateLookupTable();
        // await lookupManager.createLookupTable();
        console.log('MigrationManager', 'migrate', '✅ LookupManager updated');
    }
    catch (err){
        console.error('❌ initialiseLookupManager error:', err);
    }
}

export class LookupManager {
    //TODO: if needed I can create a custom LookupTable for every user's Squad. and add his vault address, cloudKey, deviceKey, hardware wallets, etc
    private rpc: Rpc<SolanaRpcApi>;
    private owner!: KeyPairSigner;
    private lookupTableAddress: Address = address('7zhwX89SJs1ctA4e57Y6EpSvMuYXVoig2YiLKWFfnzwM');
    private accounts: Address[] = [
        //TODO: can add LP tokens, if need to reduce tx even more

        // programs
        address('W1AA3tfuCifNKeV9WKVwyasPwXu9o1H44NZCKZcSEND'), // SEND
        address('FarmsPZpWu9i7Kky8tPN37rs2TpmMrAZrC7S7vJa91Hr'), // Kamino Farm
        address('KvauGMspG5k6rtzrqqn7WNn3oZdyKqLKwK2XWQ8FLjd'), // Kvault program
        address('AyY6VCkHfTWdFs7SqBbu6AnCqLUhgzVHBzW3WcJu5Jc8'), // Kamino Finance Base Vault Authority
        address('jup3YeL8QhtSx1e253b2FDvsMNC87fDrgQZivbrndc9'), // Jupiter Lend Earn
        address('dRiftyHA39MWEi3m9aunc5MzRF1JYuBsbn6VPcn33UH'), // Drift Protocol
        address('JCNCMFXo5M5qwUPg2Utu1u6YWp3MbygxqBsBeXXJfrw'), // Drift Vaults

        // stablecoins
        address('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'), // USDC
        address('JuprjznTrTSp2UFa3ZBUFgwdAmtZCq4MQCwysN55USD'), // JupUSD
        address('Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB'), // USDT
        address('HzwqbKZw8HxMN6bF2yFZNrht3c2iXXzpKcFu7uBEDKtr'), // EURC
        address('2u1tszSeqZ3qBWF3uNGPFc8TzMk2tdiwknnRMWGWjGWH'), // USDG
        address('USDSwr9ApdHk5bvJKMjzff41FfuX8bSxdKcR81vTwcA'), // USDS
        address('2b1kV6DkPAnxd5ixfnxCpjxmKwqjjaYmCZfHsFu24GXo'), // PYUSD

        address('yyvY1cHtcQHbsPk4UYdHhjtoYQjYCX41RqF8U3dSEND'), // SEND fees
        address('CASH1g7WuVEN873RhmHbaY8KA3rhwQbutHJRUsVU9E9m'), // Cashflow All Tx Fee Payer
        address('CASH1YstLfKmTJrZZkddbBDwBheQ9zh2subDeu4RrnYu'), // Cashflow Squad Create Fee Payer

        TOKEN_PROGRAM_ADDRESS,
        TOKEN_2022_PROGRAM_ADDRESS,
        ASSOCIATED_TOKEN_PROGRAM_ADDRESS,
    ];
    public static lookupTable: AddressLookupTable | undefined = undefined;
    public static lookupTableAddress: Address | undefined = undefined;

    constructor() {
        console.log('process.env.SOLANA_RPC_URL:', process.env.SOLANA_RPC_URL);
        this.rpc = createSolanaRpc(process.env.SOLANA_RPC_URL!);
    }

    async init() {
        this.owner = await createKeyPairSignerFromBytes(
            getBase58Encoder().encode(process.env.ADMIN_PRIVATE_KEY!),
        );
        this.accounts.push(this.owner.address);

        if (process.env.TREASURY_WALLET_ADDRESS) {
            this.accounts.push(address(process.env.TREASURY_WALLET_ADDRESS));
        }

        console.log('[LookupManager] Accounts:', this.accounts);
    }

    private async buildAndSendTx(instructions: any[]): Promise<string> {
        const { value: latestBlockhash } = await this.rpc.getLatestBlockhash().send();

        const transactionMessage = pipe(
            createTransactionMessage({ version: 0 }),
            (tx) => setTransactionMessageFeePayer(this.owner.address, tx),
            (tx) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, tx),
            (tx) => instructions.reduce(
                (msg: any, ix: any) => appendTransactionMessageInstruction(ix, msg),
                tx,
            ),
        );

        const signed = await signTransactionMessageWithSigners(transactionMessage);
        const wireTransaction = getBase64EncodedWireTransaction(signed);

        const signature = await this.rpc
            .sendTransaction(wireTransaction, {
                encoding: 'base64',
                skipPreflight: true,
                preflightCommitment: 'confirmed',
            })
            .send();

        return signature;
    }

    async createLookupTable() {
        const slot = await this.rpc.getSlot().send();

        const createIx = await getCreateLookupTableInstructionAsync({
            authority: this.owner,
            recentSlot: slot,
        });

        const lookupTableAddress = createIx.accounts[0].address;
        console.log('ALT address:', lookupTableAddress);

        const signature = await this.buildAndSendTx([
            getSetComputeUnitPriceInstruction({ microLamports: 100_000 }),
            createIx,
        ]);
        console.log('[LookupManager] ALT created:', signature);

        return lookupTableAddress;
    }

    async tryToUpdateLookupTable() {
        const lookupTableAccount = await fetchAddressLookupTable(this.rpc, this.lookupTableAddress);
        const lookupTable = lookupTableAccount.data;
        LookupManager.lookupTable = lookupTable;
        LookupManager.lookupTableAddress = this.lookupTableAddress;
        console.log('[LookupManager] Lookup table:', lookupTable);

        const currentAddresses = lookupTable.addresses || [];
        const newAddresses = this.accounts.filter(
            (acc) => !currentAddresses.includes(acc),
        );
        console.log('[LookupManager] New addresses:', newAddresses);

        if (newAddresses.length === 0) {
            console.log('[LookupManager] No new addresses to add');
            return;
        }

        const extendIx = getExtendLookupTableInstruction({
            address: this.lookupTableAddress,
            authority: this.owner,
            payer: this.owner,
            addresses: newAddresses,
        });

        const signature = await this.buildAndSendTx([extendIx]);
        console.log('[LookupManager] Lookup table extended:', signature);
    }

    async deactivateLookupTable(lookupTable: Address) {
        const deactivateIx = getDeactivateLookupTableInstruction({
            address: lookupTable,
            authority: this.owner,
        });

        const signature = await this.buildAndSendTx([deactivateIx]);
        console.log('[LookupManager] Lookup table deactivated:', signature);
    }

    async closeLookupTable(lookupTable: Address) {
        const closeIx = getCloseLookupTableInstruction({
            address: lookupTable,
            authority: this.owner,
            recipient: this.owner.address,
        });

        const signature = await this.buildAndSendTx([closeIx]);
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