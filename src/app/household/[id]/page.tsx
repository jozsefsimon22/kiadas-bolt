

'use client';

import React, { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useForm, useFieldArray } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { MainLayout, useAuth } from '@/components/main-layout';
import { Header } from '@/components/header';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Separator } from '@/components/ui/separator';
import { Loader2, UserPlus, Edit, Trash2, Users, Percent, ArrowUpCircle, ArrowDownCircle, ChevronLeft, ArrowRightLeft, Home, Settings, Info, ChevronDown, Scale, Mail, History, XCircle, CalendarIcon, ChevronsUpDown, PiggyBank } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { db } from '@/lib/firebase';
import { collection, query, where, getDocs, doc, updateDoc, deleteDoc, getDoc, addDoc, serverTimestamp, writeBatch, orderBy, limit } from 'firebase/firestore';
import { useCurrency } from '@/context/currency-context';
import { formatCurrency } from '@/lib/currency';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipProvider, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip';
import { sendInvitationEmail } from '@/actions/invitations';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import { format } from 'date-fns';
import { Progress } from '@/components/ui/progress';

// Types and Schemas
type IncomeChange = { id: string; amount: number; date: Date; };
type Member = { id: string; name: string; email: string; incomeHistory?: IncomeChange[]; };
type Split = { memberId: string; share: number; };
type HouseholdEvent = { id: string; actorId: string; timestamp: Date; message: string; actorName: string; };
type Household = { id: string; ownerId: string; name: string; members: Member[]; memberIds: string[]; pendingMemberEmails?: string[]; splitType?: 'equal' | 'shares' | 'income_ratio'; splits?: Split[]; events?: HouseholdEvent[] };
type Invitation = { id: string; invitedBy: string; invitedEmail: string; householdId: string; householdName: string; };

// Transaction Types
type AmountChange = { id: string; amount: number; date: Date; };
type BaseTransaction = { id: string; userId: string; name: string; amounts: AmountChange[]; frequency: 'one-off' | 'recurring'; endDate?: Date | null; };
type Income = BaseTransaction & { transactionType: 'income'; categoryId?: string; sharing: string; };
type Expense = BaseTransaction & { transactionType: 'expense'; sharing: string; classification?: 'need' | 'want'; categoryId?: string; };
type Transaction = Income | Expense;

// Savings Goal Types
type SavingGoalContribution = { id: string; amount: number; date: Date; };
type SavingGoal = { id: string; userId: string; name: string; targetAmount: number; targetDate: Date; startDate: Date; sharing: 'personal' | string; contributions: SavingGoalContribution[]; };

const householdNameSchema = z.object({
    name: z.string().min(1, 'Household name is required.'),
});

const memberNameSchema = z.object({
    name: z.string().min(1, 'Member name is required.'),
});

const incomeChangeSchema = z.object({
    amount: z.coerce.number().min(0, 'Income must be a non-negative number.'),
    date: z.date({ required_error: 'A date for the income change is required.' }),
});

const inviteMemberSchema = z.object({
  email: z.string().email('Please enter a valid email address.'),
});

const getIncomeForDate = (member: Member | undefined, targetDate: Date): number => {
    if (!member || !member.incomeHistory || member.incomeHistory.length === 0) return 0;
    const sortedHistory = [...member.incomeHistory].sort((a, b) => b.date.getTime() - a.date.getTime());
    const activeIncome = sortedHistory.find(i => i.date <= targetDate);
    return activeIncome ? activeIncome.amount : 0;
};

const splitSchema = z.object({
    splitType: z.enum(['equal', 'shares', 'income_ratio'], { required_error: 'You must select a split type.' }),
    splits: z.array(z.object({
        memberId: z.string(),
        name: z.string(),
        share: z.coerce.number().min(0, "Must be non-negative."),
    })),
}).refine(data => {
    if (data.splitType === 'shares') {
        const totalShares = data.splits.reduce((sum, split) => sum + (split.share || 0), 0);
        return totalShares > 0;
    }
    return true;
}, {
    message: 'Total shares must be greater than 0 if splitting by shares.',
    path: ['splits'],
});

const getAmountForDate = (transaction: Transaction, targetDate: Date): number => {
    if (!transaction.amounts || transaction.amounts.length === 0) return 0;
    const sortedAmounts = [...transaction.amounts].sort((a, b) => b.date.getTime() - a.date.getTime());
    const activeAmount = sortedAmounts.find(a => a.date <= targetDate);
    return activeAmount ? activeAmount.amount : 0;
};

