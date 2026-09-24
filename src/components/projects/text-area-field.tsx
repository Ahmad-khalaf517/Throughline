import { FieldShell } from '@/components/auth/field-shell';

interface TextAreaFieldProps {
  id: string;
  name: string;
  label: string;
  required?: boolean;
  placeholder?: string;
  rows?: number;
}

/**
 * Textarea counterpart to `components/auth/text-field.tsx` - shares its
 * field chrome (label, helper/error text, focus ring) via `FieldShell` and
 * the same design tokens, just a multi-line control. Lives under
 * `components/projects` rather than `components/auth` because it isn't
 * auth-flow-branded and the first field that needs it (`brief`) is a
 * project field (E5-S1). No `helperText`/`errorText`/`defaultValue` props -
 * its only caller (`new-project-form.tsx`) never passes them.
 */
export function TextAreaField({
  id,
  name,
  label,
  required,
  placeholder,
  rows = 6,
}: TextAreaFieldProps) {
  return (
    <FieldShell id={id} label={label}>
      <textarea
        id={id}
        name={name}
        required={required}
        placeholder={placeholder}
        rows={rows}
        className="border-outline-variant bg-surface-container-lowest text-on-surface placeholder:text-outline focus:border-primary focus:bg-surface-container-low focus:ring-primary w-full resize-y rounded-lg border px-3.5 py-3 text-sm transition-colors focus:ring-1 focus:outline-none"
      />
    </FieldShell>
  );
}
