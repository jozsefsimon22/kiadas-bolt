
'use client';

import React, { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { MainLayout, useAuth } from '@/components/main-layout';
import { Header } from '@/components/header';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Loader2, PlusCircle, Users, Trash2, Home, CheckCircle, XCircle, ArrowUpCircle, ArrowDownCircle, PiggyBank } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { db } from '@/lib/firebase';
import { collection, query, where, getDocs, addDoc, doc, deleteDoc, writeBatch, getDoc, DocumentData, serverTimestamp, updateDoc } from 'firebase/firestore';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Separator } from '@/components/ui/separator';
import { useCurrency } from '@/context/currency-context';
import { formatCurrency } from '@/lib/currency';
import { Skeleton } from '@/components/ui/skeleton';


// Types and Schemas
type Member = { id: string; name: string; email: string; income?: number };
type Split = { memberId: string; share: number; };
type Household = { id: string; ownerId: string; name: string; members: Member[]; memberIds: string[]; pendingMemberEmails?: string[], splitType?: 'equal' | 'shares' | 'income_ratio'; splits?: Split[]; };
type Invitation = { id: string; householdId: string; householdName: string; invitedBy: string; invitedEmail: string; };

const householdSchema = z.object({
  name: z.string().min(1, 'Household name is required.'),
});

type AmountChange = { id: string; amount: number; date: Date; };
type BaseTransaction = { id: string; userId: string; name: string; amounts: AmountChange[]; frequency: 'one-off' | 'recurring'; endDate?: Date | null; };
type Income = BaseTransaction & { transactionType: 'income'; categoryId?: string; sharing: string; };
type Expense = BaseTransaction & { transactionType: 'expense'; sharing: string; classification?: 'need' | 'want'; categoryId?: string; };
type Transaction = Income | Expense;

type SavingGoalContribution = {
  id: string;
  amount: number;
  date: Date;
};
type SavingGoal = {
  id: string;
  userId: string;
  name: string;
  targetAmount: number;
  targetDate: Date;
  startDate: Date;
  sharing: 'personal' | string;
  contributions: SavingGoalContribution[];
};

const getAmountForDate = (transaction: Transaction, targetDate: Date): number => {
    if (!transaction.amounts || transaction.amounts.length === 0) return 0;
    const sortedAmounts = [...transaction.amounts].sort((a, b) => {
        const dateA = a.date ? a.date.getTime() : 0;
        const dateB = b.date ? b.date.getTime() : 0;
        return dateB - dateA;
    });
    const activeAmount = sortedAmounts.find(a => a.date && a.date <= targetDate);
    return activeAmount ? activeAmount.amount : 0;
};


