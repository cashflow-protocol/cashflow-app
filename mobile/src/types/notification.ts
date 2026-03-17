export interface AppNotification {
  _id: string;
  title: string;
  body?: string;
  type: 'transfer_in' | 'transfer_out' | 'deposit' | 'withdraw' | 'waitlist_approved' | 'system';
  txSignature?: string;
  read: boolean;
  metadata?: Record<string, any>;
  createdAt: string;
}
