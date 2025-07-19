'use client';

import React, { createContext, useState, useContext, useEffect, ReactNode } from 'react';

interface ProjectionSettingsContextType {
  defaultMonthlyContribution: number | null;
  setDefaultMonthlyContribution: (amount: number | null) => void;
}

const ProjectionSettingsContext = createContext<ProjectionSettingsContextType | undefined>(undefined);

export function ProjectionSettingsProvider({ children }: { children: ReactNode }) {
  const [defaultMonthlyContribution, setDefaultMonthlyContribution] = useState<number | null>(null);

  useEffect(() => {
    const storedValue = localStorage.getItem('app-projection-contribution');
    if (storedValue) {
        const parsedValue = parseFloat(storedValue);
        if (!isNaN(parsedValue)) {
            setDefaultMonthlyContribution(parsedValue);
        }
    }
  }, []);

  const handleSetContribution = (amount: number | null) => {
    setDefaultMonthlyContribution(amount);
    if (amount !== null && amount > 0) {
        localStorage.setItem('app-projection-contribution', String(amount));
    } else {
        localStorage.removeItem('app-projection-contribution');
    }
  };

  return (
    <ProjectionSettingsContext.Provider value={{ defaultMonthlyContribution, setDefaultMonthlyContribution: handleSetContribution }}>
      {children}
    </ProjectionSettingsContext.Provider>
  );
}

export function useProjectionSettings() {
  const context = useContext(ProjectionSettingsContext);
  if (context === undefined) {
    throw new Error('useProjectionSettings must be used within a ProjectionSettingsProvider');
  }
  return context;
}
