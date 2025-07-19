
'use client';

import React, { useState } from 'react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import DynamicIcon from '@/components/dynamic-icon';
import { cn } from '@/lib/utils';
import { icons } from 'lucide-react';

export const iconList = Object.keys(icons) as (keyof typeof icons)[];

interface IconPickerProps {
  value: string;
  onChange: (icon: string) => void;
  className?: string;
}

const formatIconName = (name: string) => {
  if (!name) return 'Select an icon';
  return name.replace(/([a-z])([A-Z])/g, '$1 $2');
};

export function IconPicker({ value, onChange, className }: IconPickerProps) {
  const [search, setSearch] = useState('');
  const [isOpen, setIsOpen] = useState(false);

  const filteredIcons = iconList.filter(icon =>
    icon.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <Popover open={isOpen} onOpenChange={setIsOpen} modal={true}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          className={cn('w-full justify-start text-left font-normal gap-2', !value && 'text-muted-foreground', className)}
        >
          {value ? <DynamicIcon name={value} className="h-4 w-4" /> : null}
          {formatIconName(value)}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[300px] p-0">
        <div className="p-2">
            <Input
              placeholder="Search icons..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="h-9"
            />
        </div>
        <ScrollArea className="h-64">
          <div className="grid grid-cols-6 gap-1 p-2">
            {filteredIcons.map(iconName => (
              <Button
                key={iconName}
                type="button"
                variant="ghost"
                size="icon"
                className={cn('h-10 w-10', value === iconName && 'bg-primary text-primary-foreground')}
                onClick={() => {
                  onChange(iconName);
                  setIsOpen(false);
                }}
              >
                <DynamicIcon name={iconName} />
              </Button>
            ))}
          </div>
        </ScrollArea>
      </PopoverContent>
    </Popover>
  );
}
