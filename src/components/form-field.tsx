import { Input } from "#/components/ui/input";

interface FormFieldProps {
  id: string;
  label: string;
  hint?: string;
  value: string;
  onChange: (value: string) => void;
  type?: "text" | "email" | "password";
  autoComplete?: string;
  required?: boolean;
  minLength?: number;
}

// Label + input + optional hint, as used by the sign-in and member forms.
export function FormField({ id, label, hint, value, onChange, ...inputProps }: FormFieldProps) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      <Input id={id} value={value} onChange={(e) => onChange(e.target.value)} {...inputProps} />
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}
