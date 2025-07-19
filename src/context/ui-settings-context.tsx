'use client';

import React, { createContext, useState, useContext, useEffect, ReactNode } from 'react';

interface UiSettingsContextType {
  expandSidebarMenus: boolean;
  setExpandSidebarMenus: (expand: boolean) => void;
}

const UiSettingsContext = createContext<UiSettingsContextType | undefined>(undefined);

export function UiSettingsProvider({ children }: { children: ReactNode }) {
  const [expandSidebarMenus, setExpandSidebarMenus] = useState(false); // Default to closed

  useEffect(() => {
    const storedValue = localStorage.getItem('app-ui-expand-sidebar');
    if (storedValue) {
      setExpandSidebarMenus(storedValue === 'true');
    }
  }, []);

  const handleSetExpand = (expand: boolean) => {
    setExpandSidebarMenus(expand);
    localStorage.setItem('app-ui-expand-sidebar', String(expand));
  };

  return (
    <UiSettingsContext.Provider value={{ expandSidebarMenus, setExpandSidebarMenus: handleSetExpand }}>
      {children}
    </UiSettingsContext.Provider>
  );
}

export function useUiSettings() {
  const context = useContext(UiSettingsContext);
  if (context === undefined) {
    throw new Error('useUiSettings must be used within a UiSettingsProvider');
  }
  return context;
}
