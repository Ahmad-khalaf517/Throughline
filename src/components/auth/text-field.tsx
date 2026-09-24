import { FieldShell } from './field-shell';

interface TextFieldProps {
  id: string;
  name: string;
  label: string;
  type?: string;
  autoComplete?: string;
  required?: boolean;
  placeholder?: string;
  helperText?: string;
  errorText?: string;
}

export function TextField({
  id,
  name,
  label,
  type = 'text',
  autoComplete,
  required,
  placeholder,
  helperText,
  errorText,
}: TextFieldProps) {
  return (
    <FieldShell id={id} label={label} helperText={helperText} errorText={errorText}>
      <input
        id={id}
        name={name}
        type={type}
        autoComplete={autoComplete}
        required={required}
        placeholder={placeholder}
        className="border-outline-variant bg-surface-container-lowest text-on-surface placeholder:text-outline focus:border-primary focus:bg-surface-container-low focus:ring-primary h-11 w-full rounded-lg border px-3.5 text-sm transition-colors focus:ring-1 focus:outline-none"
      />
    </FieldShell>
  );
}
