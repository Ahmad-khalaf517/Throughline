import { Loader2 } from 'lucide-react';

interface SubmitButtonProps {
  pending: boolean;
  label: string;
  pendingLabel: string;
}

export function SubmitButton({ pending, label, pendingLabel }: SubmitButtonProps) {
  return (
    <button
      type="submit"
      disabled={pending}
      className="bg-primary-container text-on-primary-container hover:bg-primary-container-hover focus-visible:ring-primary mt-2 flex h-11 w-full items-center justify-center gap-2 rounded-lg text-sm font-medium shadow-sm transition-all focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-60"
    >
      {pending && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
      {pending ? pendingLabel : label}
    </button>
  );
}
