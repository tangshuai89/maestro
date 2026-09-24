import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * shadcn/ui `cn()` helper: clsx + tailwind-merge.
 * 顺序：clsx 解析条件 className → twMerge 解决 Tailwind class 冲突。
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
