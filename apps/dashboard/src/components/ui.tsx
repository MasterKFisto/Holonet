import type { ReactNode } from 'react';

/** Card container for page content. */
export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div className={`rounded-lg border border-slate-200 bg-white p-6 shadow-sm ${className}`}>
      {children}
    </div>
  );
}

/** Page heading block: title + optional description. */
export function PageHeader({ title, description }: { title: string; description?: string }) {
  return (
    <div className="mb-6">
      <h1 className="text-2xl font-semibold tracking-tight text-slate-900">{title}</h1>
      {description ? <p className="mt-1 text-sm text-slate-500">{description}</p> : null}
    </div>
  );
}

/** Standard placeholder for phases that are not implemented yet. */
export function PlaceholderCard({ feature, note }: { feature: string; note?: string }) {
  return (
    <Card>
      <div className="flex items-start gap-3">
        <span className="mt-0.5 inline-flex h-2 w-2 shrink-0 rounded-full bg-amber-400" />
        <div>
          <p className="text-sm font-medium text-slate-900">{feature}</p>
          <p className="mt-1 text-sm text-slate-500">
            {note ?? 'This section arrives in a later phase — the route and layout are in place.'}
          </p>
        </div>
      </div>
    </Card>
  );
}
