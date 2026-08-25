import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * shadcn's class helper: conditional classes, with later Tailwind utilities
 * beating earlier ones rather than both landing in the class list and the
 * winner being whichever CSS rule happens to come last.
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
