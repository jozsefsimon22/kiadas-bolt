
'use client';

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { MainLayout, useAuth } from '@/components/main-layout';
import { Header } from '@/components/header';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Skeleton } from '@/components/ui/skeleton';
import { PlusCircle, Edit, Trash2, Loader2, TrendingUp, TrendingDown, Search, Filter, CalendarIcon } from 'lucide-react';
import { useToast } from "@/hooks/use-toast";
import { db } from '@/lib/firebase';
import { collection, getDocs, addDoc, doc, updateDoc, deleteDoc, query, where } from 'firebase/firestore';
import { useCurrency } from '@/context/currency-context';
import { formatCurrency } from '@/lib/currency';
import { getStockPrice, searchStocks, StockSearchResult } from '@/services/investment-service';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { Check } from 'lucide-react';
import { DropdownMenu, DropdownMenuContent, DropdownMenuCheckboxItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { getConversionRate } from '@/services/currency-service';
import { format as formatDate } from "date-fns";
import { useRouter } from 'next/navigation';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';


type InvestmentTransaction = {
    id: string;
    date: Date;
    shares: number;
    price: number;
    currency: string;
};

type Investment = {
  id: string;
  userId: string;
  ticker: string;
  name: string;
  transactions: InvestmentTransaction[];
};

type ProcessedInvestment = Investment & {
  totalShares: number;
  totalCost: number;
  totalGainLoss: number;
  totalGainLossPercent: number;
  currentPrice?: number;
  currentValue?: number;
  change?: number;
  changePercent?: number;
};

const investmentSchema = z.object({
  ticker: z.string().min(1, 'Ticker symbol is required.').max(10, 'Ticker is too long.').transform(v => v.toUpperCase()),
  name: z.string().min(1, 'Stock name is required'),
  shares: z.coerce.number().positive('Number of shares must be positive.'),
  price: z.coerce.number().positive('Price per share must be positive.'),
  currency: z.string().length(3, 'A currency is required.'),
  date: z.date({ required_error: "A purchase date is required." }),
});

function StockSearch({ onSelect, initialValue }: { onSelect: (stock: StockSearchResult) => void; initialValue?: { ticker: string, name: string } }) {
  const [open, setOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<StockSearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [selectedStock, setSelectedStock] = useState<StockSearchResult | null>(null);
  const [typeFilter, setTypeFilter] = useState<string[]>([]);
  const [regionFilter, setRegionFilter] = useState<string[]>([]);

  useEffect(() => {
    if (initialValue && (!selectedStock || selectedStock.symbol !== initialValue.ticker)) {
        setSelectedStock({ symbol: initialValue.ticker, name: initialValue.name, type: '', region: '', currency: '', uniqueKey: `${initialValue.ticker}-${initialValue.name}` });
    }
  }, [initialValue, selectedStock]);

  useEffect(() => {
    if (searchQuery.length < 1) {
      setSearchResults([]);
      return;
    }
    const debounce = setTimeout(async () => {
      setIsSearching(true);
      const results = await searchStocks(searchQuery);
      setSearchResults(results);
      setIsSearching(false);
    }, 500);

    return () => clearTimeout(debounce);
  }, [searchQuery]);

  const handleSelect = (result: StockSearchResult) => {
    setSelectedStock(result);
    onSelect(result);
    setOpen(false);
  };
  
  const filteredDisplayResults = useMemo(() => {
    return searchResults.filter(result => {
      const typeMatch = typeFilter.length > 0 ? typeFilter.includes(result.type) : true;
      const regionMatch = regionFilter.length > 0 ? regionFilter.includes(result.region) : true;
      return typeMatch && regionMatch;
    });
  }, [searchResults, typeFilter, regionFilter]);

  const availableTypes = useMemo(() => Array.from(new Set(searchResults.map(r => r.type).filter(Boolean))), [searchResults]);
  const availableRegions = useMemo(() => Array.from(new Set(searchResults.map(r => r.region).filter(Boolean))), [searchResults]);
  
  const displayValue = selectedStock?.name ? `${selectedStock.symbol} - ${selectedStock.name}` : (initialValue?.name || "Select stock...");

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="w-full justify-between"
          disabled={!!initialValue}
        >
          <span className="truncate">{displayValue}</span>
          <Search className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0" align="start">
        <Command shouldFilter={false}>
          <CommandInput 
            placeholder="Search by name or ticker..." 
            value={searchQuery}
            onValueChange={setSearchQuery}
          />
           {(availableTypes.length > 0 || availableRegions.length > 0) && (
             <div className="flex items-center gap-2 p-2 border-b">
                 <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                        <Button variant="outline" size="sm" className="h-8">
                            <Filter className="mr-2 h-4 w-4" />
                            Type
                            {typeFilter.length > 0 && <span className="ml-2 rounded-full bg-primary/10 px-2 text-xs text-primary">{typeFilter.length}</span>}
                        </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="start" onFocusOutside={(e) => e.preventDefault()}>
                        <DropdownMenuLabel>Filter by Type</DropdownMenuLabel>
                        <DropdownMenuSeparator />
                        {availableTypes.map(type => (
                            <DropdownMenuCheckboxItem
                                key={type}
                                checked={typeFilter.includes(type)}
                                onCheckedChange={(checked) => {
                                    setTypeFilter(prev => checked ? [...prev, type] : prev.filter(t => t !== type));
                                }}
                                onSelect={(e) => e.preventDefault()}
                            >
                                {type}
                            </DropdownMenuCheckboxItem>
                        ))}
                    </DropdownMenuContent>
                 </DropdownMenu>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                        <Button variant="outline" size="sm" className="h-8">
                            <Filter className="mr-2 h-4 w-4" />
                            Region
                             {regionFilter.length > 0 && <span className="ml-2 rounded-full bg-primary/10 px-2 text-xs text-primary">{regionFilter.length}</span>}
                        </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="start" onFocusOutside={(e) => e.preventDefault()}>
                        <DropdownMenuLabel>Filter by Region</DropdownMenuLabel>
                        <DropdownMenuSeparator />
                        {availableRegions.map(region => (
                            <DropdownMenuCheckboxItem
                                key={region}
                                checked={regionFilter.includes(region)}
                                onCheckedChange={(checked) => {
                                    setRegionFilter(prev => checked ? [...prev, region] : prev.filter(r => r !== region));
                                }}
                                onSelect={(e) => e.preventDefault()}
                            >
                                {region}
                            </DropdownMenuCheckboxItem>
                        ))}
                    </DropdownMenuContent>
                 </DropdownMenu>
             </div>
           )}
          <CommandList>
            {isSearching && <CommandEmpty>Searching...</CommandEmpty>}
            {!isSearching && filteredDisplayResults.length === 0 && searchQuery.length > 1 && <CommandEmpty>No results found.</CommandEmpty>}
            <CommandGroup>
              {filteredDisplayResults.map((result) => (
                <CommandItem
                  key={result.uniqueKey}
                  value={result.symbol}
                  onSelect={() => handleSelect(result)}
                >
                  <Check
                    className={cn(
                      "mr-2 h-4 w-4",
                      selectedStock?.symbol === result.symbol ? "opacity-100" : "opacity-0"
                    )}
                  />
                  <div>
                    <p className="font-bold">{result.symbol} <span className="text-xs font-normal text-muted-foreground">{result.type}</span></p>
                    <p className="text-xs text-muted-foreground">{result.name}</p>
                  </div>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}

function Investments() {
  const user = useAuth();
  const router = useRouter();
  const { currency } = useCurrency();
  const [investments, setInvestments] = useState<ProcessedInvestment[]>([]);
  const [isDataLoading, setIsDataLoading] = useState(true);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingInvestment, setEditingInvestment] = useState<Investment | null>(null);
  const [investmentToDelete, setInvestmentToDelete] = useState<Investment | null>(null);
  const [conversionRates, setConversionRates] = useState<Map<string, number>>(new Map());
  const { toast } = useToast();
  
  const form = useForm<z.infer<typeof investmentSchema>>({
    resolver: zodResolver(investmentSchema),
    defaultValues: { ticker: '', name: '', shares: 0, price: 0, currency: currency, date: new Date() },
  });

  const fetchInvestmentData = useCallback(async () => {
    if (!user) return;
    setIsDataLoading(true);
    try {
      const q = query(collection(db, 'investments'), where('userId', '==', user.uid));
      const querySnapshot = await getDocs(q);
      const investmentsList = querySnapshot.docs.map(doc => {
          const data = doc.data();
          return {
              id: doc.id,
              ...data,
              transactions: (data.transactions || []).map((t: any) => ({ ...t, currency: t.currency || 'USD', date: t.date.toDate() }))
          } as Investment
      });
      
      const uniqueCurrencies = new Set(investmentsList.flatMap(inv => inv.transactions.map(t => t.currency)));
      uniqueCurrencies.add('USD'); // Always need USD for stock prices
      
      const rates = new Map<string, number>();
      await Promise.all(
        Array.from(uniqueCurrencies).map(async (curr) => {
          if (curr !== currency) {
              const rate = await getConversionRate(curr, currency);
              rates.set(curr, rate);
          } else {
              rates.set(curr, 1);
          }
        })
      );
      setConversionRates(rates);

      const processedList: Omit<ProcessedInvestment, 'currentPrice' | 'currentValue' | 'change' | 'changePercent'>[] = investmentsList.map(inv => {
        const totalShares = inv.transactions.reduce((sum, t) => sum + t.shares, 0);
        const totalCost = inv.transactions.reduce((sum, t) => {
            const rate = rates.get(t.currency) || 1; // From transaction currency to global currency
            return sum + (t.shares * t.price * rate);
        }, 0);
        
        return {
            ...inv,
            totalShares,
            totalCost,
            totalGainLoss: 0, // Placeholder
            totalGainLossPercent: 0 // Placeholder
        };
      });

      setInvestments(processedList);

    } catch (error) {
      console.error("Error fetching investments:", error);
      toast({ variant: 'destructive', title: "Error", description: "Could not load your investments." });
    } finally {
      setIsDataLoading(false);
    }
  }, [user, toast, currency]);

  const fetchPrices = useCallback(async (investmentsToFetch: ProcessedInvestment[]) => {
    if (investmentsToFetch.length === 0 || conversionRates.size === 0) return;

    const usdToGlobalRate = conversionRates.get('USD') || 1;

    const updatedInvestments = await Promise.all(
      investmentsToFetch.map(async (inv) => {
        if (inv.currentPrice !== undefined) return inv;
        try {
          const priceData = await getStockPrice(inv.ticker);
          if (priceData && priceData.price !== null) {
            const currentValue = inv.totalShares * priceData.price * usdToGlobalRate;
            const totalGainLoss = currentValue - inv.totalCost;
            const totalGainLossPercent = inv.totalCost > 0 ? (totalGainLoss / inv.totalCost) * 100 : 0;
            
            return {
              ...inv,
              currentPrice: priceData.price,
              change: priceData.change,
              changePercent: priceData.changePercent,
              currentValue,
              totalGainLoss,
              totalGainLossPercent,
            };
          }
        } catch (error) {
          console.error(`Error fetching price for ${inv.ticker}:`, error);
        }
        return { ...inv, currentPrice: 0, currentValue: 0, change: 0, changePercent: 0, totalGainLoss: -inv.totalCost, totalGainLossPercent: inv.totalCost > 0 ? -100 : 0 };
      })
    );
    
    setInvestments(currentInvestments => {
      const investmentMap = new Map(currentInvestments.map(inv => [inv.id, inv]));
      updatedInvestments.forEach(updInv => {
        if(investmentMap.has(updInv.id)) {
            investmentMap.set(updInv.id, {...investmentMap.get(updInv.id), ...updInv});
        }
      });
      return Array.from(investmentMap.values());
    });
  }, [conversionRates]);

  useEffect(() => {
    fetchInvestmentData();
  }, [fetchInvestmentData]);

  useEffect(() => {
    if (!isDataLoading && investments.length > 0) {
      const needsPrices = investments.filter(inv => inv.currentPrice === undefined);
      if (needsPrices.length > 0) {
        fetchPrices(needsPrices);
      }
    }
  }, [isDataLoading, investments, fetchPrices]);
  
  const totalValue = useMemo(() => {
    if (investments.length === 0 || investments.some(inv => inv.currentValue === undefined)) {
        return null;
    }
    return investments.reduce((total, inv) => total + (inv.currentValue || 0), 0);
  }, [investments]);
  
  useEffect(() => {
    if (editingInvestment) {
      // For editing, we cannot easily reconstruct the initial transaction.
      // The form will be disabled for editing for now.
      form.reset({
          ticker: editingInvestment.ticker,
          name: editingInvestment.name,
          shares: editingInvestment.transactions[0]?.shares || 0,
          price: editingInvestment.transactions[0]?.price || 0,
          currency: editingInvestment.transactions[0]?.currency || 'USD',
          date: editingInvestment.transactions[0]?.date || new Date(),
      });
    } else {
      form.reset({ ticker: '', name: '', shares: 0, price: 0, currency: currency, date: new Date() });
    }
  }, [editingInvestment, form, isDialogOpen, currency]);

  const handleFormSubmit = async (values: z.infer<typeof investmentSchema>) => {
    if (!user) return;
    try {
        const newTransaction: InvestmentTransaction = {
            id: crypto.randomUUID(),
            date: values.date,
            shares: values.shares,
            price: values.price,
            currency: values.currency,
        };

        const existingInvestment = investments.find(inv => inv.ticker === values.ticker);

        if (existingInvestment) {
            // Update existing investment
            const investmentRef = doc(db, "investments", existingInvestment.id);
            await updateDoc(investmentRef, {
                transactions: [...existingInvestment.transactions, newTransaction]
            });
            toast({ title: "Transaction Added", description: `Added shares to ${values.ticker}.` });
        } else {
            // Add new investment
            await addDoc(collection(db, "investments"), {
                userId: user.uid,
                ticker: values.ticker,
                name: values.name,
                transactions: [newTransaction]
            });
            toast({ title: "Investment Added" });
        }

        setIsDialogOpen(false);
        fetchInvestmentData();
    } catch (error) {
        console.error("Error saving investment:", error);
        toast({ variant: 'destructive', title: "Error", description: "Could not save investment." });
    }
  };

  const handleDeleteInvestment = async () => {
    if (!investmentToDelete) return;
    try {
      await deleteDoc(doc(db, "investments", investmentToDelete.id));
      toast({ title: "Investment Deleted" });
      setInvestmentToDelete(null);
      fetchInvestmentData();
    } catch (error) {
      console.error("Error deleting investment:", error);
      toast({ variant: 'destructive', title: "Error", description: "Could not delete investment." });
    }
  };

  const openAddDialog = () => {
    setEditingInvestment(null);
    setIsDialogOpen(true);
  };
  
  return (
    <>
      <Header title="Investments" />
      <main className="flex-1 space-y-6 p-4 sm:p-6">
        <div className="max-w-7xl mx-auto w-full space-y-6">
            <Card>
                <CardHeader>
                    <CardTitle>Portfolio Value</CardTitle>
                    <CardDescription>The total real-time value of your investment portfolio.</CardDescription>
                </CardHeader>
                <CardContent>
                    {totalValue === null ? (
                        <Skeleton className="h-10 w-3/4 mb-2" />
                    ) : (
                        <p className="text-4xl font-bold tracking-tight text-primary">
                            {formatCurrency(totalValue ?? 0, currency)}
                        </p>
                    )}
                </CardContent>
            </Card>

            <Card>
            <CardHeader>
                <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                <div>
                    <CardTitle>Your Holdings</CardTitle>
                    <CardDescription>A list of your current investments.</CardDescription>
                </div>
                <Button onClick={openAddDialog} className="w-full sm:w-auto">
                    <PlusCircle className="mr-2 h-4 w-4" /> Add Investment
                </Button>
                </div>
            </CardHeader>
            <CardContent>
                {isDataLoading ? (
                <div className="flex justify-center items-center py-12">
                    <Loader2 className="mx-auto h-8 w-8 animate-spin text-muted-foreground" />
                </div>
                ) : investments.length === 0 ? (
                <div className="text-center py-12 text-muted-foreground">No investments yet. Add one to get started!</div>
                ) : (
                <Table>
                    <TableHeader>
                    <TableRow>
                        <TableHead>Holding</TableHead>
                        <TableHead className="text-right">Shares</TableHead>
                        <TableHead className="text-right">Price</TableHead>
                        <TableHead className="text-right">Day's Change</TableHead>
                        <TableHead className="text-right">Value ({currency})</TableHead>
                        <TableHead className="text-right">Total Gain/Loss</TableHead>
                        <TableHead className="text-right w-[100px]">Actions</TableHead>
                    </TableRow>
                    </TableHeader>
                    <TableBody>
                    {investments.map(inv => {
                        const isPositive = inv.change && inv.change >= 0;
                        const gainLossColor = inv.totalGainLoss >= 0 ? 'text-green-500' : 'text-red-500';
                        return (
                        <TableRow key={inv.id} className="cursor-pointer" onClick={() => router.push(`/investments/${inv.id}`)}>
                            <TableCell className="align-middle">
                                <div className="font-medium">{inv.ticker}</div>
                                <div className="text-xs text-muted-foreground">{inv.name}</div>
                            </TableCell>
                            <TableCell className="text-right align-middle">{inv.totalShares.toLocaleString()}</TableCell>
                            <TableCell className="text-right font-mono align-middle">
                            {inv.currentPrice !== undefined ? formatCurrency(inv.currentPrice, 'USD') : <Skeleton className="h-5 w-20 ml-auto" />}
                            </TableCell>
                            <TableCell className="text-right font-mono align-middle">
                            <div className={`flex justify-end items-center gap-1 ${isPositive ? 'text-green-500' : 'text-red-500'}`}>
                                {inv.change !== undefined ? (
                                    <>
                                        {isPositive ? <TrendingUp size={16}/> : <TrendingDown size={16}/>}
                                        {formatCurrency(inv.change, 'USD')} ({inv.changePercent?.toFixed(2)}%)
                                    </>
                                ) : <Skeleton className="h-5 w-24 ml-auto" />}
                            </div>
                            </TableCell>
                            <TableCell className="text-right font-mono align-middle">
                            {inv.currentValue !== undefined ? formatCurrency(inv.currentValue, currency) : <Skeleton className="h-5 w-28 ml-auto" />}
                            </TableCell>
                            <TableCell className="text-right font-mono align-middle">
                            <div className={gainLossColor}>
                                {inv.currentValue !== undefined ? (
                                <>
                                    {formatCurrency(inv.totalGainLoss, currency)} ({inv.totalGainLossPercent.toFixed(2)}%)
                                </>
                                ) : <Skeleton className="h-5 w-28 ml-auto" />}
                            </div>
                            </TableCell>
                            <TableCell className="text-right align-middle">
                            <Button variant="ghost" size="icon" onClick={(e) => { e.stopPropagation(); router.push(`/investments/${inv.id}`)}}>
                                <Edit className="h-4 w-4" />
                            </Button>
                            <Button variant="ghost" size="icon" onClick={(e) => { e.stopPropagation(); setInvestmentToDelete(inv); }}>
                                <Trash2 className="h-4 w-4" />
                            </Button>
                            </TableCell>
                        </TableRow>
                        );
                    })}
                    </TableBody>
                </Table>
                )}
            </CardContent>
            </Card>
        </div>
      </main>

      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Add New Investment</DialogTitle>
            <DialogDescription>Search for a stock or ETF and enter your initial purchase details.</DialogDescription>
          </DialogHeader>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(handleFormSubmit)} className="space-y-4 py-4">
              <FormField
                control={form.control}
                name="ticker"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Ticker Symbol</FormLabel>
                      <FormControl>
                        <StockSearch
                          onSelect={(stock) => {
                              field.onChange(stock.symbol);
                              form.setValue('name', stock.name);
                          }}
                          initialValue={editingInvestment ? { ticker: editingInvestment.ticker, name: editingInvestment.name } : undefined}
                        />
                      </FormControl>
                    <FormMessage />
                  </FormItem>
              )} />
               <div className="grid grid-cols-2 gap-4">
                    <FormField control={form.control} name="shares" render={({ field }) => (
                        <FormItem>
                        <FormLabel>Number of Shares</FormLabel>
                        <FormControl><Input type="number" step="any" placeholder="10.5" {...field} /></FormControl>
                        <FormMessage />
                        </FormItem>
                    )} />
                     <FormField control={form.control} name="price" render={({ field }) => (
                        <FormItem>
                        <FormLabel>Price per Share</FormLabel>
                        <FormControl><Input type="number" step="any" placeholder="150.25" {...field} /></FormControl>
                        <FormMessage />
                        </FormItem>
                    )} />
               </div>
                <FormField control={form.control} name="currency" render={({ field }) => (
                <FormItem>
                    <FormLabel>Currency</FormLabel>
                    <Select onValueChange={field.onChange} defaultValue={field.value}>
                        <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                        <SelectContent>
                            <SelectItem value="USD">USD - US Dollar</SelectItem>
                            <SelectItem value="EUR">EUR - Euro</SelectItem>
                            <SelectItem value="GBP">GBP - British Pound</SelectItem>
                            <SelectItem value="HUF">HUF - Hungarian Forint</SelectItem>
                        </SelectContent>
                    </Select>
                    <FormMessage />
                </FormItem>
              )} />
                <FormField
                    control={form.control}
                    name="date"
                    render={({ field }) => (
                        <FormItem className="flex flex-col">
                            <FormLabel>Purchase Date</FormLabel>
                            <Popover>
                                <PopoverTrigger asChild>
                                    <FormControl>
                                        <Button
                                            variant="outline"
                                            className={cn("w-full pl-3 text-left font-normal", !field.value && "text-muted-foreground")}
                                        >
                                            {field.value ? formatDate(field.value, 'PPP') : <span>Pick a date</span>}
                                            <CalendarIcon className="ml-2 h-4 w-4 opacity-50" />
                                        </Button>
                                    </FormControl>
                                </PopoverTrigger>
                                <PopoverContent className="w-auto p-0" align="start">
                                    <Calendar
                                        mode="single"
                                        selected={field.value}
                                        onSelect={field.onChange}
                                        disabled={(date) => date > new Date() || date < new Date('1900-01-01')}
                                        initialFocus
                                    />
                                </PopoverContent>
                            </Popover>
                             <FormMessage />
                        </FormItem>
                    )}
                />
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setIsDialogOpen(false)}>Cancel</Button>
                <Button type="submit">Add</Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>
      
      <AlertDialog open={!!investmentToDelete} onOpenChange={(open) => !open && setInvestmentToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Are you sure?</AlertDialogTitle>
            <AlertDialogDescription>This will permanently delete the investment "{investmentToDelete?.ticker}" and all its transaction history.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteInvestment}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

export default function InvestmentsPage() {
  return (
    <MainLayout>
      <Investments />
    </MainLayout>
  )
}
