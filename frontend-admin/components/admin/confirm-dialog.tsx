'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';

export interface ConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  /**
   * The user must type this exact string before the destructive button
   * activates. Set to null to skip confirmation.
   */
  confirmTargetId?: string | null;
  /** Optional reason field (string passed back to onConfirm). */
  withReason?: boolean;
  destructive?: boolean;
  confirmLabel?: string;
  loading?: boolean;
  onConfirm: (input: { reason: string | null }) => void | Promise<void>;
}

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmTargetId = null,
  withReason = false,
  destructive = false,
  confirmLabel = 'Confirm',
  loading = false,
  onConfirm,
}: ConfirmDialogProps) {
  const tCommon = useTranslations('common');
  const tDialog = useTranslations('dialog');
  const [typed, setTyped] = React.useState('');
  const [reason, setReason] = React.useState('');

  React.useEffect(() => {
    if (!open) {
      setTyped('');
      setReason('');
    }
  }, [open]);

  const requiresMatch = confirmTargetId && confirmTargetId.length > 0;
  const matched = !requiresMatch || typed.trim() === confirmTargetId;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description ? <DialogDescription>{description}</DialogDescription> : null}
        </DialogHeader>
        {requiresMatch ? (
          <div className="space-y-2">
            <Label htmlFor="confirm-target">{tDialog('typeToConfirm', { target: confirmTargetId })}</Label>
            <Input
              id="confirm-target"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              autoFocus
              autoComplete="off"
              spellCheck={false}
            />
          </div>
        ) : null}
        {withReason ? (
          <div className="space-y-2">
            <Label htmlFor="confirm-reason">{tDialog('reasonOptional')}</Label>
            <Textarea
              id="confirm-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              maxLength={512}
            />
          </div>
        ) : null}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>
            {tCommon('cancel')}
          </Button>
          <Button
            variant={destructive ? 'destructive' : 'default'}
            disabled={!matched || loading}
            onClick={() => onConfirm({ reason: withReason ? reason.trim() || null : null })}
          >
            {loading ? tCommon('working') : confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
