import React, { createContext, useContext, useState, useCallback } from 'react';
import Toast from '../components/Toast';

type ToastType = 'error' | 'warning' | 'success';

interface ToastState {
  visible: boolean;
  message: string;
  description: string;
  type: ToastType;
}

interface ToastContextValue {
  showToast: (message: string, description?: string, type?: ToastType) => void;
}

const ToastContext = createContext<ToastContextValue>({
  showToast: () => {},
});

export function useToast() {
  return useContext(ToastContext);
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toast, setToast] = useState<ToastState>({
    visible: false,
    message: '',
    description: '',
    type: 'error',
  });

  const showToast = useCallback((message: string, description?: string, type: ToastType = 'error') => {
    // Reset first so re-triggering the same message still animates
    setToast({ visible: false, message: '', description: '', type: 'error' });
    setTimeout(() => {
      setToast({ visible: true, message, description: description ?? '', type });
    }, 50);
  }, []);

  const handleDismiss = useCallback(() => {
    setToast(prev => ({ ...prev, visible: false }));
  }, []);

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      <Toast
        visible={toast.visible}
        message={toast.message}
        description={toast.description}
        type={toast.type}
        onDismiss={handleDismiss}
      />
    </ToastContext.Provider>
  );
}
