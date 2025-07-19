
'use client';

import React, { useState, useMemo, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { AlertCircle, ArrowDown, ArrowUp, BarChart, CalendarIcon, Edit, Home, Landmark, Loader2, PlusCircle, Trash2, Wallet } from 'lucide-react';
import { useToast } from "@/hooks/use-toast";
import { MainLayout, useAuth } from '@/components/main-layout';
import { Header } from '@/components/header';
import { db } from '@/lib/firebase';
import { collection, getDocs, addDoc, doc, updateDoc, deleteDoc, query, where } from 'firebase/firestore';
import { useCurrency } from '@/context/currency-context';
import { formatCurrency } from '@/lib/currency';
import { getConversionRate } from '@/services/currency-service';
import { defaultAssetTypes, DefaultCategory } from '@/lib/categories';
import DynamicIcon from '@/components/dynamic-icon';

type AssetType = string;

type Contribution = {
  id: string;
  amount: number;
  date: Date;
};

type ValueChange = {
  id: string;
  value: number;
  date: Date;
}

type Asset = {
  id: string;
  userId: string;
  name: string;
  type: AssetType;
  currency: string;
  valueHistory: ValueChange[];
  contributions: Contribution[];
};

// This type includes the calculated, converted values for display
type ProcessedAsset = Asset & {
  value: number;
  totalInvested: number;
  growth: number;
  startDate: Date;
};

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
  contributions: SavingGoalContribution[];
};

type Category = DefaultCategory & {
  id: string;
  userId?: string;
  isDefault?: boolean;
};

const assetSchema = z.object({
  name: z.string().min(1, 'Asset name is required.'),
  type: z.string({ required_error: "You need to select an asset type."}).min(1, "You need to select an asset type."),
  initialValue: z.coerce.number().min(0, 'Initial value must be a positive number.'),
  startDate: z.date({
    required_error: "A start date for the asset is required.",
  }),
  currency: z.string().length(3, 'A currency is required.'),
});

type SortableKey = 'name' | 'type' | 'startDate' | 'value' | 'totalInvested' | 'growth';

