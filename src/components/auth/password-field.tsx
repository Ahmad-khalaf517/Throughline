'use client';

import { Eye, EyeOff } from 'lucide-react';
import { type ReactNode, useState } from 'react';

interface PasswordFieldProps {
  id: string;
  name: string;
  label: string;
  autoComplete: 'current-password' | 'new-password';
  required?: boolean;
  minLength?: number;
  placeholder?: string;
  helperText?: string;
  errorText?: string | undefined;
  /** e.g. a "Forgot password?" link rendered next to the label. */
  labelAddon?: ReactNode;
  onChange?: (value: string) => void;
}

export function PasswordField({
  id,
  name,
  label,
  autoComplete,
  required,
  minLength,
  placeholder = '••••••••',
  helperText,
  errorText,
  labelAddon,
  onChange,
}: PasswordFieldProps) {
  const [visible, setVisible] = useState(false);

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between">
        <label htmlFor={id} className="text-on-surface text-sm font-medium">
          {label}
        </label>
        {labelAddon}
      </div>
      <div className="relative flex items-center">
        <input
          id={id}
          name={name}
          type={visible ? 'text' : 'password'}
          autoComplete={autoComplete}
          required={required}
          minLength={minLength}
          placeholder={placeholder}
          onChange={onChange ? (event) => onChange(event.target.value) : undefined}
          className="border-outline-variant bg-surface-container-lowest text-on-surface placeholder:text-outline focus:border-primary focus:bg-surface-container-low focus:ring-primary h-11 w-full rounded-lg border px-3.5 pr-11 text-sm transition-colors focus:ring-1 focus:outline-none"
        />
        <button
          type="button"
          onClick={() => setVisible((current) => !current)}
          aria-label={visible ? 'Hide password' : 'Show password'}
          className="text-secondary hover:text-on-surface focus-visible:ring-primary absolute right-3 flex size-7 items-center justify-center rounded transition-colors focus-visible:ring-2 focus-visible:outline-none"
        >
          {visible ? (
            <EyeOff className="size-[18px]" aria-hidden="true" />
          ) : (
            <Eye className="size-[18px]" aria-hidden="true" />
          )}
        </button>
      </div>
      {(helperText || errorText) && (
        <p className={errorText ? 'text-error text-xs' : 'text-secondary text-xs'}>
          {errorText || helperText}
        </p>
      )}
    </div>
  );
}
