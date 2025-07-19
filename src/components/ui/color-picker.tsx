
'use client';

import React from 'react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

const colorOptions = [
  { name: 'Chart Blue', hsl: 'hsl(var(--chart-1))' },
  { name: 'Chart Green', hsl: 'hsl(var(--chart-2))' },
  { name: 'Chart Cyan', hsl: 'hsl(var(--chart-3))' },
  { name: 'Chart Orange', hsl: 'hsl(var(--chart-4))' },
  { name: 'Chart Purple', hsl: 'hsl(var(--chart-5))' },
  { name: 'Rose', hsl: 'hsl(350 75% 65%)' },
  { name: 'Indigo', hsl: 'hsl(250 75% 65%)' },
  { name: 'Gold', hsl: 'hsl(50 75% 65%)' },
  { name: 'Teal', hsl: 'hsl(180 75% 65%)' },
  { name: 'Tomato', hsl: 'hsl(10 75% 65%)' },
  { name: 'Sky', hsl: 'hsl(210 75% 65%)' },
  { name: 'Magenta', hsl: 'hsl(300 75% 65%)' },
  { name: 'Forest', hsl: 'hsl(120 40% 50%)' },
  { name: 'Lavender', hsl: 'hsl(270 60% 70%)' },
  { name: 'Gray', hsl: 'hsl(0 0% 50%)' }
];

interface ColorPickerProps {
  value: string;
  onChange: (color: string) => void;
  className?: string;
}

export function ColorPicker({ value, onChange, className }: ColorPickerProps) {
  const [isOpen, setIsOpen] = React.useState(false);

  const selectedColorName = colorOptions.find(c => c.hsl === value)?.name || value;

  return (
    <Popover open={isOpen} onOpenChange={setIsOpen} modal={true}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          className={cn('w-full justify-start text-left font-normal gap-2', !value && 'text-muted-foreground', className)}
        >
          <div className="flex items-center gap-2">
            <div className="h-4 w-4 rounded-full border" style={{ backgroundColor: value }} />
            <span>{selectedColorName}</span>
          </div>
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-2">
        <div className="grid grid-cols-5 gap-2">
          {colorOptions.map(color => (
            <button
              key={color.hsl}
              type="button"
              className={cn(
                'h-8 w-8 rounded-full border-2 transition-transform hover:scale-110',
                value === color.hsl ? 'border-primary' : 'border-transparent'
              )}
              style={{ backgroundColor: color.hsl }}
              onClick={() => {
                onChange(color.hsl);
                setIsOpen(false);
              }}
            />
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