function Assets() {
  const user = useAuth();
  const router = useRouter();
  const { currency } = useCurrency();
  const [assets, setAssets] = useState<ProcessedAsset[]>([]);
  const [savingsGoals, setSavingsGoals] = useState<SavingGoal[]>([]);
  const [assetTypes, setAssetTypes] = useState<Category[]>([]);
  const [isDataLoading, setIsDataLoading] = useState(true);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingAsset, setEditingAsset] = useState<Asset | null>(null);
  const [assetToDelete, setAssetToDelete] = useState<Asset | null>(null);
  const { toast } = useToast();
  const [sortConfig, setSortConfig] = useState<{ key: SortableKey, direction: 'ascending' | 'descending' }>({ key: 'value', direction: 'descending' });

  const form = useForm<z.infer<typeof assetSchema>>({
    resolver: zodResolver(assetSchema),
    defaultValues: {
      name: '',
      initialValue: 0,
    },
  });

  async function fetchData() {
    if (!user) return;
    setIsDataLoading(true);
    try {
        const assetsQuery = query(collection(db, 'assets'), where('userId', '==', user.uid));
        const savingsQuery = query(collection(db, 'savings'), where('userId', '==', user.uid));
        const assetTypesQuery = query(collection(db, 'assetTypes'), where('userId', '==', user.uid));

        const [assetsSnapshot, savingsSnapshot, assetTypesSnapshot] = await Promise.all([
            getDocs(assetsQuery),
            getDocs(savingsQuery),
            getDocs(assetTypesQuery),
        ]);

        const customAssetTypes = assetTypesSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Category));
        const allAssetTypes = [
            ...defaultAssetTypes.map(c => ({...c, id: `default-${c.name}`, isDefault: true})), 
            ...customAssetTypes
        ].sort((a,b) => a.name.localeCompare(b.name));
        setAssetTypes(allAssetTypes);

        const assetsList = assetsSnapshot.docs.map(doc => {
            const data = doc.data();
            return {
                id: doc.id,
                ...data,
                currency: data.currency || 'USD',
                valueHistory: (data.valueHistory || []).map((v: any) => ({ ...v, date: v.date.toDate() })),
                contributions: (data.contributions || []).map((c: any) => ({ ...c, date: c.date.toDate() }))
            } as Asset;
        });

        const rates = new Map<string, number>();
        rates.set(currency, 1);
        const uniqueCurrencies = [...new Set(assetsList.map(a => a.currency).filter(c => c !== currency))];
        
        await Promise.all(uniqueCurrencies.map(async (assetCurrency) => {
            if (!rates.has(assetCurrency)) {
                const rate = await getConversionRate(assetCurrency, currency);
                rates.set(assetCurrency, rate);
            }
        }));

        const processedAssets = assetsList.map(asset => {
            const rate = rates.get(asset.currency) || 1;
            const sortedHistory = [...asset.valueHistory].sort((a,b) => a.date.getTime() - b.date.getTime());
            
            const initialValue = (sortedHistory[0]?.value || 0) * rate;
            const currentValue = (sortedHistory[sortedHistory.length - 1]?.value || 0) * rate;
            
            const totalContributions = asset.contributions.reduce((sum, c) => sum + (c.amount * rate), 0);
            const totalInvested = initialValue + totalContributions;
            const growth = currentValue - totalInvested;

            return { 
                ...asset, 
                value: currentValue,
                totalInvested, 
                growth, 
                startDate: sortedHistory[0]?.date || new Date(),
            };
        });
        setAssets(processedAssets);
        
        const savingsList = savingsSnapshot.docs.map(doc => {
            const data = doc.data();
            return {
                id: doc.id,
                ...data,
                startDate: data.startDate.toDate(),
                targetDate: data.targetDate.toDate(),
                contributions: (data.contributions || []).map((c: any) => ({ ...c, date: c.date.toDate() })),
            } as SavingGoal;
        });
        setSavingsGoals(savingsList);

    } catch (error) {
        console.error("Error fetching data:", error);
        toast({ variant: 'destructive', title: "Error", description: "Could not load your data." });
    } finally {
        setIsDataLoading(false);
    }
  }

  useEffect(() => {
    fetchData();
  }, [user, currency]);
  
  useEffect(() => {
    if (editingAsset) {
      const sortedHistory = [...editingAsset.valueHistory].sort((a,b) => a.date.getTime() - b.date.getTime());
      form.reset({
        name: editingAsset.name,
        type: editingAsset.type,
        currency: editingAsset.currency,
        initialValue: sortedHistory[0]?.value || 0,
        startDate: sortedHistory[0]?.date || new Date(),
      });
    } else {
      form.reset({ name: '', type: assetTypes[0]?.name, initialValue: 0, startDate: new Date(), currency });
    }
  }, [editingAsset, form, currency, assetTypes]);
  
  const sortedAssets = useMemo(() => {
    const sortableAssets = [...assets];
    sortableAssets.sort((a, b) => {
      if (a[sortConfig.key] < b[sortConfig.key]) {
        return sortConfig.direction === 'ascending' ? -1 : 1;
      }
      if (a[sortConfig.key] > b[sortConfig.key]) {
        return sortConfig.direction === 'ascending' ? 1 : -1;
      }
      return 0;
    });

    return sortableAssets;
  }, [assets, sortConfig]);

  const assetTypesMap = useMemo(() => new Map(assetTypes.map(t => [t.name, t])), [assetTypes]);

  const requestSort = (key: SortableKey) => {
    let direction: 'ascending' | 'descending' = 'ascending';
    if (sortConfig.key === key && sortConfig.direction === 'ascending') {
      direction = 'descending';
    }
    setSortConfig({ key, direction });
  };

  const totalNetWorth = useMemo(() => {
    const assetsTotal = assets.reduce((total, asset) => total + asset.value, 0);
    const savingsTotal = savingsGoals.reduce((total, goal) => total + goal.contributions.reduce((cTotal, c) => cTotal + c.amount, 0), 0);
    return assetsTotal + savingsTotal;
  }, [assets, savingsGoals]);

  const handleDeleteAsset = async () => {
    if (!assetToDelete) return;
    try {
      await deleteDoc(doc(db, "assets", assetToDelete.id));
      toast({ title: "Asset Deleted", description: `"${assetToDelete.name}" has been removed.` });
      setAssetToDelete(null);
      fetchData(); 
    } catch (error) {
      console.error("Error deleting asset: ", error);
      toast({ variant: 'destructive', title: "Error", description: "Could not delete asset." });
    }
  };

  const handleFormSubmit = async (values: z.infer<typeof assetSchema>) => {
    if (!user) return;
    try {
      if (editingAsset) {
        const assetRef = doc(db, "assets", editingAsset.id);
        const newHistory = [...editingAsset.valueHistory].sort((a,b) => a.date.getTime() - b.date.getTime());
        newHistory[0] = { ...newHistory[0], value: values.initialValue, date: values.startDate };

        const payload = { 
            name: values.name,
            type: values.type,
            currency: values.currency,
            valueHistory: newHistory,
        };
        await updateDoc(assetRef, payload);
        toast({ title: "Asset Updated", description: "Your asset has been successfully updated." });
      } else {
        const payload = { 
            name: values.name, 
            type: values.type, 
            currency: values.currency,
            userId: user.uid, 
            contributions: [],
            valueHistory: [{ id: crypto.randomUUID(), value: values.initialValue, date: values.startDate }]
        };
        await addDoc(collection(db, "assets"), payload);
        toast({ title: "Asset Added", description: "Your new asset has been successfully added." });
      }
      setEditingAsset(null);
      setIsDialogOpen(false);
      fetchData();
    } catch(error) {
      console.error("Error saving asset: ", error);
      toast({ variant: 'destructive', title: "Error", description: "Could not save asset." });
    }
  };
  
  const openAddDialog = () => {
    setEditingAsset(null);
    form.reset({ name: '', type: assetTypes[0]?.name, initialValue: 0, startDate: new Date(), currency });
    setIsDialogOpen(true);
  };
  
  const openEditDialog = (asset: Asset) => {
    setEditingAsset(asset);
    setIsDialogOpen(true);
  };
  
  const openDeleteDialog = (asset: Asset) => {
    setAssetToDelete(asset);
  };
  
  const SortableHeader = ({ title, sortKey, className }: { title: string, sortKey: SortableKey, className?: string }) => (
    <TableHead className={cn('p-0', className)}>
      <Button variant="ghost" onClick={() => requestSort(sortKey)} className={cn("w-full h-auto py-3 px-4 font-medium", className?.includes('text-right') ? 'justify-end' : 'justify-start')}>
        {title}
        {sortConfig.key === sortKey && (
            sortConfig.direction === 'ascending' ? <ArrowUp className="ml-2 h-4 w-4" /> : <ArrowDown className="ml-2 h-4 w-4" />
        )}
      </Button>
    </TableHead>
  );

  return (
    <>
      <Header title="Assets" />
      <main className="flex-1 space-y-6 p-4 sm:p-6">
        <div className="max-w-7xl mx-auto w-full space-y-6">
            <Card>
                <CardHeader>
                <CardTitle>Total Net Worth</CardTitle>
                <CardDescription>This is the combined value of all your assets and savings.</CardDescription>
                </CardHeader>
                <CardContent>
                {isDataLoading ? <Skeleton className="h-10 w-3/4" /> :
                    <p className="text-4xl font-bold tracking-tight text-primary">
                    {formatCurrency(totalNetWorth, currency)}
                    </p>
                }
                </CardContent>
            </Card>

            <Card>
            <CardHeader>
                <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                    <div>
                        <CardTitle>Your Assets</CardTitle>
                        <CardDescription>A list of your current assets and their performance.</CardDescription>
                    </div>
                    <Button id="tour-step-7-add-asset-button" onClick={openAddDialog} className="w-full sm:w-auto">
                        <PlusCircle /> Add Asset
                    </Button>
                </div>
            </CardHeader>
            <CardContent>
                {isDataLoading ? (
                    <div className="flex justify-center items-center py-12">
                        <Loader2 className="mx-auto h-8 w-8 animate-spin text-muted-foreground" />
                    </div>
                ) : sortedAssets.length === 0 ? (
                    <div className="text-center py-12 text-muted-foreground">No assets yet. Add one to get started!</div>
                ) : (
                    <>
                        {/* Mobile View */}
                        <div className="space-y-4 md:hidden">
                            {sortedAssets.map(asset => {
                                const growthPercentage = asset.totalInvested > 0 ? (asset.growth / asset.totalInvested) * 100 : 0;
                                const growthColor = asset.growth >= 0 ? 'text-green-400' : 'text-red-400';
                                return (
                                    <Card key={asset.id} className="p-4 cursor-pointer" onClick={() => router.push(`/asset/${asset.id}`)}>
                                        <div className="flex justify-between items-start">
                                            <div className="flex items-center gap-3 font-medium">
                                                <DynamicIcon name={assetTypesMap.get(asset.type)?.icon || 'Landmark'} className="h-6 w-6 text-muted-foreground" />
                                                <div>
                                                    <p>{asset.name} {asset.currency !== currency && `(${asset.currency})`}</p>
                                                    <p className="text-sm text-muted-foreground">{asset.type}</p>
                                                </div>
                                            </div>
                                            <div className="flex -mr-2 -mt-2">
                                                <Button variant="ghost" size="icon" onClick={(e) => { e.stopPropagation(); openEditDialog(asset); }}><Edit className="h-4 w-4" /></Button>
                                                <Button variant="ghost" size="icon" onClick={(e) => { e.stopPropagation(); openDeleteDialog(asset); }}><Trash2 className="h-4 w-4" /></Button>
                                            </div>
                                        </div>
                                        <div className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                                            <div>
                                                <p className="text-muted-foreground">Value</p>
                                                <p className="font-mono">{formatCurrency(asset.value, currency)}</p>
                                            </div>
                                            <div className="text-right">
                                                <p className="text-muted-foreground">Growth</p>
                                                <p className={`font-mono ${growthColor}`}>{formatCurrency(asset.growth, currency)}</p>
                                            </div>
                                            <div>
                                                <p className="text-muted-foreground">Invested</p>
                                                <p className="font-mono">{formatCurrency(asset.totalInvested, currency)}</p>
                                            </div>
                                            <div className="text-right">
                                                <p className="text-muted-foreground">Growth %</p>
                                                <p className={`font-mono ${growthColor}`}>{growthPercentage.toFixed(2)}%</p>
                                            </div>
                                        </div>
                                    </Card>
                                )
                            })}
                        </div>

                        {/* Desktop View */}
                        <Table className="hidden md:table">
                            <TableHeader>
                                <TableRow>
                                <SortableHeader title="Asset" sortKey="name" />
                                <SortableHeader title="Type" sortKey="type" />
                                <SortableHeader title="Start Date" sortKey="startDate" />
                                <SortableHeader title="Value" sortKey="value" className="text-right" />
                                <SortableHeader title="Total Invested" sortKey="totalInvested" className="text-right" />
                                <SortableHeader title="Growth" sortKey="growth" className="text-right" />
                                <TableHead className="text-right w-[100px]">Actions</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                            {sortedAssets.map(asset => {
                                const growthPercentage = asset.totalInvested > 0 ? (asset.growth / asset.totalInvested) * 100 : 0;
                                const growthColor = asset.growth >= 0 ? 'text-green-400' : 'text-red-400';
                                return (
                                    <TableRow key={asset.id} className="cursor-pointer" onClick={() => router.push(`/asset/${asset.id}`)}>
                                    <TableCell>
                                        <div className="flex items-center gap-3">
                                        <DynamicIcon name={assetTypesMap.get(asset.type)?.icon || 'Landmark'} className="h-6 w-6 text-muted-foreground" />
                                        <div>
                                            <span className="font-medium">{asset.name}</span>
                                            {asset.currency !== currency && <span className="text-xs text-muted-foreground ml-1">({asset.currency})</span>}
                                        </div>
                                        </div>
                                    </TableCell>
                                    <TableCell>{asset.type}</TableCell>
                                    <TableCell>
                                        {format(asset.startDate, "PP")}
                                    </TableCell>
                                    <TableCell className="text-right font-mono">{formatCurrency(asset.value, currency)}</TableCell>
                                    <TableCell className="text-right font-mono">{formatCurrency(asset.totalInvested, currency)}</TableCell>
                                    <TableCell className={`text-right font-mono ${growthColor}`}>
                                        {formatCurrency(asset.growth, currency)} ({growthPercentage.toFixed(2)}%)
                                    </TableCell>
                                    <TableCell className="text-right">
                                        <Button variant="ghost" size="icon" onClick={(e) => { e.stopPropagation(); openEditDialog(asset); }}>
                                        <Edit className="h-4 w-4" />
                                        </Button>
                                        <Button variant="ghost" size="icon" onClick={(e) => { e.stopPropagation(); openDeleteDialog(asset); }}>
                                        <Trash2 className="h-4 w-4" />
                                        </Button>
                                    </TableCell>
                                    </TableRow>
                                );
                                })}
                            </TableBody>
                        </Table>
                    </>
                )}
            </CardContent>
            </Card>
        </div>
      </main>

      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{editingAsset ? 'Edit Asset' : 'Add New Asset'}</DialogTitle>
            <DialogDescription>
              {editingAsset ? 'Update the details of your asset.' : 'Enter the details of your new asset to track it.'}
            </DialogDescription>
          </DialogHeader>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(handleFormSubmit)} className="space-y-4 py-4">
              <FormField control={form.control} name="name" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Asset Name</FormLabel>
                    <FormControl><Input placeholder="e.g., My 401k" {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
               <FormField control={form.control} name="type" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Asset Type</FormLabel>
                    <Select onValueChange={field.onChange} defaultValue={field.value}>
                      <FormControl>
                        <SelectTrigger><SelectValue placeholder="Select an asset type" /></SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {assetTypes.map(type => (
                            <SelectItem key={type.id} value={type.name}>{type.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField control={form.control} name="currency" render={({ field }) => (
                <FormItem>
                    <FormLabel>Currency</FormLabel>
                    <Select onValueChange={field.onChange} defaultValue={field.value}>
                        <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                        <SelectContent>
                            <SelectItem value="USD">USD - US Dollar</SelectItem>
                            <SelectItem value="EUR">EUR - Euro</SelectItem>
                            <SelectItem value="GBP">GBP - British Pound</SelectItem>
                            <SelectItem value="JPY">JPY - Japanese Yen</SelectItem>
                            <SelectItem value="CAD">CAD - Canadian Dollar</SelectItem>
                            <SelectItem value="AUD">AUD - Australian Dollar</SelectItem>
                            <SelectItem value="HUF">HUF - Hungarian Forint</SelectItem>
                        </SelectContent>
                    </Select>
                    <FormMessage />
                </FormItem>
              )} />
              <div className="grid grid-cols-2 gap-4">
                <FormField control={form.control} name="startDate" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Start Date</FormLabel>
                    <Popover><PopoverTrigger asChild><FormControl>
                        <Button variant={"outline"} className={cn("w-full pl-3 text-left font-normal", !field.value && "text-muted-foreground")}>
                          {field.value ? format(field.value, "PPP") : <span>Pick a date</span>}
                          <CalendarIcon className="ml-auto h-4 w-4 opacity-50" />
                        </Button>
                    </FormControl></PopoverTrigger>
                    <PopoverContent className="w-auto p-0" align="start">
                      <Calendar mode="single" selected={field.value} onSelect={field.onChange} disabled={[{ after: new Date() }, { before: new Date("1900-01-01") }]} />
                    </PopoverContent></Popover>
                    <FormMessage />
                  </FormItem>
                )}
              />
                <FormField control={form.control} name="initialValue" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Initial / Current Value</FormLabel>
                      <FormControl><Input type="number" placeholder="10000" {...field} onFocus={(e) => e.target.select()} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
              <DialogFooter className="gap-2 sm:gap-0">
                <Button type="button" variant="outline" onClick={() => setIsDialogOpen(false)}>Cancel</Button>
                <Button type="submit">{editingAsset ? 'Update Asset' : 'Add Asset'}</Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!assetToDelete} onOpenChange={(open) => !open && setAssetToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Are you sure?</AlertDialogTitle>
            <AlertDialogDescription>
              This action cannot be undone. This will permanently delete the asset "{assetToDelete?.name}".
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="gap-2 sm:gap-0">
            <AlertDialogCancel onClick={() => setAssetToDelete(null)}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteAsset}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

export default function AssetsPage() {
    return (
        <MainLayout>
            <Assets />
        </MainLayout>
    )
}
