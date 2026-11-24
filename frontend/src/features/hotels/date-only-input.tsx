import type { InputHTMLAttributes } from "react";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { type StayDates, stayDatesError, todayDateOnly } from "./date-only";

export interface DateOnlyInputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "value" | "onChange"> {
  value: string;
  onChange: (value: string) => void;
}

/** A plain YYYY-MM-DD control. Its value is the native date input's string, never a Date object. */
export function DateOnlyInput({ value, onChange, ...props }: DateOnlyInputProps) {
  return <Input type="date" value={value} onChange={event => onChange(event.target.value)} {...props} />;
}

export interface StayDateFieldsProps {
  value: StayDates;
  onChange: (value: StayDates) => void;
  idPrefix?: string;
  disabled?: boolean;
}

/** Paired check-in/check-out controls shared by hotel search, booking and moderator forms. */
export function StayDateFields({ value, onChange, idPrefix = "stay", disabled }: StayDateFieldsProps) {
  const error = stayDatesError(value);
  const min = todayDateOnly();
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <FormField id={`${idPrefix}-check-in`} label="Check-in">
        <DateOnlyInput
          value={value.checkIn}
          min={min}
          disabled={disabled}
          onChange={checkIn => onChange({ ...value, checkIn })}
        />
      </FormField>
      <FormField id={`${idPrefix}-check-out`} label="Check-out" error={error ?? undefined}>
        <DateOnlyInput
          value={value.checkOut}
          min={value.checkIn || min}
          disabled={disabled}
          onChange={checkOut => onChange({ ...value, checkOut })}
        />
      </FormField>
    </div>
  );
}
