"use client";
import { useState, type ReactNode } from "react";

import { Field, FormError, invalid } from "@/components/Field";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { length, validate, type Validator } from "@/lib/validation";

export interface ReasonField {
  readonly name: string;
  readonly label: string;
  /** text (default), number-ish text, select, or multi-line. Native validation is never used. */
  readonly kind?: "text" | "select" | "textarea" | "password";
  readonly options?: readonly { value: string; label: string }[];
  readonly placeholder?: string;
  readonly defaultValue?: string;
  readonly hint?: string;
  readonly validate?: Validator;
  readonly inputMode?: "numeric" | "decimal" | "email" | "text";
}

const reasonRule = length(3, 500, "Reason");

/**
 * Every admin mutation needs a reason (the API refuses without one). This
 * dialog collects it plus any extra fields, validates them inline, and runs
 * the action. API errors land under the form, not in a browser alert.
 */
export function ReasonDialog({
  trigger,
  title,
  description,
  fields = [],
  confirmLabel = "Confirm",
  destructive = false,
  open: controlledOpen,
  onOpenChange,
  onConfirm,
}: {
  trigger?: ReactNode | undefined;
  title: string;
  description?: string | undefined;
  fields?: readonly ReasonField[] | undefined;
  confirmLabel?: string | undefined;
  destructive?: boolean | undefined;
  open?: boolean | undefined;
  onOpenChange?: ((open: boolean) => void) | undefined;
  onConfirm: (values: Record<string, string>, reason: string) => Promise<void>;
}) {
  const [innerOpen, setInnerOpen] = useState(false);
  const open = controlledOpen ?? innerOpen;
  const setOpen = (next: boolean) => {
    setInnerOpen(next);
    onOpenChange?.(next);
  };
  const initial = () => Object.fromEntries(fields.map((f) => [f.name, f.defaultValue ?? ""]));
  const [values, setValues] = useState<Record<string, string>>(initial);
  const [reason, setReason] = useState("");
  const [errors, setErrors] = useState<Record<string, string | undefined>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const set = (name: string, value: string) => {
    setValues((v) => ({ ...v, [name]: value }));
    if (errors[name]) setErrors((e) => ({ ...e, [name]: undefined }));
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const rules: Record<string, Validator> = { reason: reasonRule };
    for (const f of fields) if (f.validate) rules[f.name] = f.validate;
    const found = validate({ ...values, reason }, rules);
    setErrors(found);
    if (Object.keys(found).length) return;
    setBusy(true);
    setFormError(null);
    try {
      await onConfirm(values, reason.trim());
      setOpen(false);
      setReason("");
      setValues(initial());
    } catch (err) {
      setFormError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) {
          setErrors({});
          setFormError(null);
          setReason("");
        }
      }}
    >
      {trigger ? <DialogTrigger asChild>{trigger}</DialogTrigger> : null}
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description ? <DialogDescription>{description}</DialogDescription> : null}
        </DialogHeader>
        <form className="space-y-4" noValidate onSubmit={submit}>
          {fields.map((f) => {
            const id = `f-${f.name}`;
            const error = errors[f.name];
            return (
              <Field key={f.name} id={id} label={f.label} hint={f.hint} error={error}>
                {f.kind === "select" ? (
                  <Select value={values[f.name] ?? ""} onValueChange={(v) => set(f.name, v)}>
                    <SelectTrigger id={id} className="w-full" {...invalid(id, error)}>
                      <SelectValue placeholder={f.placeholder ?? "Choose…"} />
                    </SelectTrigger>
                    <SelectContent>
                      {(f.options ?? []).map((o) => (
                        <SelectItem key={o.value} value={o.value}>
                          {o.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : f.kind === "textarea" ? (
                  <Textarea
                    id={id}
                    value={values[f.name] ?? ""}
                    placeholder={f.placeholder}
                    onChange={(e) => set(f.name, e.target.value)}
                    {...invalid(id, error)}
                  />
                ) : (
                  <Input
                    id={id}
                    type={f.kind === "password" ? "password" : "text"}
                    inputMode={f.inputMode ?? "text"}
                    autoComplete="off"
                    placeholder={f.placeholder}
                    value={values[f.name] ?? ""}
                    onChange={(e) => set(f.name, e.target.value)}
                    {...invalid(id, error)}
                  />
                )}
              </Field>
            );
          })}
          <Field id="reason" label="Reason" hint="Recorded in the audit log." error={errors.reason}>
            <Textarea
              id="reason"
              value={reason}
              onChange={(e) => {
                setReason(e.target.value);
                if (errors.reason) setErrors((er) => ({ ...er, reason: undefined }));
              }}
              placeholder="Ticket number, what the customer reported, why…"
              {...invalid("reason", errors.reason)}
            />
          </Field>
          <FormError error={formError} />
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" variant={destructive ? "destructive" : "default"} disabled={busy}>
              {busy ? "Working…" : confirmLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
