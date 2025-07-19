import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import HouseholdsPage from '@/app/household/page';
import { getDocs, getDoc, writeBatch } from 'firebase/firestore'; 

// Import providers and original components that need to be mocked
import { SidebarProvider } from '@/components/ui/sidebar';
import { UiSettingsProvider } from '@/context/ui-settings-context';
import { AppTourProvider } from '@/components/tour-guide';
import { TooltipProvider } from '@/components/ui/tooltip';

// Mock dependencies
vi.mock('@/hooks/use-mobile', () => ({
    useIsMobile: () => false,
}));

const mockUser = {
    uid: 'test-user-id',
    email: 'test@example.com',
    displayName: 'Test User',
} as any;

vi.mock('@/components/main-layout', async (importOriginal) => {
    const original = await importOriginal<any>();
    return {
        ...original,
        useAuth: () => mockUser,
        MainLayout: ({ children }: { children: React.ReactNode }) => (
             <original.AuthContext.Provider value={mockUser}>
                <UiSettingsProvider>
                    <AppTourProvider>
                        <SidebarProvider>
                            <TooltipProvider>
                                <div>{children}</div>
                            </TooltipProvider>
                        </SidebarProvider>
                    </AppTourProvider>
                </UiSettingsProvider>
            </original.AuthContext.Provider>
        ),
    };
});

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: vi.fn(),
  }),
}));

const mockToast = vi.fn();
vi.mock('@/hooks/use-toast', () => ({
  useToast: () => ({
    toast: mockToast,
  }),
}));

vi.mock('@/context/currency-context', () => ({
  useCurrency: () => ({
    currency: 'USD',
  }),
}));

// Mock Firestore
const mockUpdateFn = vi.fn();
const mockDeleteFn = vi.fn();
const mockCommitFn = vi.fn().mockResolvedValue(undefined);

vi.mock('firebase/firestore', async (importOriginal) => {
    const originalFirestore = await importOriginal<typeof import('firebase/firestore')>();
    return {
        ...originalFirestore,
        getDocs: vi.fn(),
        getDoc: vi.fn(),
        writeBatch: vi.fn(() => ({
            update: mockUpdateFn,
            delete: mockDeleteFn,
            commit: mockCommitFn,
        })),
        doc: vi.fn(),
        collection: vi.fn(),
        query: vi.fn(),
        where: vi.fn(),
        serverTimestamp: vi.fn(),
    };
});


// Mock db from our lib
vi.mock('@/lib/firebase', () => ({
    db: {}, // It's just a placeholder, as the functions using it are mocked.
}));


// Mock Data
const mockInvitations = [
  {
    id: 'invitation-1',
    data: () => ({
      householdId: 'household-1',
      householdName: 'Test Household',
      invitedBy: 'owner-id',
      invitedEmail: 'test@example.com',
    }),
  },
];

const mockHouseholdDoc = {
    exists: () => true,
    data: () => ({
      ownerId: 'owner-id',
      name: 'Test Household',
      members: [{ id: 'owner-id', name: 'Owner', email: 'owner@test.com' }],
      memberIds: ['owner-id'],
      pendingMemberEmails: ['test@example.com'],
    }),
};

describe('HouseholdsPage - Invitation Flow', () => {
  beforeEach(() => {
    // Clear all mock history and reset implementations
    vi.clearAllMocks();
    vi.mocked(getDocs).mockReset();
    vi.mocked(getDoc).mockReset();
    vi.mocked(writeBatch).mockClear();
    mockUpdateFn.mockClear();
    mockDeleteFn.mockClear();
    mockCommitFn.mockClear();
    mockToast.mockClear();
  });

  it('allows a user to accept an invitation', async () => {
    // Arrange: Setup mock return values for the initial fetch
    vi.mocked(getDocs)
        .mockResolvedValueOnce({ docs: [] } as any) // householdQuery
        .mockResolvedValueOnce({ docs: mockInvitations } as any); // invitationQuery

    // Setup mock for getDoc inside handleAcceptInvitation
    vi.mocked(getDoc).mockResolvedValue(mockHouseholdDoc as any);

    render(<HouseholdsPage />);

    // Act: Find and click the accept button
    const acceptButton = await screen.findByRole('button', { name: /accept/i });
    fireEvent.click(acceptButton);

    // Assert: Check if Firestore and toast were called correctly
    await waitFor(() => {
        expect(writeBatch).toHaveBeenCalled();
        // Check that we're updating the household doc
        expect(mockUpdateFn).toHaveBeenCalled();
        // Check that we're deleting the invitation doc
        expect(mockDeleteFn).toHaveBeenCalled();
        expect(mockCommitFn).toHaveBeenCalled();
        expect(mockToast).toHaveBeenCalledWith(
            expect.objectContaining({
                title: 'Invitation Accepted!',
            })
        );
    });
  });

  it('allows a user to decline an invitation', async () => {
    // Arrange: Setup mock return values for the initial fetch
    vi.mocked(getDocs)
        .mockResolvedValueOnce({ docs: [] } as any)
        .mockResolvedValueOnce({ docs: mockInvitations } as any);
    
    // Setup mock for getDoc inside handleDeclineInvitation
    vi.mocked(getDoc).mockResolvedValue(mockHouseholdDoc as any);
    
    render(<HouseholdsPage />);

    // Act: Find and click the decline button
    const declineButton = await screen.findByRole('button', { name: /decline/i });
    fireEvent.click(declineButton);

    // Assert
    await waitFor(() => {
        expect(writeBatch).toHaveBeenCalled();
        // Check that we're deleting the invitation doc
        expect(mockDeleteFn).toHaveBeenCalled();
        // Check that we're updating the household doc to remove pending email
        expect(mockUpdateFn).toHaveBeenCalled();
        expect(mockCommitFn).toHaveBeenCalled();
        expect(mockToast).toHaveBeenCalledWith(
            expect.objectContaining({
                title: 'Invitation Declined',
            })
        );
    });
  });
});
