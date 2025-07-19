
'use client';
import { useEffect, useState } from 'react';
import { useAppTour } from './tour-guide';
import { Alert, AlertDescription, AlertTitle } from './ui/alert';
import { Button } from './ui/button';
import { Waypoints, Rocket } from 'lucide-react';

export function NewUserTourPrompt() {
    const [isClient, setIsClient] = useState(false);
    const { startTour } = useAppTour();
    
    useEffect(() => {
        setIsClient(true);
    }, []);

    if (!isClient || localStorage.getItem('worthwatch-tour-completed') === 'true') {
        return null;
    }

    return (
        <Alert className="mt-6">
            <Rocket className="h-4 w-4" />
            <AlertTitle>Welcome to WorthWatch!</AlertTitle>
            <AlertDescription className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
               <span>Ready to get started? Take a quick tour to learn how to set up your account.</span>
                <Button onClick={startTour} className="w-full sm:w-auto mt-2 sm:mt-0">
                    <Waypoints className="mr-2 h-4 w-4" />
                    Start Tour
                </Button>
            </AlertDescription>
        </Alert>
    )
}
