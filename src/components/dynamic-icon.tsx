
'use client';

import * as icons from 'lucide-react';
import type { LucideProps } from 'lucide-react';

type IconName = keyof typeof icons;

interface DynamicIconProps extends LucideProps {
  name: IconName | string;
}

const DynamicIcon = ({ name, ...props }: DynamicIconProps) => {
  const LucideIcon = icons[name as IconName];

  if (!LucideIcon) {
    // Fallback to a default icon if name is not found
    const FallbackIcon = icons['Paperclip'];
    return <FallbackIcon {...props} />;
  }

  return <LucideIcon {...props} />;
};

export default DynamicIcon;
