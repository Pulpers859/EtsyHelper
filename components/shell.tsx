import { useId, type ReactNode } from 'react';
import { CheckCircle2, Copy } from 'lucide-react';

import { cn } from '../lib/utils';

export function SectionCard({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn('overflow-hidden rounded-[2rem] border border-white/70 bg-white/85 shadow-[0_25px_80px_-45px_rgba(15,23,42,0.35)] backdrop-blur', className)}>
      {children}
    </div>
  );
}

export function StatusPill({ children, tone }: { children: ReactNode; tone: 'success' | 'warning' | 'danger' | 'info' }) {
  return (
    <span className={cn(
      'inline-flex max-w-full items-center justify-center rounded-full px-3.5 py-1.5 text-xs font-semibold leading-4 text-center whitespace-normal break-words',
      tone === 'success' && 'bg-emerald-100 text-emerald-700',
      tone === 'warning' && 'bg-amber-100 text-amber-700',
      tone === 'danger' && 'bg-rose-100 text-rose-700',
      tone === 'info' && 'bg-slate-100 text-slate-600'
    )}>
      {children}
    </span>
  );
}

export function MetricCard({
  title,
  value,
  detail,
  icon,
  accent
}: {
  title: string;
  value: string | number;
  detail: string;
  icon: ReactNode;
  accent: 'emerald' | 'rose' | 'amber' | 'indigo';
}) {
  return (
    <div className="h-full rounded-[1.8rem] border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[11px] font-black uppercase tracking-[0.24em] text-slate-500">{title}</p>
          <p className="mt-3 text-3xl font-black tracking-tight text-slate-950">{value}</p>
        </div>
        <div className={cn(
          'flex h-11 w-11 items-center justify-center rounded-2xl',
          accent === 'emerald' && 'bg-emerald-50 text-emerald-600',
          accent === 'rose' && 'bg-rose-50 text-rose-600',
          accent === 'amber' && 'bg-amber-50 text-amber-600',
          accent === 'indigo' && 'bg-indigo-50 text-indigo-600'
        )}>
          {icon}
        </div>
      </div>
      <p className="mt-4 text-sm leading-6 text-slate-600">{detail}</p>
    </div>
  );
}

export function EmptyState({
  icon,
  title,
  subtitle,
  actions
}: {
  icon: ReactNode;
  title: string;
  subtitle?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="flex min-h-[220px] flex-col items-center justify-center rounded-[1.8rem] border border-dashed border-slate-200 bg-slate-50 px-6 py-10 text-center">
      <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-[1.2rem] border border-white bg-white text-slate-300 shadow-sm">
        {icon}
      </div>
      <p className="mt-4 text-sm font-black uppercase tracking-[0.24em] text-slate-400">{title}</p>
      {subtitle && <p className="mt-3 text-sm leading-6 text-slate-500">{subtitle}</p>}
      {actions && <div className="mt-5 flex flex-wrap items-center justify-center gap-3">{actions}</div>}
    </div>
  );
}

export function PreviewCard({ icon, title, text }: { icon: ReactNode; title: string; text: string }) {
  return (
    <div className="rounded-[1.7rem] border border-slate-200 bg-slate-50 p-5">
      <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-white text-slate-700 shadow-sm">
        {icon}
      </div>
      <p className="mt-4 text-lg font-black tracking-tight text-slate-950">{title}</p>
      <p className="mt-2 text-sm leading-7 text-slate-600">{text}</p>
    </div>
  );
}

export function RoadmapLine({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div className="flex gap-3">
      <div className="mt-1 h-2.5 w-2.5 rounded-full bg-amber-300" />
      <div>
        <p className="text-sm font-black text-white">{title}</p>
        <p className="mt-1 text-sm leading-6 text-slate-300">{subtitle}</p>
      </div>
    </div>
  );
}

export function ProfileField({
  label,
  value,
  onChange,
  placeholder,
  type = 'text'
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  type?: string;
}) {
  const id = useId();
  return (
    <div>
      <label htmlFor={id} className="mb-2 block text-[11px] font-black tracking-[0.08em] text-slate-500">{label}</label>
      <input
        id={id}
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="w-full rounded-[1.2rem] border border-slate-200 bg-white px-4 py-3 text-sm font-medium text-slate-700 shadow-sm outline-none transition focus:border-amber-300 focus:ring-2 focus:ring-amber-100"
      />
    </div>
  );
}

