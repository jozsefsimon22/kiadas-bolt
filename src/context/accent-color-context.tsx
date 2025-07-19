'use client';

import React, { createContext, useState, useContext, useEffect, ReactNode } from 'react';

export interface AccentColor {
  name: string;
  primary: string; // HSL value string
  foreground: string; // HSL value string
}

interface AccentColorContextType {
  accentColor: AccentColor;
  setAccentColor: (color: AccentColor) => void;
}

const defaultAccentColor: AccentColor = {
  name: 'Default Blue',
  primary: '217.2 91.2% 59.8%',
  foreground: '210 40% 98%',
};

const AccentColorContext = createContext<AccentColorContextType | undefined>(undefined);

export function AccentColorProvider({ children }: { children: ReactNode }) {
  const [accentColor, setAccentColor] = useState<AccentColor>(defaultAccentColor);

  useEffect(() => {
    // On mount, read from localStorage
    const storedColor = localStorage.getItem('app-accent-color');
    if (storedColor) {
      try {
        const parsedColor = JSON.parse(storedColor);
        // Basic validation
        if (parsedColor.primary && parsedColor.foreground) {
          setAccentColor(parsedColor);
        }
      } catch (e) {
        // Ignore parsing errors, use default
      }
    }
  }, []);

  useEffect(() => {
    // Apply the color as a CSS variable whenever it changes
    document.documentElement.style.setProperty('--primary', accentColor.primary);
    document.documentElement.style.setProperty('--primary-foreground', accentColor.foreground);
    document.documentElement.style.setProperty('--ring', accentColor.primary);
  }, [accentColor]);

  const handleSetAccentColor = (newColor: AccentColor) => {
    setAccentColor(newColor);
    localStorage.setItem('app-accent-color', JSON.stringify(newColor));
  };

  return (
    <AccentColorContext.Provider value={{ accentColor, setAccentColor: handleSetAccentColor }}>
      {children}
    </AccentColorContext.Provider>
  );
}

export function useAccentColor() {
  const context = useContext(AccentColorContext);
  if (context === undefined) {
    throw new Error('useAccentColor must be used within an AccentColorProvider');
  }
  return context;
}