// Main Component
function HouseholdsList() {
  const user = useAuth();
  const router = useRouter();
  const { toast } = useToast();
  const { currency } = useCurrency();
  const [households, setHouseholds] = useState<Household[]>([]);
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [savingsGoals, setSavingsGoals] = useState<SavingGoal[]>([]);
  const [loading, setLoading] = useState(true);
  
  const [isHouseholdDialogOpen, setIsHouseholdDialogOpen] = useState(false);
  const [householdToDelete, setHouseholdToDelete] = useState<Household | null>(null);

  const householdForm = useForm<z.infer<typeof householdSchema>>({
    resolver: zodResolver(householdSchema),
    defaultValues: { name: 'My Household' },
  });

  async function fetchData() {
    if (!user) return;
    setLoading(true);
    try {
        const invitationQuery = query(collection(db, "invitations"), where("invitedEmail", "==", user.email));
        const householdQuery = query(collection(db, 'households'), where('memberIds', 'array-contains', user.uid));
        
        const [invitationSnapshot, householdSnapshot] = await Promise.all([
            getDocs(invitationQuery),
            getDocs(householdQuery)
        ]);
        
        const invitationsData = invitationSnapshot.docs.map(doc => ({ id: doc.id, ...(doc.data() as Omit<Invitation, 'id'>) }));
        setInvitations(invitationsData);
        
        const householdsData = householdSnapshot.docs.map(doc => ({ id: doc.id, ...(doc.data() as Omit<Household, 'id'>)}));
        setHouseholds(householdsData);

        const householdIds = householdsData.map(h => h.id);
      
        if (householdIds.length > 0) {
            const transactionsQuery = query(collection(db, 'transactions'), where('sharing', 'in', householdIds));
            const savingsQuery = query(collection(db, 'savings'), where('sharing', 'in', householdIds));
            const [transactionsSnapshot, savingsSnapshot] = await Promise.all([
                getDocs(transactionsQuery),
                getDocs(savingsQuery)
            ]);

            const transactionList = transactionsSnapshot.docs.map(doc => {
                const data = doc.data();
                const amounts = (data.amounts || []).map((a: any) => ({ ...a, date: a.date.toDate() }));
                return { id: doc.id, ...data, amounts, endDate: data.endDate ? data.endDate.toDate() : null } as Transaction;
            });
            setTransactions(transactionList);

            const savingsList = savingsSnapshot.docs.map(doc => {
                const data = doc.data();
                return {
                    id: doc.id,
                    ...data,
                    contributions: (data.contributions || []).map((c: any) => ({ ...c, date: c.date.toDate() }))
                } as SavingGoal;
            });
            setSavingsGoals(savingsList);
        } else {
            setTransactions([]);
            setSavingsGoals([]);
        }

    } catch (error: any) {
      console.error("Error fetching households:", error);
      toast({ variant: 'destructive', title: "Error fetching data", description: "Could not load household information." });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchData();
  }, [user]);

  useEffect(() => {
    if (isHouseholdDialogOpen) {
      householdForm.reset({ name: 'My Household' });
    }
  }, [isHouseholdDialogOpen, householdForm]);
  
  const { totalSharedIncome, yourShareOfExpenses, totalSharedSavings } = useMemo(() => {
    if (!user) return { totalSharedIncome: 0, yourShareOfExpenses: 0, totalSharedSavings: 0 };
    const today = new Date();

    const income = transactions
        .filter(t => t.transactionType === 'income')
        .reduce((sum, t) => sum + getAmountForDate(t, today), 0);

    const expenses = transactions
        .filter((t): t is Expense => t.transactionType === 'expense')
        .reduce((sum, t) => {
            const totalAmount = getAmountForDate(t, today);
            const household = households.find(h => h.id === t.sharing);
            if (!household) return sum;

            let userShare = 0;
            const userIsMember = household.members.some(m => m.id === user.uid);
            if (userIsMember) {
                 if (household.splitType === 'shares' && household.splits?.length) {
                    const totalShares = household.splits.reduce((s, split) => s + (split.share || 0), 0);
                    if (totalShares > 0) {
                        const userSplit = household.splits.find(s => s.memberId === user.uid);
                        const userShares = userSplit?.share || 0;
                        userShare = (totalAmount * userShares) / totalShares;
                    } else {
                        userShare = household.members.length > 0 ? totalAmount / household.members.length : 0;
                    }
                 } else if (household.splitType === 'income_ratio') {
                    const totalIncome = household.members.reduce((s, member) => s + (member.income || 0), 0);
                    if (totalIncome > 0) {
                        const userIncome = household.members.find(m => m.id === user.uid)?.income || 0;
                        userShare = (totalAmount * userIncome) / totalIncome;
                    } else {
                         userShare = household.members.length > 0 ? totalAmount / household.members.length : 0;
                    }
                 } else { // Equal split
                    userShare = household.members.length > 0 ? totalAmount / household.members.length : 0;
                 }
            }
            return sum + userShare;
        }, 0);
    
    const savings = savingsGoals.reduce((sum, goal) => sum + goal.contributions.reduce((cSum, c) => cSum + c.amount, 0), 0);

    return { totalSharedIncome: income, yourShareOfExpenses: expenses, totalSharedSavings: savings };
  }, [transactions, savingsGoals, households, user]);

  const handleHouseholdFormSubmit = async (values: z.infer<typeof householdSchema>) => {
    if (!user || !user.email) return;
    try {
      const newMember: Member = { id: user.uid, name: user.displayName || 'Me', email: user.email };
      const newHouseholdRef = doc(collection(db, "households"));
      
      const batch = writeBatch(db);
      
      batch.set(newHouseholdRef, {
        name: values.name,
        ownerId: user.uid,
        members: [newMember],
        memberIds: [user.uid],
        pendingMemberEmails: [],
        splitType: 'equal',
        splits: [],
      });
      
      const userDocRef = doc(db, 'users', user.uid);
      const userDoc = await getDoc(userDocRef);
      const userHouseholds = userDoc.exists() ? (userDoc.data().households || []) : [];
      batch.set(userDocRef, { households: [...userHouseholds, newHouseholdRef.id] }, { merge: true });

      await batch.commit();

      toast({ title: "Household Created" });
      fetchData();
      setIsHouseholdDialogOpen(false);
    } catch (error) {
      console.error("Error saving household:", error);
      toast({ variant: 'destructive', title: "Error", description: "Could not save household." });
    }
  };
  
  const handleDeleteHousehold = async () => {
    if (!householdToDelete) return;
    try {
      await deleteDoc(doc(db, "households", householdToDelete.id));
      toast({ title: "Household Deleted" });
      setHouseholdToDelete(null);
      fetchData(); 
    } catch (error) {
      console.error("Error deleting household: ", error);
      toast({ variant: 'destructive', title: "Error", description: "Could not delete household." });
    }
  };
  
  const handleAcceptInvitation = async (invitation: Invitation) => {
    if (!user || !user.email) return;
    try {
        const householdRef = doc(db, 'households', invitation.householdId);
        const householdDoc = await getDoc(householdRef);

        if(!householdDoc.exists()) {
            throw new Error("This household no longer exists.");
        }

        const householdData = householdDoc.data() as Household;

        if (!householdData.pendingMemberEmails?.includes(user.email)) {
            toast({
                variant: 'destructive',
                title: 'Invitation No Longer Valid',
                description: 'The owner may have cancelled this invitation.',
            });
            const invitationRef = doc(db, 'invitations', invitation.id);
            await deleteDoc(invitationRef);
            fetchData();
            return;
        }
        
        const batch = writeBatch(db);
        const newMember: Member = { id: user.uid, name: user.displayName || 'New Member', email: user.email };
        
        batch.update(householdRef, {
            members: [...householdData.members, newMember],
            memberIds: [...householdData.memberIds, user.uid],
            pendingMemberEmails: householdData.pendingMemberEmails?.filter(email => email !== user.email) || []
        });

        const invitationRef = doc(db, 'invitations', invitation.id);
        batch.delete(invitationRef);
        
        const userDocRef = doc(db, 'users', user.uid);
        const userDoc = await getDoc(userDocRef);
        const userHouseholds = userDoc.exists() ? (userDoc.data().households || []) : [];
        batch.set(userDocRef, { households: [...userHouseholds, invitation.householdId] }, { merge: true });

        await batch.commit();

        toast({ title: "Invitation Accepted!", description: `You've joined ${invitation.householdName}.`});
        fetchData();

    } catch(e: any) {
        console.error("Error accepting invitation:", e);
        toast({ variant: 'destructive', title: "Error", description: `Could not accept invitation. Please ensure Firestore rules are updated correctly.` });
    }
  };
  
  const handleDeclineInvitation = async (invitation: Invitation) => {
    if (!user || !user.email) return;
    try {
        const batch = writeBatch(db);
        const invitationRef = doc(db, 'invitations', invitation.id);
        batch.delete(invitationRef);
        
        const householdRef = doc(db, "households", invitation.householdId);
        const householdDoc = await getDoc(householdRef);
        if (householdDoc.exists()) {
            const householdData = householdDoc.data() as Household;
            const updatedPendingEmails = householdData.pendingMemberEmails?.filter(email => email !== user.email);
            batch.update(householdRef, { pendingMemberEmails: updatedPendingEmails });
        }

        await batch.commit();

        toast({ title: "Invitation Declined" });
        fetchData();
    } catch (e) {
         console.error("Error declining invitation:", e);
         toast({ variant: 'destructive', title: "Error", description: "Could not decline invitation." });
    }
  };

  const ownedHouseholds = households.filter(h => h.ownerId === user?.uid);
  const joinedHouseholds = households.filter(h => h.ownerId !== user?.uid);

  const renderContent = () => {
    if (loading) {
      return (
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
            {[...Array(3)].map((_, i) => (
                <Card key={i}><CardHeader><Skeleton className="h-6 w-1/2 bg-muted rounded-md animate-pulse"/></CardHeader><CardContent><div className="h-4 w-1/4 bg-muted rounded-md animate-pulse"/></CardContent></Card>
            ))}
        </div>
      );
    }
    
    if (households.length === 0 && invitations.length === 0) {
      return (
        <Card className="text-center col-span-full">
          <CardHeader><div className="mx-auto bg-primary/10 text-primary p-3 rounded-full w-fit"><Home className="h-8 w-8" /></div><CardTitle>No Households Found</CardTitle><CardDescription>Create a household to get started with shared budgeting features.</CardDescription></CardHeader>
        </Card>
      );
    }

    return (
     <div className="space-y-8">
        {invitations.length > 0 && (
            <div>
                <h2 className="text-xl font-semibold mb-4">Pending Invitations</h2>
                <div className="space-y-4">
                    {invitations.map(inv => (
                         <Card key={inv.id} className="bg-muted/50">
                            <CardHeader>
                               <CardTitle className="text-lg">Join {inv.householdName}?</CardTitle>
                               <CardDescription>You have been invited to join this household.</CardDescription>
                            </CardHeader>
                            <CardFooter className="gap-2">
                                <Button onClick={() => handleAcceptInvitation(inv)}><CheckCircle className="mr-2 h-4 w-4" /> Accept</Button>
                                <Button variant="ghost" onClick={() => handleDeclineInvitation(inv)}><XCircle className="mr-2 h-4 w-4" /> Decline</Button>
                            </CardFooter>
                         </Card>
                    ))}
                </div>
            </div>
        )}
     
        {ownedHouseholds.length > 0 && (
            <div>
                <h2 className="text-xl font-semibold mb-4">My Households</h2>
                <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
                    {ownedHouseholds.map((h) => (
                        <Link href={`/household/${h.id}`} key={h.id}>
                            <Card className="hover:border-primary transition-colors h-full flex flex-col"><CardHeader><CardTitle className="flex items-center gap-2"><Home className="h-6 w-6 text-primary" />{h.name}</CardTitle><CardDescription>{h.members.length} member(s)</CardDescription></CardHeader><CardContent className="flex-grow"><ul className="text-sm text-muted-foreground space-y-1">{h.members.slice(0, 3).map(m => <li key={m.id} className="truncate">{m.name}</li>)}{h.members.length > 3 && <li>...and {h.members.length - 3} more</li>}</ul></CardContent><CardFooter><Button variant="ghost" size="icon" className="ml-auto" onClick={(e) => { e.preventDefault(); e.stopPropagation(); setHouseholdToDelete(h); }}><Trash2 className="h-4 w-4" /></Button></CardFooter></Card>
                        </Link>
                    ))}
                </div>
            </div>
        )}
        
        {joinedHouseholds.length > 0 && (
             <div>
                <h2 className="text-xl font-semibold mb-4">Joined Households</h2>
                <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
                    {joinedHouseholds.map((h) => (
                        <Link href={`/household/${h.id}`} key={h.id}>
                            <Card className="hover:border-primary transition-colors h-full flex flex-col"><CardHeader><CardTitle className="flex items-center gap-2"><Home className="h-6 w-6 text-primary" />{h.name}</CardTitle><CardDescription>{h.members.length} member(s)</CardDescription></CardHeader><CardContent className="flex-grow"><ul className="text-sm text-muted-foreground space-y-1">{h.members.slice(0, 3).map(m => <li key={m.id} className="truncate">{m.name}</li>)}{h.members.length > 3 && <li>...and {h.members.length - 3} more</li>}</ul></CardContent></Card>
                        </Link>
                    ))}
                </div>
            </div>
        )}
      </div>
    );
  };

  return (
    <>
      <Header title="Households" />
      <main className="flex-1 space-y-6 p-4 sm:p-6">
        <div className="max-w-7xl mx-auto w-full space-y-6">
            <Card>
                <CardHeader>
                    <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                        <div>
                            <CardTitle>Household Summary</CardTitle>
                            <CardDescription>An overview of your combined household finances this month.</CardDescription>
                        </div>
                        <Button id="tour-step-5-create-household-button" onClick={() => setIsHouseholdDialogOpen(true)} className="w-full sm:w-auto">
                            <PlusCircle className="mr-2 h-4 w-4" /> Create Household
                        </Button>
                    </div>
                </CardHeader>
                <CardContent>
                    {loading ? (
                        <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
                            <Card><CardHeader className="pb-2"><Skeleton className="h-5 w-2/3" /></CardHeader><CardContent><Skeleton className="h-8 w-1/2" /></CardContent></Card>
                            <Card><CardHeader className="pb-2"><Skeleton className="h-5 w-2/3" /></CardHeader><CardContent><Skeleton className="h-8 w-1/2" /></CardContent></Card>
                            <Card><CardHeader className="pb-2"><Skeleton className="h-5 w-2/3" /></CardHeader><CardContent><Skeleton className="h-8 w-1/2" /></CardContent></Card>
                            <Card><CardHeader className="pb-2"><Skeleton className="h-5 w-2/3" /></CardHeader><CardContent><Skeleton className="h-8 w-1/2" /></CardContent></Card>
                        </div>
                    ) : (
                        <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
                            <Card>
                                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                                    <CardTitle className="text-sm font-medium">Households</CardTitle>
                                    <Users className="h-4 w-4 text-muted-foreground" />
                                </CardHeader>
                                <CardContent>
                                    <div className="text-2xl font-bold">{households.length}</div>
                                </CardContent>
                            </Card>
                            <Card>
                                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                                    <CardTitle className="text-sm font-medium">Shared Income</CardTitle>
                                    <ArrowUpCircle className="h-4 w-4 text-green-500" />
                                </CardHeader>
                                <CardContent>
                                    <div className="text-2xl font-bold">{formatCurrency(totalSharedIncome, currency)}</div>
                                </CardContent>
                            </Card>
                            <Card>
                                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                                    <CardTitle className="text-sm font-medium">Shared Expenses</CardTitle>
                                    <ArrowDownCircle className="h-4 w-4 text-red-500" />
                                </CardHeader>
                                <CardContent>
                                    <div className="text-2xl font-bold">{formatCurrency(yourShareOfExpenses, currency)}</div>
                                </CardContent>
                            </Card>
                            <Card>
                                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                                    <CardTitle className="text-sm font-medium">Shared Savings</CardTitle>
                                    <PiggyBank className="h-4 w-4 text-primary" />
                                </CardHeader>
                                <CardContent>
                                    <div className="text-2xl font-bold">{formatCurrency(totalSharedSavings, currency)}</div>
                                </CardContent>
                            </Card>
                        </div>
                    )}
                </CardContent>
            </Card>
            
            {renderContent()}
        </div>
      </main>

      <Dialog open={isHouseholdDialogOpen} onOpenChange={setIsHouseholdDialogOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Create Household</DialogTitle><DialogDescription>Give your new household a name. You will be the owner.</DialogDescription></DialogHeader>
          <Form {...householdForm}>
            <form onSubmit={householdForm.handleSubmit(handleHouseholdFormSubmit)} className="space-y-4 py-4">
              <FormField control={householdForm.control} name="name" render={({ field }) => (<FormItem><FormLabel>Household Name</FormLabel><FormControl><Input placeholder="e.g., The Smiths" {...field} /></FormControl><FormMessage /></FormItem>)} />
              <DialogFooter className="gap-2 sm:gap-0"><Button type="button" variant="outline" onClick={() => setIsHouseholdDialogOpen(false)}>Cancel</Button><Button type="submit">Create</Button></DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>
      
       <AlertDialog open={!!householdToDelete} onOpenChange={(open) => !open && setHouseholdToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader><AlertDialogTitle>Are you absolutely sure?</AlertDialogTitle><AlertDialogDescription>This action cannot be undone. This will permanently delete the "{householdToDelete?.name}" household.</AlertDialogDescription></AlertDialogHeader>
          <AlertDialogFooter className="gap-2 sm:gap-0"><AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction onClick={handleDeleteHousehold}>Delete</AlertDialogAction></AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

export default function HouseholdsPage() {
    return (
        <MainLayout>
            <HouseholdsList />
        </MainLayout>
    )
}
