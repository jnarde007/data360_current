import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatGHS(amount: number): string {
  return `GH₵ ${amount.toFixed(2)}`;
}

export function generateAffiliateCode(fullName: string): string {
  const firstName = fullName.trim().split(' ')[0].toUpperCase().slice(0, 5);
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let rand = '';
  for (let i = 0; i < 8; i++) {
    rand += chars[Math.floor(Math.random() * chars.length)];
  }
  return `${firstName}-${rand}`;
}
