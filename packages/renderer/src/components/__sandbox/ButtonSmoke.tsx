import * as React from 'react';
import { Button } from '../ui/Button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '../ui/Dialog';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '../ui/Tooltip';

/**
 * shadcn 烟雾测试组件 —— 只用于验证 bridge.scss 颜色 + Tailwind + Radix
 * 编译链。**不**接入任何 baseline 化页面（TheaterView / LikedLibraryModal
 * 等）。D11 视觉回归加 button-smoke 截图作为 baseline。
 */
export function ButtonSmoke() {
  return (
    <TooltipProvider>
      <div className="bg-background text-foreground p-8 flex flex-col gap-6 min-w-[480px]">
        <h2 className="text-lg font-semibold">shadcn Phase 1 smoke</h2>
        <div className="flex flex-wrap gap-3">
          <Button>Primary</Button>
          <Button variant="destructive">Destructive</Button>
          <Button variant="outline">Outline</Button>
          <Button variant="secondary">Secondary</Button>
          <Button variant="ghost">Ghost</Button>
        </div>
        <div className="flex flex-wrap gap-3">
          <Button className="bg-success text-primary-foreground">Success</Button>
          <Button className="bg-warning text-primary-foreground">Warning</Button>
          <Button className="bg-info text-primary-foreground">Info</Button>
          <Button className="bg-accent-warm text-primary-foreground">Warm</Button>
          <Button className="bg-accent-blue text-primary-foreground">Blue</Button>
          <Button className="bg-accent-purple text-primary-foreground">Purple</Button>
        </div>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="link">Hover me (tooltip)</Button>
          </TooltipTrigger>
          <TooltipContent>Radix Tooltip via shadcn</TooltipContent>
        </Tooltip>
        <Dialog>
          <DialogTrigger asChild>
            <Button variant="outline">Open Dialog</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>shadcn Dialog</DialogTitle>
              <DialogDescription>Radix Dialog primitives + AETHER theme</DialogDescription>
            </DialogHeader>
          </DialogContent>
        </Dialog>
      </div>
    </TooltipProvider>
  );
}
