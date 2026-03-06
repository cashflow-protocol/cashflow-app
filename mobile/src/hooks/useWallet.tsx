import React, { createContext, useContext, useState, useCallback, ReactNode } from 'react';
import { Address } from '@solana/kit';
import walletService, { WalletAccount } from '../services/walletService';

interface WalletContextType {
  wallet: WalletAccount | null;
  isConnecting: boolean;
  balance: number;
  connect: () => Promise<WalletAccount | null>;
  disconnect: () => Promise<void>;
  refreshBalance: () => Promise<void>;
}

const WalletContext = createContext<WalletContextType | undefined>(undefined);

export function WalletProvider({ children }: { children: ReactNode }) {
  const [wallet, setWallet] = useState<WalletAccount | null>(null);
  const [isConnecting, setIsConnecting] = useState(false);
  const [balance, setBalance] = useState(0);

  const refreshBalance = useCallback(async () => {
    if (wallet?.publicKey) {
      const newBalance = await walletService.getBalance(wallet.publicKey);
      setBalance(newBalance);
    }
  }, [wallet]);

  const connect = useCallback(async (): Promise<WalletAccount | null> => {
    setIsConnecting(true);
    try {
      const account = await walletService.connect();
      if (account) {
        setWallet(account);
        const bal = await walletService.getBalance(account.publicKey);
        setBalance(bal);
        return account;
      }
      return null;
    } catch (error) {
      console.error('Connection error:', error);
      return null;
    } finally {
      setIsConnecting(false);
    }
  }, []);

  const disconnect = useCallback(async () => {
    try {
      await walletService.disconnect();
      setWallet(null);
      setBalance(0);
    } catch (error) {
      console.error('Disconnect error:', error);
    }
  }, []);

  return (
    <WalletContext.Provider
      value={{
        wallet,
        isConnecting,
        balance,
        connect,
        disconnect,
        refreshBalance,
      }}
    >
      {children}
    </WalletContext.Provider>
  );
}

export function useWallet(): WalletContextType {
  const context = useContext(WalletContext);
  if (!context) {
    throw new Error('useWallet must be used within WalletProvider');
  }
  return context;
}
