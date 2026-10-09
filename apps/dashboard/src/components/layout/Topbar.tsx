import { useMe } from '../../api/hooks';

/**
 * Top bar: workspace selector placeholder (left) and the signed-in user
 * (right, via GET /api/me).
 */
export function Topbar() {
  const me = useMe();

  return (
    <header className="flex h-16 shrink-0 items-center justify-between border-b border-slate-200 bg-white px-8">
      <button
        type="button"
        className="inline-flex items-center gap-2 rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
        title="Workspace switching arrives with the workspaces phase"
      >
        <span className="h-2 w-2 rounded-full bg-emerald-500" />
        <span>Workspace selector (placeholder)</span>
        <svg
          className="h-4 w-4 text-slate-400"
          viewBox="0 0 20 20"
          fill="currentColor"
          aria-hidden="true"
        >
          <path
            fillRule="evenodd"
            d="M5.23 7.21a.75.75 0 011.06.02L10 11.17l3.71-3.94a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z"
            clipRule="evenodd"
          />
        </svg>
      </button>

      <div className="text-sm text-slate-600">
        {me.data ? (
          <span className="font-medium text-slate-900">{me.data.user.email}</span>
        ) : (
          <span className="text-slate-400">Not signed in</span>
        )}
      </div>
    </header>
  );
}
