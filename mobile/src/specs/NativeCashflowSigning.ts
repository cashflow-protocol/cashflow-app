import type { TurboModule } from 'react-native';
import { TurboModuleRegistry } from 'react-native';

export interface Spec extends TurboModule {
  generateKeypair(tag: string, cloudSync: boolean): Promise<string>;
  getPublicKey(tag: string): Promise<string | null>;
  exportPrivateKey(tag: string): Promise<string | null>;
  sign(tag: string, messageBase64: string): Promise<string>;
  hasKeypair(tag: string): Promise<boolean>;
  deleteKeypair(tag: string): Promise<void>;
}

export default TurboModuleRegistry.get<Spec>('CashflowSigning');
