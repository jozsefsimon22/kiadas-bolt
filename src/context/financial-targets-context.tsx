
'use client';

import React, { createContext, useState, useContext, useEffect, ReactNode } from 'react';

interface FinancialTargetsContextType {
  netWorthTarget: number | null;
  setNetWorthTarget: (amount: number | null) => void;
}

const FinancialTargetsContext = createContext<FinancialTargetsContextType | undefined>(undefined);

export function FinancialTargetsProvider({ children }: { children: ReactNode }) {
  const [netWorthTarget, setNetWorthTarget] = useState<number | null>(null);

  useEffect(() => {
    const storedValue = localStorage.getItem('app-net-worth-target');
    if (storedValue) {
        const parsedValue = parseFloat(storedValue);
        if (!isNaN(parsedValue)) {
            setNetWorthTarget(parsedValue);
        }
    }
  }, []);

  const handleSetTarget = (amount: number | null) => {
    setNetWorthTarget(amount);
    if (amount !== null && amount > 0) {
        localStorage.setItem('app-net-worth-target', String(amount));
    } else {
        localStorage.removeItem('app-net-worth-target');
    }
  };

  return (
    <FinancialTargetsContext.Provider value={{ netWorthTarget, setNetWorthTarget: handleSetTarget }}>
      {children}
    </FinancialTargetsContext.Provider>
  );
}

export function useFinancialTargets() {
  const context = useContext(FinancialTargetsContext);
  if (context === undefined) {
    throw new Error('useFinancialTargets must be used within a FinancialTargetsProvider');
  }
  return context;
}
