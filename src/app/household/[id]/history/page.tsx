
'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { MainLayout, useAuth } from '@/components/main-layout';
import { Header } from '@/components/header';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Loader2, ChevronLeft, History } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { db } from '@/lib/firebase';
import { doc, getDoc } from 'firebase/firestore';
import { formatDistanceToNow } from 'date-fns';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';

// Types
type HouseholdEvent = { id: string; actorId: string; timestamp: Date; message: string; actorName: string; };
type Household = { id: string; name: string; memberIds: string[]; events?: HouseholdEvent[] };

function HouseholdHistory() {
  const user = useAuth();
  const params = useParams();
  const router = useRouter();
  const householdId = params.id as string;
  const { toast } = useToast();
  
  const [household, setHousehold] = useState<Household | null>(null);
  const [loading, setLoading] = useState(true);

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
            events: (data.events || []).map((e: any) => ({
                ...e,
                timestamp: e.timestamp.toDate(),
            })).sort((a: any, b: any) => b.timestamp.getTime() - a.timestamp.getTime()),
        } as Household;
        setHousehold(householdData);
      } else {
        toast({ variant: 'destructive', title: "Not Found", description: "Household not found or you don't have access." });
        setHousehold(null);
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
  }, [user, householdId, router, toast]);

  if (loading) {
    return (
        <main className="flex-1 p-4 sm:p-6 text-center">
            <Loader2 className="mx-auto h-12 w-12 animate-spin text-muted-foreground" />
        </main>
    );
  }

  if (!household) {
    return null;
  }

  return (
    <>
      <Header title={`${household.name} History`} />
      <main className="flex-1 space-y-6 p-4 sm:p-6">
        <div className="max-w-7xl mx-auto w-full space-y-6">
            <Button asChild variant="outline" className="w-fit">
                <Link href={`/household/${household.id}`}><ChevronLeft className="mr-2 h-4 w-4" /> Back to Household</Link>
            </Button>
            <Card>
                <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                        <History className="h-6 w-6 text-primary" />
                        Activity Log
                    </CardTitle>
                    <CardDescription>
                        A full log of changes and events in this household.
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    {household.events && household.events.length > 0 ? (
                        <ul className="space-y-4">
                            {household.events.map(event => (
                                <li key={event.id} className="flex items-start gap-3 border-b pb-4 last:border-b-0 last:pb-0">
                                    <Avatar className="h-8 w-8 border">
                                        <AvatarFallback>{event.actorName ? event.actorName.charAt(0).toUpperCase() : '?'}</AvatarFallback>
                                    </Avatar>
                                    <div>
                                        <p className="text-sm" dangerouslySetInnerHTML={{ __html: event.message }} />
                                        <p className="text-xs text-muted-foreground">{formatDistanceToNow(event.timestamp, { addSuffix: true })}</p>
                                    </div>
                                </li>
                            ))}
                        </ul>
                    ) : (
                        <p className="text-sm text-muted-foreground text-center py-4">No activity to show.</p>
                    )}
                </CardContent>
            </Card>
        </div>
      </main>
    </>
  );
}

export default function HouseholdHistoryPage() {
    return (
        <MainLayout>
            <HouseholdHistory />
        </MainLayout>
    )
}
