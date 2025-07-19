
export type DefaultCategory = {
    name: string;
    icon: string; // lucide-react icon name
    color: string; // HSL color string
}

export const defaultAssetTypes: DefaultCategory[] = [
    { name: 'Savings', icon: 'Wallet', color: 'hsl(var(--chart-1))' },
    { name: 'Investment', icon: 'BarChart', color: 'hsl(var(--chart-2))' },
    { name: 'Real Estate', icon: 'Home', color: 'hsl(var(--chart-3))' },
    { name: 'Pension', icon: 'ShieldCheck', color: 'hsl(var(--chart-4))' },
    { name: 'Other', icon: 'Landmark', color: 'hsl(var(--chart-5))' },
];

export const defaultExpenseCategories: DefaultCategory[] = [
    { name: 'Housing', icon: 'Home', color: 'hsl(var(--chart-1))' },
    { name: 'Groceries', icon: 'ShoppingCart', color: 'hsl(var(--chart-2))' },
    { name: 'Dining Out', icon: 'UtensilsCrossed', color: 'hsl(var(--chart-3))' },
    { name: 'Transportation', icon: 'CarFront', color: 'hsl(var(--chart-4))' },
    { name: 'Utilities', icon: 'Lightbulb', color: 'hsl(var(--chart-5))' },
    { name: 'Health & Wellness', icon: 'HeartPulse', color: 'hsl(350 75% 65%)' },
    { name: 'Shopping', icon: 'ShoppingBag', color: 'hsl(250 75% 65%)' },
    { name: 'Entertainment', icon: 'Ticket', color: 'hsl(50 75% 65%)' },
    { name: 'Subscriptions', icon: 'Repeat', color: 'hsl(180 75% 65%)' },
    { name: 'Other', icon: 'Paperclip', color: 'hsl(0 0% 65%)' },
];

export const defaultIncomeCategories: DefaultCategory[] = [
    { name: 'Salary', icon: 'Briefcase', color: 'hsl(var(--chart-2))' },
    { name: 'Freelance', icon: 'Laptop', color: 'hsl(180 75% 65%)' },
    { name: 'Investment', icon: 'TrendingUp', color: 'hsl(50 75% 65%)' },
    { name: 'Gifts', icon: 'Gift', color: 'hsl(var(--chart-5))' },
    { name: 'Rental Income', icon: 'Building', color: 'hsl(var(--chart-4))' },
    { name: 'Other', icon: 'Paperclip', color: 'hsl(0 0% 65%)' },
];