export function AvatarBadge({
  name,
  imageUrl
}: {
  name: string;
  imageUrl?: string | null;
}) {
  const initials = name
    .split(/\s+/)
    .map((chunk) => chunk[0])
    .join('')
    .slice(0, 2)
    .toUpperCase() || 'EH';

  if (imageUrl?.trim()) {
    return (
      <img
        src={imageUrl}
        alt=""
        className="h-11 w-11 rounded-2xl border-2 border-white object-cover shadow-sm"
        referrerPolicy="no-referrer"
      />
    );
  }

  return (
    <div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-slate-200 bg-gradient-to-br from-amber-100 via-white to-slate-100 text-sm font-black tracking-[0.12em] text-slate-700 shadow-sm">
      {initials}
    </div>
  );
}

export function MiniActionButton({
  onClick,
  disabled,
  label,
  icon
}: {
  onClick: () => void;
  disabled?: boolean;
  label: string;
  icon: ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 transition hover:border-slate-300 hover:text-slate-950 disabled:opacity-60"
    >
      {icon}
      {label}
    </button>
  );
}

export function LaunchItem({ title, text }: { title: string; text: string }) {
  return (
    <div className="rounded-[1.7rem] border border-slate-200 bg-slate-50 p-5">
      <p className="text-sm font-black text-slate-950">{title}</p>
      <p className="mt-2 text-sm leading-7 text-slate-600">{text}</p>
    </div>
  );
}

export function ConnectorCard({
  title,
  description,
  tone,
  status,
  buttonLabel,
  onClick,
  disabled,
  footnote,
  icon
}: {
  title: string;
  description: string;
  tone: 'amber' | 'rose';
  status: string;
  buttonLabel: string;
  onClick: () => void;
  disabled?: boolean;
  footnote?: string;
  icon: ReactNode;
}) {
  const normalizedStatus = status.toLowerCase();
  const statusTone = normalizedStatus === 'connected'
    ? 'success'
    : normalizedStatus === 'under review' || normalizedStatus === 'ready to connect'
      ? 'warning'
      : normalizedStatus.includes('config')
        ? 'danger'
        : 'info';

  return (
    <SectionCard className="p-6">
      <div className="flex items-start justify-between gap-4">
        <div className={cn(
          'flex h-16 w-16 items-center justify-center rounded-[1.6rem]',
          tone === 'amber' ? 'bg-amber-50 text-amber-600' : 'bg-rose-50 text-rose-600'
        )}>
          {icon}
        </div>
        <StatusPill tone={statusTone}>
          {status}
        </StatusPill>
      </div>
      <h3 className="mt-5 text-2xl font-extrabold tracking-tight text-slate-950">{title}</h3>
      <p className="mt-3 text-sm leading-7 text-slate-600">{description}</p>
      {footnote && <p className="mt-3 text-sm leading-6 text-slate-500">{footnote}</p>}
      <button
        onClick={onClick}
        disabled={disabled}
        className={cn(
          'mt-6 inline-flex rounded-full px-5 py-3 text-xs font-black uppercase tracking-[0.22em] text-white transition disabled:cursor-not-allowed disabled:opacity-60',
          tone === 'amber' ? 'bg-amber-500 hover:bg-amber-400' : 'bg-rose-500 hover:bg-rose-400'
        )}
      >
        {buttonLabel}
      </button>
    </SectionCard>
  );
}

export function UrlCard({
  label,
  value,
  copied,
  onCopy
}: {
  label: string;
  value: string;
  copied: boolean;
  onCopy: () => void;
}) {
  return (
    <div className="rounded-[1.7rem] border border-slate-200 bg-slate-50 p-5">
      <p className="text-[11px] font-black uppercase tracking-[0.22em] text-slate-500">{label}</p>
      <div className="mt-4 flex items-center justify-between gap-4 rounded-2xl border border-white bg-white px-4 py-4 shadow-sm">
        <code className="truncate text-xs font-semibold text-slate-700">{value}</code>
        <button onClick={onCopy} className="rounded-full border border-slate-200 p-2 text-slate-500 transition hover:border-slate-300 hover:text-slate-900">
          {copied ? <CheckCircle2 className="h-4 w-4 text-emerald-600" /> : <Copy className="h-4 w-4" />}
        </button>
      </div>
    </div>
  );
}
