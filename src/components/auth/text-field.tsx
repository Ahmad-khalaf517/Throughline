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
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-on-surface text-sm font-medium">
        {label}
      </label>
      <input
        id={id}
        name={name}
        type={type}
        autoComplete={autoComplete}
        required={required}
        placeholder={placeholder}
        className="border-outline-variant bg-surface-container-lowest text-on-surface placeholder:text-outline focus:border-primary focus:bg-surface-container-low focus:ring-primary h-11 w-full rounded-lg border px-3.5 text-sm transition-colors focus:ring-1 focus:outline-none"
      />
      {(helperText || errorText) && (
        <p className={errorText ? 'text-error text-xs' : 'text-secondary text-xs'}>
          {errorText || helperText}
        </p>
      )}
    </div>
  );
}
