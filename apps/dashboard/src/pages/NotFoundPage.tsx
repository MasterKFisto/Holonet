import { Link } from 'react-router-dom';

export function NotFoundPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
      <div className="text-center">
        <p className="text-5xl font-semibold text-slate-300">404</p>
        <p className="mt-2 text-sm text-slate-500">This page does not exist.</p>
        <Link
          to="/dashboard"
          className="mt-6 inline-block rounded-md bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-500"
        >
          Back to dashboard
        </Link>
      </div>
    </div>
  );
}
