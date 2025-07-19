
'use client';

import React, { createContext, useContext, ReactNode } from 'react';
import { driver } from 'driver.js';
import 'driver.js/dist/driver.css';
import { useRouter } from 'next/navigation';
import { useAuth } from './main-layout';

// Custom styles for the tour popover to match the app's theme
const applyCustomTourStyles = () => {
    const existingStyle = document.getElementById('driver-js-custom-styles');
    if (existingStyle) return;

    const style = document.createElement('style');
    style.id = 'driver-js-custom-styles';
    style.innerHTML = `
      :root {
        --driver-popover-bg-color: hsl(var(--card));
        --driver-popover-text-color: hsl(var(--card-foreground));
        --driver-popover-title-color: hsl(var(--card-foreground));
        --driver-button-bg-color: hsl(var(--primary));
        --driver-button-text-color: hsl(var(--primary-foreground));
        --driver-button-hover-bg-color: hsl(var(--primary) / 0.9);
        --driver-button-secondary-bg-color: hsl(var(--secondary));
        --driver-button-secondary-text-color: hsl(var(--secondary-foreground));
        --driver-button-secondary-hover-bg-color: hsl(var(--secondary) / 0.8);
        --driver-popover-arrow-color: hsl(var(--card));
        --driver-popover-border-radius: var(--radius);
        --driver-popover-padding: 1.5rem;
      }
    `;
    document.head.appendChild(style);
};

interface TourContextType {
    startTour: () => void;
}

const TourContext = createContext<TourContextType | undefined>(undefined);

export function AppTourProvider({ children }: { children: ReactNode }) {
    const router = useRouter();
    const user = useAuth(); 

    const startTour = () => {
        applyCustomTourStyles();

        const driverObj = driver({
            showProgress: true,
            allowClose: true,
            onDestroyStarted: (element, step) => {
                // If step is undefined, tour was likely closed via overlay click or escape key.
                if (!driverObj.isDestroyed) {
                    if (step?.popover?.title?.startsWith("You're All Set")) {
                        localStorage.setItem('worthwatch-tour-completed', 'true');
                    }
                    driverObj.destroy();
                }
            },
            steps: [
                {
                    element: '#tour-step-1-dashboard',
                    popover: {
                        title: `Welcome, ${user.displayName || 'User'}!`,
                        description: "This is your Dashboard. Let's start by setting up your budget.",
                        onNextClick: () => {
                            router.push('/transactions');
                            setTimeout(() => driverObj.moveNext(), 500);
                        },
                    },
                },
                {
                    element: '#tour-step-3-add-transaction-button',
                    popover: {
                        title: 'Add Your Transactions',
                        description: "Click here to add your income and expenses. Set recurring items like your salary or rent so they're tracked automatically each month.",
                        onNextClick: () => {
                            router.push('/household');
                            setTimeout(() => driverObj.moveNext(), 500);
                        },
                         onPrevClick: () => {
                            router.push('/dashboard');
                            setTimeout(() => driverObj.movePrevious(), 500);
                        }
                    },
                },
                {
                    element: '#tour-step-5-create-household-button',
                    popover: {
                        title: 'Share Finances (Optional)',
                        description: "If you share expenses with a partner or roommates, create a household to easily manage and split costs.",
                        onNextClick: () => {
                            router.push('/assets');
                            setTimeout(() => driverObj.moveNext(), 500);
                        },
                         onPrevClick: () => {
                            router.push('/transactions');
                            setTimeout(() => driverObj.movePrevious(), 500);
                        }
                    },
                },
                {
                    element: '#tour-step-7-add-asset-button',
                    popover: {
                        title: 'Track Your Net Worth',
                        description: "Finally, add your assets (like investments and liabilities) to see your complete financial picture.",
                        onNextClick: () => {
                            router.push('/dashboard');
                            setTimeout(() => driverObj.moveNext(), 500);
                        },
                         onPrevClick: () => {
                            router.push('/household');
                            setTimeout(() => driverObj.movePrevious(), 500);
                        }
                    },
                },
                {
                    element: '#tour-step-1-dashboard',
                    popover: {
                        title: "You're All Set!",
                        description: "Your dashboard will now come to life with insights. Explore the other sections to see projections, analytics, and more.",
                        onNextClick: () => {
                            localStorage.setItem('worthwatch-tour-completed', 'true');
                            driverObj.destroy();
                        },
                        onPrevClick: () => {
                            router.push('/assets');
                            setTimeout(() => driverObj.movePrevious(), 500);
                        },
                    },
                }
            ],
        });

        driverObj.drive();
    };

    return (
        <TourContext.Provider value={{ startTour }}>
            {children}
        </TourContext.Provider>
    );
}

export const useAppTour = () => {
    const context = useContext(TourContext);
    if (!context) {
        throw new Error('useAppTour must be used within an AppTourProvider');
    }
    return context;
};