// Main Component
function HouseholdDetail() {
  const user = useAuth();
  const params = useParams();
  const router = useRouter();
  const householdId = params.id as string;
  const { toast } = useToast();
  const { currency } = useCurrency();
  const [household, setHousehold] = useState<Household | null>(null);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [savingsGoals, setSavingsGoals] = useState<SavingGoal[]>([]);
  const [householdInvitations, setHouseholdInvitations] = useState<Invitation[]>([]);
  const [loading, setLoading] = useState(true);
  
  const [isInviteDialogOpen, setIsInviteDialogOpen] = useState(false);
  const [isSplitSettingsOpen, setIsSplitSettingsOpen] = useState(false);
  const [isEditHouseholdDialogOpen, setIsEditHouseholdDialogOpen] = useState(false);
  const [isEditMemberDialogOpen, setIsEditMemberDialogOpen] = useState(false);
  const [isIncomeHistoryDialogOpen, setIsIncomeHistoryDialogOpen] = useState(false);
  
  const [memberToDelete, setMemberToDelete] = useState<Member | null>(null);
  const [editingMember, setEditingMember] = useState<Member | null>(null);
  const [memberForIncomeHistory, setMemberForIncomeHistory] = useState<Member | null>(null);
  const [invitationToCancel, setInvitationToCancel] = useState<string | null>(null);

  const householdNameForm = useForm<z.infer<typeof householdNameSchema>>({
    resolver: zodResolver(householdNameSchema),
  });

  const memberNameForm = useForm<z.infer<typeof memberNameSchema>>({
      resolver: zodResolver(memberNameSchema),
  });
  
  const incomeChangeForm = useForm<z.infer<typeof incomeChangeSchema>>({
    resolver: zodResolver(incomeChangeSchema),
  });

  const inviteForm = useForm<z.infer<typeof inviteMemberSchema>>({
    resolver: zodResolver(inviteMemberSchema),
    defaultValues: { email: '' },
  });
  
  const splitForm = useForm<z.infer<typeof splitSchema>>({
    resolver: zodResolver(splitSchema),
    defaultValues: {
      splitType: 'equal',
      splits: [],
    },
  });
  
  const { fields: splitFields } = useFieldArray({
      control: splitForm.control,
      name: 'splits'
  });

  const logHouseholdEvent = async (message: string) => {
    if (!household || !user) return;
    try {
        const householdRef = doc(db, 'households', household.id);
        const newEvent: Omit<HouseholdEvent, 'id'> = {
            actorId: user.uid,
            actorName: user.displayName || 'A user',
            message: message,
            timestamp: new Date(),
        };
        const currentEvents = (household.events || []).map(e => ({...e, timestamp: e.timestamp}));
        const updatedEvents = [{...newEvent, id: crypto.randomUUID()}, ...currentEvents].slice(0, 15);
        await updateDoc(householdRef, { events: updatedEvents });
    } catch (error) {
        console.error("Error logging household event:", error);
    }
  };

  async function fetchData() {
    if (!user || !householdId) return;
    setLoading(true);
    try {
      const householdRef = doc(db, "households", householdId);
      const householdDoc = await getDoc(householdRef);
      
      if (householdDoc.exists() && householdDoc.data().memberIds?.includes(user.uid)) {
        const data = householdDoc.data();
        const householdData = { 
            id: householdDoc.id, 
            ...data,
            members: (data.members || []).map((m: any) => ({
                ...m,
                incomeHistory: (m.incomeHistory || []).map((i: any) => ({...i, date: i.date.toDate()}))
            })),
            events: (data.events || []).map((e: any) => ({
                ...e,
                timestamp: e.timestamp.toDate(),
            })).sort((a: any, b: any) => b.timestamp.getTime() - a.timestamp.getTime()),
        } as Household;
        setHousehold(householdData);

        const transactionsQuery = query(collection(db, 'transactions'), where('sharing', '==', householdData.id));
        const savingsGoalsQuery = query(collection(db, 'savings'), where('sharing', '==', householdData.id));
        const invitationsQuery = query(collection(db, 'invitations'), where('householdId', '==', householdId));

        const [transactionsSnapshot, savingsGoalsSnapshot, invitationsSnapshot] = await Promise.all([
          getDocs(transactionsQuery),
          getDocs(savingsGoalsQuery),
          getDocs(invitationsQuery)
        ]);

        const transactionList = transactionsSnapshot.docs.map(doc => {
            const data = doc.data();
            let amounts = (data.amounts || []).map((a: any) => ({ ...a, date: a.date.toDate() }));
            if (amounts.length === 0 && data.amount && data.startDate) {
                amounts.push({ id: 'legacy-0', amount: data.amount, date: data.startDate.toDate() });
            }
            return { id: doc.id, ...data, amounts, endDate: data.endDate ? data.endDate.toDate() : null } as Transaction;
        });
        setTransactions(transactionList);

        const savingsGoalsList = savingsGoalsSnapshot.docs.map(doc => {
            const data = doc.data();
            return {
                id: doc.id, ...data, 
                startDate: data.startDate.toDate(),
                targetDate: data.targetDate.toDate(),
                contributions: (data.contributions || []).map((c: any) => ({ ...c, date: c.date.toDate()}))
            } as SavingGoal;
        });
        setSavingsGoals(savingsGoalsList);
        
        const invitationsData = invitationsSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() as Omit<Invitation, 'id'> }));
        setHouseholdInvitations(invitationsData);

      } else {
        toast({ variant: 'destructive', title: "Not Found", description: "Household not found or you don't have access." });
        setHousehold(null);
        setTransactions([]);
        router.push('/household');
      }

    } catch (error) {
      console.error("Error fetching household data:", error);
      toast({ variant: 'destructive', title: "Error", description: "Could not fetch household data." });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchData();
  }, [user, householdId]);
  
  const { sharedIncome, sharedExpenses } = useMemo(() => {
    const today = new Date();
    const income = transactions
        .filter((t): t is Income => t.transactionType === 'income')
        .map(t => ({ ...t, displayAmount: getAmountForDate(t, today) }))
        .sort((a,b) => b.displayAmount - a.displayAmount);

    const expenses = transactions
        .filter((t): t is Expense => t.transactionType === 'expense')
        .map(t => ({ ...t, displayAmount: getAmountForDate(t, today) }))
        .sort((a,b) => b.displayAmount - a.displayAmount);
        
    return { sharedIncome: income, sharedExpenses: expenses };
  }, [transactions]);
  
  const { totalSharedIncome, totalSharedExpenses } = useMemo(() => {
    const incomeTotal = sharedIncome.reduce((sum, tx) => sum + tx.displayAmount, 0);
    const expenseTotal = sharedExpenses.reduce((sum, tx) => sum + tx.displayAmount, 0);
    return { totalSharedIncome: incomeTotal, totalSharedExpenses: expenseTotal };
  }, [sharedIncome, sharedExpenses]);

  const memberContributions = useMemo(() => {
    if (!household || totalSharedExpenses <= 0) return [];

    return household.members.map(member => {
      let share = 0;
      switch (household.splitType) {
        case 'shares':
          const totalShares = household.splits?.reduce((s, split) => s + (split.share || 0), 0) || 0;
          if (totalShares > 0) {
            const memberSplit = household.splits?.find(s => s.memberId === member.id);
            const memberShares = memberSplit?.share || 0;
            share = (totalSharedExpenses * memberShares) / totalShares;
          } else {
            share = household.members.length > 0 ? totalSharedExpenses / household.members.length : 0;
          }
          break;
        case 'income_ratio':
          const totalIncome = household.members.reduce((s, m) => s + getIncomeForDate(m, new Date()), 0);
          if (totalIncome > 0) {
            const memberIncome = getIncomeForDate(member, new Date());
            share = (totalSharedExpenses * memberIncome) / totalIncome;
          } else {
            share = household.members.length > 0 ? totalSharedExpenses / household.members.length : 0;
          }
          break;
        default: // 'equal'
          share = household.members.length > 0 ? totalSharedExpenses / household.members.length : 0;
      }
      return { name: member.name, contribution: share };
    });
  }, [household, totalSharedExpenses]);


  const watchedSplitType = splitForm.watch('splitType');
  
  useEffect(() => {
    if (isSplitSettingsOpen && household) {
        const splitType = household.splitType || 'equal';
        const formSplits = household.members.map(member => {
            const existingSplit = household.splits?.find(s => s.memberId === member.id);
            return { memberId: member.id, name: member.name, share: existingSplit?.share ?? 1 };
        });
        splitForm.reset({ splitType, splits: formSplits });
    }
  }, [isSplitSettingsOpen, household, splitForm]);

   useEffect(() => {
    if (isEditHouseholdDialogOpen && household) {
        householdNameForm.reset({ name: household.name });
    }
  }, [isEditHouseholdDialogOpen, household, householdNameForm]);

   useEffect(() => {
      if (isEditMemberDialogOpen && editingMember) {
          memberNameForm.reset({ name: editingMember.name });
      }
  }, [isEditMemberDialogOpen, editingMember, memberNameForm]);

  useEffect(() => {
      if (isIncomeHistoryDialogOpen) {
          incomeChangeForm.reset({ amount: 0, date: new Date() });
      }
  }, [isIncomeHistoryDialogOpen, incomeChangeForm]);

  const handleHouseholdNameUpdate = async (values: z.infer<typeof householdNameSchema>) => {
    if (!household || !user || user?.uid !== household.ownerId) return;
    const oldName = household.name;
    try {
        await logHouseholdEvent(`${user.displayName} updated the household name from "${oldName}" to "${values.name}".`);
        const householdRef = doc(db, "households", household.id);
        await updateDoc(householdRef, { name: values.name });

        toast({ title: "Household name updated successfully!" });
        fetchData();
    } catch(error) {
        console.error("Error updating household name:", error);
        toast({ variant: 'destructive', title: "Error", description: "Could not update household name." });
    } finally {
        setIsEditHouseholdDialogOpen(false);
    }
  };


  const handleInviteSubmit = async (values: z.infer<typeof inviteMemberSchema>) => {
    if (!household || !user || user.uid !== household.ownerId) {
      toast({ variant: 'destructive', title: "Unauthorized", description: "Only the household owner can invite members." });
      return;
    }
    
    if (values.email === user.email) {
      toast({ variant: 'destructive', title: "You can't invite yourself." });
      return;
    }

    if (household.members.some(m => m.email === values.email)) {
      toast({ variant: 'destructive', title: "Already a Member", description: "This user is already in the household." });
      return;
    }

    if (household.pendingMemberEmails?.includes(values.email)) {
       toast({ variant: 'destructive', title: "Already Invited", description: "An invitation has already been sent to this email." });
       return;
    }

    try {
        const batch = writeBatch(db);

        // Add to invitations collection
        const invitationRef = doc(collection(db, 'invitations'));
        batch.set(invitationRef, {
            householdId: household.id,
            householdName: household.name,
            invitedBy: user.uid,
            invitedEmail: values.email,
            createdAt: serverTimestamp(),
        });
        
        // Add to pending emails on household
        const householdRef = doc(db, "households", household.id);
        batch.update(householdRef, {
            pendingMemberEmails: [...(household.pendingMemberEmails || []), values.email]
        });

        await batch.commit();
        
        // Send email notification
        await sendInvitationEmail({
            invitedEmail: values.email,
            householdName: household.name,
            inviterName: user.displayName || 'A Kiadas user',
        });

        await logHouseholdEvent(`${user.displayName} invited ${values.email} to the household.`);

        toast({ title: "Invitation Sent", description: `An invitation has been sent to ${values.email}.` });
        fetchData();
        setIsInviteDialogOpen(false);
        inviteForm.reset();
    } catch(e) {
        console.error("Error sending invitation:", e);
        toast({ variant: 'destructive', title: "Error", description: "Could not send invitation." });
    }
  };
  
  const handleCancelInvitation = async () => {
    if (!household || !invitationToCancel || !user) return;
    try {
        const batch = writeBatch(db);

        // Find and delete the invitation document
        const invitationsRef = collection(db, 'invitations');
        const q = query(
            invitationsRef,
            where('householdId', '==', household.id),
            where('invitedEmail', '==', invitationToCancel),
        );
        const querySnapshot = await getDocs(q);

        if (!querySnapshot.empty) {
            const invitationDoc = querySnapshot.docs[0];
            batch.delete(invitationDoc.ref);
        } else {
            console.warn(`Could not find invitation document for ${invitationToCancel} in household ${household.id}`);
        }
        
        // Remove from pending emails on household
        const householdRef = doc(db, 'households', household.id);
        const updatedPendingEmails = household.pendingMemberEmails?.filter(email => email !== invitationToCancel) || [];
        batch.update(householdRef, { pendingMemberEmails: updatedPendingEmails });

        await batch.commit();
        
        await logHouseholdEvent(`${user.displayName} cancelled the invitation for ${invitationToCancel}.`);
        toast({ title: "Invitation Cancelled" });
        fetchData();
    } catch (e) {
        console.error("Error cancelling invitation:", e);
        toast({ variant: 'destructive', title: "Error", description: "Could not cancel the invitation." });
    } finally {
        setInvitationToCancel(null);
    }
  };
  
  const handleRemoveDeclinedInvitation = async (emailToRemove: string) => {
    if (!household || !user || user.uid !== household.ownerId) return;

    const updatedPendingEmails = household.pendingMemberEmails?.filter(email => email !== emailToRemove) || [];

    try {
        const householdRef = doc(db, "households", household.id);
        await updateDoc(householdRef, { pendingMemberEmails: updatedPendingEmails });
        await logHouseholdEvent(`${user.displayName} removed the declined invitation for ${emailToRemove}.`);
        toast({ title: "Declined invitation removed." });
        fetchData();
    } catch (error) {
        console.error("Error removing declined invitation:", error);
        toast({ variant: 'destructive', title: "Error", description: "Could not remove declined invitation." });
    }
  };

  const handleDeleteMember = async () => {
    if (!household || !memberToDelete || !user || user.uid !== household.ownerId) return;
    
    // Prevent owner from deleting themselves
    if (memberToDelete.id === household.ownerId) {
        toast({ variant: 'destructive', title: 'Cannot Remove Owner', description: 'The household owner cannot be removed.' });
        setMemberToDelete(null);
        return;
    }
    
    const updatedMembers = household.members.filter(m => m.id !== memberToDelete.id);
    const updatedMemberIds = household.memberIds.filter(id => id !== memberToDelete.id);

    try {
      await logHouseholdEvent(`${user.displayName} removed ${memberToDelete.name} from the household.`);
      const householdRef = doc(db, "households", household.id);
      await updateDoc(householdRef, { members: updatedMembers, memberIds: updatedMemberIds });
      toast({ title: "Member Removed" });
      fetchData();
    } catch (error) {
       console.error("Error removing member:", error);
       toast({ variant: 'destructive', title: "Error", description: "Could not remove member." });
    } finally {
        setMemberToDelete(null);
    }
  };
  
  const handleSplitSave = async (values: z.infer<typeof splitSchema>) => {
    if (!household || !user) return;

    const payload: Partial<Household> = {
        splitType: values.splitType
    };

    if (values.splitType === 'shares') {
        payload.splits = values.splits.map(({ memberId, share }) => ({
            memberId,
            share: Number(share) || 0,
        }));
    } else {
        payload.splits = [];
    }

    try {
      const getRuleText = (type: string) => {
          if (type === 'shares') return 'Split by Shares';
          if (type === 'income_ratio') return 'Split by Income Ratio';
          return 'Equal Split';
      }
      await logHouseholdEvent(`${user.displayName} updated the expense split rule to "${getRuleText(values.splitType)}".`);
      const householdRef = doc(db, "households", household.id);
      await updateDoc(householdRef, payload);
      
      toast({ title: "Split settings saved!" });
      fetchData();
      setIsSplitSettingsOpen(false);
    } catch (error) {
      console.error("Error saving split settings:", error);
      toast({
        variant: 'destructive',
        title: "Error",
        description: "Could not save split settings.",
      });
    }
  };
  
    const handleSaveMemberName = async (values: z.infer<typeof memberNameSchema>) => {
        if (!household || !editingMember || !user || user.uid !== household.ownerId) return;

        const updatedMembers = household.members.map(member =>
            member.id === editingMember.id ? { ...member, name: values.name } : member
        );
        
        try {
            const householdRef = doc(db, "households", household.id);
            await updateDoc(householdRef, { members: updatedMembers });
            toast({ title: "Member name updated!" });
            fetchData();
        } catch (error) {
            console.error("Error updating member name:", error);
            toast({ variant: 'destructive', title: "Error", description: "Could not update member name." });
        } finally {
            setIsEditMemberDialogOpen(false);
            setEditingMember(null);
        }
    };
    
    const handleIncomeHistorySave = async (values: z.infer<typeof incomeChangeSchema>) => {
        if (!household || !memberForIncomeHistory) return;
        
        const updatedMembers = household.members.map(m => {
            if (m.id === memberForIncomeHistory.id) {
                const newIncome: IncomeChange = { ...values, id: crypto.randomUUID() };
                const newHistory = [...(m.incomeHistory || []), newIncome].sort((a,b) => a.date.getTime() - b.date.getTime());
                return { ...m, incomeHistory: newHistory };
            }
            return m;
        });

        try {
            const householdRef = doc(db, "households", household.id);
            await updateDoc(householdRef, { members: updatedMembers });
            toast({ title: "Income history updated!" });
            fetchData();
            setIsIncomeHistoryDialogOpen(false);
        } catch(error) {
            console.error("Error updating income history:", error);
            toast({ variant: 'destructive', title: "Error", description: "Could not update income history." });
        }
    };

    const handleIncomeHistoryDelete = async (incomeId: string) => {
        if (!household || !memberForIncomeHistory) return;

        const updatedMembers = household.members.map(m => {
            if (m.id === memberForIncomeHistory.id) {
                const newHistory = (m.incomeHistory || []).filter(i => i.id !== incomeId);
                return { ...m, incomeHistory: newHistory };
            }
            return m;
        });

        try {
            const householdRef = doc(db, "households", household.id);
            await updateDoc(householdRef, { members: updatedMembers });
            toast({ title: "Income entry deleted!" });
            fetchData();
        } catch(error) {
            console.error("Error deleting income entry:", error);
            toast({ variant: 'destructive', title: "Error", description: "Could not delete income entry." });
        }
    };

  const SharedIncomeTable = ({ data, currency }: { data: (Income & {displayAmount: number})[], currency: string }) => {
    if (data.length === 0) {
      return <div className="text-center text-sm text-muted-foreground p-8">No shared income to display.</div>;
    }
    return (
      <Table>
        <TableHeader><TableRow><TableHead>Name</TableHead><TableHead className="text-right">Amount</TableHead></TableRow></TableHeader>
        <TableBody>
          {data.map(tx => (
            <TableRow key={tx.id}>
              <TableCell>
                <Link href={`/transaction/${tx.id}`} className="font-medium hover:underline">{tx.name}</Link>
              </TableCell>
              <TableCell className={`text-right font-mono text-green-400`}>
                {formatCurrency(tx.displayAmount, currency)}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    );
  };
  
  const SharedExpenseTable = ({ data, household, currency }: { data: (Expense & {displayAmount: number})[], household: Household, currency: string }) => {
    const [expandedRow, setExpandedRow] = useState<string | null>(null);

    if (data.length === 0) {
      return <div className="text-center text-sm text-muted-foreground p-8">No shared expenses to display.</div>;
    }

    const getMemberName = (memberId: string) => {
        return household.members.find(m => m.id === memberId)?.name || 'Unknown User';
    };

    const calculateShares = (totalAmount: number) => {
        return household.members.map(member => {
            let share = 0;
            switch (household.splitType) {
                case 'shares':
                    const totalShares = household.splits?.reduce((s, split) => s + (split.share || 0), 0) || 0;
                    if (totalShares > 0) {
                        const memberSplit = household.splits?.find(s => s.memberId === member.id);
                        const memberShares = memberSplit?.share || 0;
                        share = (totalAmount * memberShares) / totalShares;
                    } else {
                        share = household.members.length > 0 ? totalAmount / household.members.length : 0;
                    }
                    break;
                case 'income_ratio':
                    const totalIncome = household.members.reduce((s, m) => s + getIncomeForDate(m, new Date()), 0);
                    if (totalIncome > 0) {
                        const memberIncome = getIncomeForDate(member, new Date());
                        share = (totalAmount * memberIncome) / totalIncome;
                    } else {
                        share = household.members.length > 0 ? totalAmount / household.members.length : 0;
                    }
                    break;
                default: // 'equal'
                    share = household.members.length > 0 ? totalAmount / household.members.length : 0;
            }
            return { name: member.name, share };
        });
    };
    
    return (
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Expense</TableHead>
            <TableHead>Added By</TableHead>
            <TableHead className="text-right">Total Amount</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {data.map(tx => {
            const isExpanded = expandedRow === tx.id;
            return (
              <React.Fragment key={tx.id}>
                <TableRow 
                  className="cursor-pointer hover:bg-muted/50 data-[state=open]:bg-muted/50"
                  onClick={() => setExpandedRow(isExpanded ? null : tx.id)}
                  data-state={isExpanded ? 'open' : 'closed'}
                >
                  <TableCell>
                    <div className="flex items-center gap-2">
                        <ChevronDown className={cn("h-4 w-4 transition-transform", isExpanded && "rotate-180")} />
                        <Link href={`/transaction/${tx.id}`} onClick={(e) => e.stopPropagation()} className="font-medium hover:underline">{tx.name}</Link>
                    </div>
                  </TableCell>
                  <TableCell>{getMemberName(tx.userId)}</TableCell>
                  <TableCell className="text-right font-mono text-red-400">
                    {formatCurrency(tx.displayAmount, currency)}
                  </TableCell>
                </TableRow>
                {isExpanded && (
                  <TableRow>
                    <TableCell colSpan={3} className="p-0">
                      <div className="p-4 bg-muted/30">
                        <h4 className="font-semibold mb-2 text-sm">Member Shares:</h4>
                        <ul className="space-y-1 text-sm">
                          {calculateShares(tx.displayAmount).map(s => (
                            <li key={s.name} className="flex justify-between">
                              <span className="text-muted-foreground">{s.name}</span>
                              <span className="font-mono">{formatCurrency(s.share, currency)}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    </TableCell>
                  </TableRow>
                )}
              </React.Fragment>
            )
          })}
        </TableBody>
      </Table>
    );
  };
  
  const SharedSavingsTable = ({ goals, currency, isOwner }: { goals: SavingGoal[], currency: string, isOwner: boolean }) => {
    if (goals.length === 0) {
      return <div className="text-center text-sm text-muted-foreground p-8">No shared savings goals yet. Add one from the Savings page.</div>;
    }
    return (
        <div className="space-y-4">
            {goals.map(goal => {
                const currentAmount = goal.contributions.reduce((sum, c) => sum + c.amount, 0);
                const progress = goal.targetAmount > 0 ? Math.min((currentAmount / goal.targetAmount) * 100, 100) : 0;
                return (
                    <Link key={goal.id} href={`/savings/${goal.id}`} className="block">
                        <Card className="hover:bg-muted/50">
                            <CardHeader className="pb-2">
                                <div className="flex justify-between items-start">
                                    <CardTitle className="text-base font-medium">{goal.name}</CardTitle>
                                    <div className="text-right">
                                        <p className="font-semibold">{formatCurrency(currentAmount, currency)}</p>
                                        <p className="text-xs text-muted-foreground">of {formatCurrency(goal.targetAmount, currency)}</p>
                                    </div>
                                </div>
                            </CardHeader>
                            <CardContent>
                                <Progress value={progress} className="h-2" />
                            </CardContent>
                        </Card>
                    </Link>
                );
            })}
        </div>
    );
  };

  const getSplitRuleText = () => {
    if (!household) return '';
    switch (household.splitType) {
        case 'shares': return 'Split by Shares';
        case 'income_ratio': return 'Split by Income Ratio';
        default: return 'Equal Split';
    }
  }

  const renderContent = () => {
    if (loading) {
      return (
        <div className="flex justify-center items-center h-64">
          <Loader2 className="h-12 w-12 animate-spin text-muted-foreground" />
        </div>
      );
    }

    if (!household) {
      return null;
    }
    
    const isOwner = user.uid === household.ownerId;
    const pendingCount = household.pendingMemberEmails?.filter(email => householdInvitations.some(inv => inv.invitedEmail === email)).length || 0;
    const declinedCount = (household.pendingMemberEmails?.length || 0) - pendingCount;

    return (
     <div className="space-y-6">
        <Card>
            <CardHeader className="flex-row items-start justify-between">
                <div className="flex items-center gap-3">
                    <Home className="h-8 w-8 text-primary" />
                    <div>
                        <div className="flex items-center gap-2">
                            <CardTitle>{household.name}</CardTitle>
                            {isOwner && (
                                <Dialog open={isEditHouseholdDialogOpen} onOpenChange={setIsEditHouseholdDialogOpen}>
                                    <DialogTrigger asChild>
                                        <Button variant="ghost" size="icon" className="h-6 w-6">
                                            <Edit className="h-4 w-4" />
                                        </Button>
                                    </DialogTrigger>
                                    <DialogContent>
                                        <DialogHeader>
                                            <DialogTitle>Edit Household Name</DialogTitle>
                                        </DialogHeader>
                                        <Form {...householdNameForm}>
                                            <form id="edit-household-form" onSubmit={householdNameForm.handleSubmit(handleHouseholdNameUpdate)} className="space-y-4 pt-4">
                                                 <FormField
                                                    control={householdNameForm.control}
                                                    name="name"
                                                    render={({ field }) => (
                                                        <FormItem>
                                                            <FormLabel>Household Name</FormLabel>
                                                            <FormControl>
                                                                <Input placeholder="e.g. Smith Residence" {...field} autoFocus />
                                                            </FormControl>
                                                            <FormMessage />
                                                        </FormItem>
                                                    )}
                                                />
                                            </form>
                                        </Form>
                                         <DialogFooter>
                                            <Button type="button" variant="outline" onClick={() => setIsEditHouseholdDialogOpen(false)}>Cancel</Button>
                                            <Button type="submit" form="edit-household-form">Save Changes</Button>
                                        </DialogFooter>
                                    </DialogContent>
                                </Dialog>
                            )}
                        </div>
                        <CardDescription>An overview of your household's shared finances.</CardDescription>
                    </div>
                </div>
                {isOwner && (
                    <Dialog open={isInviteDialogOpen} onOpenChange={setIsInviteDialogOpen}>
                        <DialogTrigger asChild>
                            <Button variant="outline">
                                <UserPlus className="mr-2 h-4 w-4" /> Invite Member
                            </Button>
                        </DialogTrigger>
                        <DialogContent>
                            <DialogHeader>
                                <DialogTitle>Invite New Member</DialogTitle>
                                <DialogDescription>Enter the email address of the person you want to invite to this household.</DialogDescription>
                            </DialogHeader>
                            <Form {...inviteForm}>
                                <form id="invite-form" onSubmit={inviteForm.handleSubmit(handleInviteSubmit)} className="space-y-4 pt-4">
                                     <FormField
                                        control={inviteForm.control}
                                        name="email"
                                        render={({ field }) => (
                                            <FormItem>
                                                <FormLabel>Email Address</FormLabel>
                                                <FormControl>
                                                    <Input type="email" placeholder="member@example.com" {...field} />
                                                </FormControl>
                                                <FormMessage />
                                            </FormItem>
                                        )}
                                    />
                                </form>
                            </Form>
                             <DialogFooter>
                                <Button type="button" variant="outline" onClick={() => setIsInviteDialogOpen(false)}>Cancel</Button>
                                <Button type="submit" form="invite-form">Send Invitation</Button>
                            </DialogFooter>
                        </DialogContent>
                    </Dialog>
                )}
            </CardHeader>
            <CardContent className="grid gap-6 sm:grid-cols-2">
                <Card>
                    <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
                        <CardTitle className="text-sm font-medium">This Month's Shared Income</CardTitle>
                        <ArrowUpCircle className="h-4 w-4 text-green-500" />
                    </CardHeader>
                    <CardContent>
                        <p className="text-2xl font-bold">{formatCurrency(totalSharedIncome, currency)}</p>
                    </CardContent>
                </Card>
                <Card>
                    <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
                        <CardTitle className="text-sm font-medium">This Month's Shared Expenses</CardTitle>
                        <ArrowDownCircle className="h-4 w-4 text-red-500" />
                    </CardHeader>
                    <CardContent>
                        <p className="text-2xl font-bold">{formatCurrency(totalSharedExpenses, currency)}</p>
                    </CardContent>
                </Card>
            </CardContent>
             <CardFooter className="flex-wrap justify-between items-center gap-4 border-t pt-[10px]">
                <div className="flex items-center gap-2">
                    <Dialog>
                    <DialogTrigger asChild>
                        <div className="cursor-pointer hover:opacity-80 transition-opacity">
                          <div className="relative flex -space-x-2">
                              {household.members.slice(0, 5).map(member => (
                                  <Avatar key={member.id} className="h-8 w-8 border-2 border-background">
                                      <AvatarFallback>{member.name ? member.name.charAt(0).toUpperCase() : '?'}</AvatarFallback>
                                  </Avatar>
                              ))}
                              {household.members.length > 5 && (
                                  <Avatar className="h-8 w-8 border-2 border-background">
                                      <AvatarFallback>+{household.members.length - 5}</AvatarFallback>
                                  </Avatar>
                              )}
                          </div>
                        </div>
                    </DialogTrigger>
                    <DialogContent className="sm:max-w-md">
                        <DialogHeader>
                        <DialogTitle>Household Members</DialogTitle>
                        </DialogHeader>
                        <div className="space-y-4">
                            {household.members.map(member => (
                                <div key={member.id} className="flex items-center gap-4">
                                    <Avatar>
                                        <AvatarFallback>{member.name ? member.name.charAt(0).toUpperCase() : '?'}</AvatarFallback>
                                    </Avatar>
                                    <div className="flex-1">
                                        <p className="font-medium">{member.name}</p>
                                        <p className="text-sm text-muted-foreground">{member.email}</p>
                                    </div>
                                    {household.ownerId === member.id && (
                                        <Badge variant="secondary" className="ml-auto">Owner</Badge>
                                    )}
                                    {isOwner && (
                                        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => { setEditingMember(member); setIsEditMemberDialogOpen(true); }}>
                                            <Edit className="h-4 w-4" />
                                        </Button>
                                    )}
                                </div>
                            ))}
                            {household.pendingMemberEmails && household.pendingMemberEmails.length > 0 && (
                                <>
                                    <Separator className="my-2" />
                                    <h4 className="font-medium text-sm text-muted-foreground">Invitations</h4>
                                    <div className="space-y-3">
                                    {household.pendingMemberEmails.map(email => {
                                        const invitation = householdInvitations.find(inv => inv.invitedEmail === email);
                                        return (
                                            <div key={email} className="flex items-center justify-between gap-4">
                                                <div className="flex items-center gap-4 min-w-0">
                                                <Avatar>
                                                    <AvatarFallback><Mail className="h-4 w-4 text-muted-foreground" /></AvatarFallback>
                                                </Avatar>
                                                <p className="text-sm text-muted-foreground truncate">{email}</p>
                                                </div>
                                                {invitation ? (
                                                    isOwner && (
                                                        <TooltipProvider>
                                                        <Tooltip>
                                                            <TooltipTrigger asChild>
                                                            <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" onClick={() => setInvitationToCancel(email)}>
                                                                <XCircle className="h-4 w-4 text-destructive" />
                                                                <span className="sr-only">Cancel Invitation</span>
                                                            </Button>
                                                            </TooltipTrigger>
                                                            <TooltipContent>
                                                                <p>Cancel Invitation</p>
                                                            </TooltipContent>
                                                        </Tooltip>
                                                        </TooltipProvider>
                                                    )
                                                ) : (
                                                    <div className="flex items-center gap-1">
                                                        <Badge variant="outline">Declined</Badge>
                                                        {isOwner && (
                                                            <TooltipProvider>
                                                                <Tooltip>
                                                                    <TooltipTrigger asChild>
                                                                        <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" onClick={() => handleRemoveDeclinedInvitation(email)}>
                                                                            <Trash2 className="h-4 w-4 text-destructive" />
                                                                            <span className="sr-only">Remove Declined Invitation</span>
                                                                        </Button>
                                                                    </TooltipTrigger>
                                                                    <TooltipContent><p>Remove from list</p></TooltipContent>
                                                                </Tooltip>
                                                            </TooltipProvider>
                                                        )}
                                                    </div>
                                                )}
                                            </div>
                                        );
                                    })}
                                    </div>
                                </>
                            )}
                        </div>
                    </DialogContent>
                    </Dialog>
                    {(pendingCount > 0 || declinedCount > 0) && (
                        <p className="text-xs text-muted-foreground">
                            {pendingCount > 0 && `${pendingCount} pending`}
                            {pendingCount > 0 && declinedCount > 0 && ', '}
                            {declinedCount > 0 && `${declinedCount} declined`}
                        </p>
                    )}
                </div>

                <div className="flex items-center gap-1">
                    <Dialog open={isSplitSettingsOpen} onOpenChange={setIsSplitSettingsOpen}>
                        <DialogTrigger asChild>
                            <Button variant="ghost">
                                <Percent className="mr-2 h-4 w-4" />
                                {getSplitRuleText()}
                                <Settings className="ml-2 h-4 w-4" />
                            </Button>
                        </DialogTrigger>
                        <DialogContent className="max-w-md">
                        <Form {...splitForm}>
                                <form onSubmit={splitForm.handleSubmit(handleSplitSave)}>
                                    <DialogHeader>
                                        <DialogTitle>Expense Split Settings</DialogTitle>
                                        <DialogDescription>Define how shared expenses are split between members. This only applies to new shared expenses.</DialogDescription>
                                    </DialogHeader>
                                    <div className="py-4 space-y-6">
                                        <FormField
                                            control={splitForm.control}
                                            name="splitType"
                                            render={({ field }) => (
                                                <FormItem className="space-y-3">
                                                <FormLabel>Split Method</FormLabel>
                                                <FormControl>
                                                    <RadioGroup onValueChange={field.onChange} defaultValue={field.value} className="flex flex-col space-y-1">
                                                    <FormItem className="flex items-center space-x-3 space-y-0"><FormControl><RadioGroupItem value="equal" /></FormControl><FormLabel className="font-normal">Split equally between all members</FormLabel></FormItem>
                                                    <FormItem className="flex items-center space-x-3 space-y-0"><FormControl><RadioGroupItem value="shares" /></FormControl><FormLabel className="font-normal">Split by shares</FormLabel></FormItem>
                                                    {household.members.length > 1 && (
                                                      <FormItem className="flex items-center space-x-3 space-y-0"><FormControl><RadioGroupItem value="income_ratio" /></FormControl><FormLabel className="font-normal">Split by income ratio</FormLabel></FormItem>
                                                    )}
                                                    </RadioGroup>
                                                </FormControl>
                                                <FormMessage />
                                                </FormItem>
                                            )}
                                        />
                                        {watchedSplitType === 'shares' && (
                                            <div>
                                                <Separator className="my-4" />
                                                <h4 className="text-sm font-medium mb-2">Shares per member</h4>
                                                <div className="space-y-4">
                                                {splitFields.map((field, index) => (
                                                    <FormField
                                                    key={field.id}
                                                    control={splitForm.control}
                                                    name={`splits.${index}.share`}
                                                    render={({ field: formField }) => (
                                                        <FormItem>
                                                            <FormLabel>{field.name}</FormLabel>
                                                            <FormControl>
                                                                <Input type="number" placeholder="1" {...formField} value={formField.value ?? ''} onFocus={e => e.target.select()} />
                                                            </FormControl>
                                                            <FormMessage />
                                                        </FormItem>
                                                    )}
                                                    />
                                                ))}
                                                </div>
                                                {splitForm.formState.errors.splits && (<p className="text-sm font-medium text-destructive mt-2">{splitForm.formState.errors.splits.message}</p>)}
                                            </div>
                                        )}
                                        {watchedSplitType === 'income_ratio' && household.members.length > 1 && (
                                            <div>
                                                <Separator className="my-4" />
                                                <h4 className="text-sm font-medium mb-2">Member Income</h4>
                                                <p className="text-sm text-muted-foreground mb-4">Set each member's income. This will be used to calculate the expense ratio. This can be updated over time.</p>
                                                <div className="space-y-2">
                                                    {household.members.map(member => (
                                                        <div key={member.id} className="flex items-center justify-between p-2 border rounded-md">
                                                            <div>
                                                                <p className="font-medium">{member.name}</p>
                                                                <p className="text-sm text-muted-foreground">Current: {formatCurrency(getIncomeForDate(member, new Date()), currency)}/month</p>
                                                            </div>
                                                            <Button type="button" variant="outline" size="sm" onClick={() => { setMemberForIncomeHistory(member); setIsIncomeHistoryDialogOpen(true); }}>
                                                                <ChevronsUpDown className="mr-2 h-4 w-4"/>
                                                                Manage
                                                            </Button>
                                                        </div>
                                                    ))}
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                    <DialogFooter>
                                        <Button type="button" variant="outline" onClick={() => setIsSplitSettingsOpen(false)}>Cancel</Button>
                                        <Button type="submit" disabled={!isOwner || splitForm.formState.isSubmitting}>
                                            {splitForm.formState.isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                                            Save Settings
                                        </Button>
                                    </DialogFooter>
                                </form>
                        </Form>
                        </DialogContent>
                    </Dialog>
                    <TooltipProvider>
                        <Tooltip>
                            <TooltipTrigger asChild>
                                <Button asChild variant="ghost" size="icon">
                                    <Link href={`/household/${household.id}/history`}>
                                        <History className="h-4 w-4" />
                                        <span className="sr-only">View History</span>
                                    </Link>
                                </Button>
                            </TooltipTrigger>
                            <TooltipContent>
                                <p>View Activity Log</p>
                            </TooltipContent>
                        </Tooltip>
                    </TooltipProvider>
                </div>
            </CardFooter>
        </Card>
      
        <Card>
            <CardHeader>
                <CardTitle className="flex items-center gap-2">
                    <Scale className="h-6 w-6 text-primary" />
                    Monthly Contributions
                </CardTitle>
                <CardDescription>
                    Estimated contribution for each member for this month's shared expenses, based on the '{getSplitRuleText()}' rule.
                </CardDescription>
            </CardHeader>
            <CardContent>
                {memberContributions.length > 0 ? (
                    <ul className="space-y-4">
                        {memberContributions.map(member => (
                            <li key={member.name} className="flex justify-between items-center">
                                <span className="font-medium">{member.name}</span>
                                <span className="font-mono text-lg font-semibold">{formatCurrency(member.contribution, currency)}</span>
                            </li>
                        ))}
                    </ul>
                ) : (
                    <p className="text-sm text-muted-foreground text-center py-4">No shared expenses to calculate contributions this month.</p>
                )}
            </CardContent>
        </Card>

        <Card>
            <CardHeader>
                <CardTitle className="flex items-center gap-2">
                    <ArrowRightLeft className="h-6 w-6 text-primary" />
                    Shared Items
                </CardTitle>
                <CardDescription>A list of all income, expenses, and savings goals linked to this household.</CardDescription>
            </CardHeader>
            <CardContent>
                 <Tabs defaultValue="expenses">
                    <TabsList className="grid w-full grid-cols-3">
                        <TabsTrigger value="income"><ArrowUpCircle className="mr-2 h-4 w-4" />Shared Income</TabsTrigger>
                        <TabsTrigger value="expenses"><ArrowDownCircle className="mr-2 h-4 w-4" />Shared Expenses</TabsTrigger>
                        <TabsTrigger value="savings"><PiggyBank className="mr-2 h-4 w-4" />Shared Savings</TabsTrigger>
                    </TabsList>
                    <TabsContent value="income">
                        <SharedIncomeTable data={sharedIncome} currency={currency} />
                    </TabsContent>
                    <TabsContent value="expenses">
                        <SharedExpenseTable data={sharedExpenses} household={household} currency={currency} />
                    </TabsContent>
                    <TabsContent value="savings">
                        <SharedSavingsTable goals={savingsGoals} currency={currency} isOwner={isOwner} />
                    </TabsContent>
                </Tabs>
            </CardContent>
        </Card>
      </div>
    );
  };

  return (
    <>
      <Header title={loading ? 'Loading...' : (household?.name || 'Household')} />
      <main className="flex-1 space-y-6 p-4 sm:p-6">
        <div className="max-w-7xl mx-auto w-full space-y-6">
            <Button asChild variant="outline" className="w-fit">
                <Link href="/household"><ChevronLeft className="mr-2 h-4 w-4" /> All Households</Link>
            </Button>
            <div className="max-w-4xl mx-auto">
                {renderContent()}
            </div>
        </div>
      </main>
      
      <AlertDialog open={!!memberToDelete} onOpenChange={(open) => !open && setMemberToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader><AlertDialogTitle>Are you sure?</AlertDialogTitle><AlertDialogDescription>This action will remove {memberToDelete?.name} from the household. This cannot be undone.</AlertDialogDescription></AlertDialogHeader>
          <AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction onClick={handleDeleteMember}>Delete Member</AlertDialogAction></AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      
      <Dialog open={isEditMemberDialogOpen} onOpenChange={setIsEditMemberDialogOpen}>
          <DialogContent>
              <DialogHeader>
                  <DialogTitle>Edit Member Name</DialogTitle>
                  <DialogDescription>Update the display name for {editingMember?.name}.</DialogDescription>
              </DialogHeader>
              <Form {...memberNameForm}>
                  <form id="edit-member-form" onSubmit={memberNameForm.handleSubmit(handleSaveMemberName)} className="space-y-4 pt-4">
                      <FormField
                          control={memberNameForm.control}
                          name="name"
                          render={({ field }) => (
                              <FormItem>
                                  <FormLabel>Name</FormLabel>
                                  <FormControl>
                                      <Input {...field} autoFocus />
                                  </FormControl>
                                  <FormMessage />
                              </FormItem>
                          )}
                      />
                  </form>
              </Form>
              <DialogFooter>
                  <Button type="button" variant="outline" onClick={() => setIsEditMemberDialogOpen(false)}>Cancel</Button>
                  <Button type="submit" form="edit-member-form">Save Name</Button>
              </DialogFooter>
          </DialogContent>
      </Dialog>
      
      <AlertDialog open={!!invitationToCancel} onOpenChange={(open) => !open && setInvitationToCancel(null)}>
        <AlertDialogContent>
            <AlertDialogHeader>
                <AlertDialogTitle>Are you sure?</AlertDialogTitle>
                <AlertDialogDescription>
                    This will cancel the invitation for {invitationToCancel}. They will no longer be able to join this household using this invite.
                </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
                <AlertDialogCancel onClick={() => setInvitationToCancel(null)}>Go back</AlertDialogCancel>
                <AlertDialogAction onClick={handleCancelInvitation}>Yes, Cancel Invitation</AlertDialogAction>
            </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={isIncomeHistoryDialogOpen} onOpenChange={setIsIncomeHistoryDialogOpen}>
        <DialogContent>
            <DialogHeader>
                <DialogTitle>Income History for {memberForIncomeHistory?.name}</DialogTitle>
                <DialogDescription>Manage the income history. The most recent entry will be used for future expense splits.</DialogDescription>
            </DialogHeader>
            <div className="py-4 space-y-4">
                <Table>
                    <TableHeader><TableRow><TableHead>Effective Date</TableHead><TableHead className="text-right">Monthly Income</TableHead><TableHead className="text-right w-[50px]"> </TableHead></TableRow></TableHeader>
                    <TableBody>
                        {memberForIncomeHistory?.incomeHistory?.sort((a,b) => b.date.getTime() - a.date.getTime()).map(income => (
                            <TableRow key={income.id}>
                                <TableCell>{format(income.date, 'PP')}</TableCell>
                                <TableCell className="text-right font-mono">{formatCurrency(income.amount, currency)}</TableCell>
                                <TableCell className="text-right">
                                    <Button variant="ghost" size="icon" onClick={() => handleIncomeHistoryDelete(income.id)}>
                                        <Trash2 className="h-4 w-4" />
                                    </Button>
                                </TableCell>
                            </TableRow>
                        ))}
                    </TableBody>
                </Table>

                <Separator />
                
                 <Form {...incomeChangeForm}>
                    <form id="income-change-form" onSubmit={incomeChangeForm.handleSubmit(handleIncomeHistorySave)} className="space-y-4 pt-4">
                        <h4 className="font-medium">Add New Income Entry</h4>
                         <FormField control={incomeChangeForm.control} name="amount" render={({ field }) => (
                            <FormItem><FormLabel>New Monthly Income</FormLabel><FormControl><Input type="number" {...field} /></FormControl><FormMessage /></FormItem>
                         )} />
                         <FormField control={incomeChangeForm.control} name="date" render={({ field }) => (
                            <FormItem className="flex flex-col"><FormLabel>Effective Date</FormLabel><Popover><PopoverTrigger asChild><FormControl><Button variant={"outline"} className={cn("w-full pl-3 text-left font-normal", !field.value && "text-muted-foreground")}>{field.value ? format(field.value, "PPP") : <span>Pick a date</span>}<CalendarIcon className="ml-auto h-4 w-4 opacity-50" /></Button></FormControl></PopoverTrigger><PopoverContent className="w-auto p-0" align="start"><Calendar mode="single" selected={field.value} onSelect={field.onChange} disabled={{ after: new Date() }} /></PopoverContent></Popover><FormMessage /></FormItem>
                         )} />
                    </form>
                </Form>
            </div>
            <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setIsIncomeHistoryDialogOpen(false)}>Close</Button>
                <Button type="submit" form="income-change-form">Add Entry</Button>
            </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

export default function HouseholdDetailPage() {
    return (
        <MainLayout>
            <HouseholdDetail />
        </MainLayout>
    )
}
