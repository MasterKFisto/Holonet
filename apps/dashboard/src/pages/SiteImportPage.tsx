import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { apiFetch, ApiError } from '../lib/api';
import { Card, PageHeader } from '../components/ui';
import { SiteHeader } from '../components/site/SiteHeader';

interface ImportJobResponse {
  importJob: {
    id: string;
    sourceUrl: string;
    status: 'pending' | 'fetching' | 'analyzing' | 'completed' | 'failed' | 'rejected';
    stats: Record<string, unknown>;
    errorMessage: string | null;
    createdAt: string;
  };
}

/**
 * Website import — the AI importer foundation.
 *
 * Submits a source URL with an ownership confirmation and shows the resulting
 * import job (fetched raw content is stored privately; nothing is published).
 */
export function SiteImportPage() {
  const { siteId } = useParams<{ siteId: string }>();
  const [sourceUrl, setSourceUrl] = useState('');
  const [ownershipConfirmed, setOwnershipConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [job, setJob] = useState<ImportJobResponse['importJob'] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setJob(null);
    try {
      const response = await apiFetch<ImportJobResponse>(`/api/sites/${siteId}/import`, {
        method: 'POST',
        body: JSON.stringify({ sourceUrl, ownershipConfirmed }),
      });
      setJob(response.importJob);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Import failed.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <SiteHeader />
      <PageHeader
        title="Import"
        description="Import an existing website into Holonet (foundation: fetch + analysis only)."
      />

      <Card>
        <form onSubmit={submit} className="grid gap-4">
          <label className="grid gap-1">
            <span className="text-sm font-medium text-slate-700">Source URL</span>
            <input
              type="url"
              required
              value={sourceUrl}
              onChange={(event) => setSourceUrl(event.target.value)}
              placeholder="https://example.com"
              className="rounded-lg border border-slate-300 px-3 py-2"
            />
          </label>
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={ownershipConfirmed}
              onChange={(event) => setOwnershipConfirmed(event.target.checked)}
            />
            I confirm I own or am authorized to import this website.
          </label>
          <div>
            <button
              type="submit"
              disabled={busy || !ownershipConfirmed}
              className="rounded-lg bg-indigo-600 px-4 py-2 text-white disabled:opacity-50"
            >
              {busy ? 'Importing…' : 'Start import'}
            </button>
          </div>
        </form>
        <p className="mt-3 text-xs text-slate-400">
          The importer fetches at most 3 public pages (5 MiB, 20 s each), respects robots.txt, never
          sends credentials, and stores raw content privately. Nothing is published.
        </p>
      </Card>

      {error && <p className="mt-4 text-sm text-red-600">{error}</p>}

      {job && (
        <Card className="mt-4">
          <h3 className="mb-2 text-sm font-semibold text-slate-700">Import job</h3>
          <dl className="grid gap-1 text-sm">
            <div className="flex gap-2">
              <dt className="w-28 shrink-0 text-slate-500">Status</dt>
              <dd>
                <span
                  className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                    job.status === 'completed'
                      ? 'bg-green-100 text-green-700'
                      : job.status === 'rejected' || job.status === 'failed'
                        ? 'bg-red-100 text-red-700'
                        : 'bg-slate-100 text-slate-600'
                  }`}
                >
                  {job.status}
                </span>
              </dd>
            </div>
            <div className="flex gap-2">
              <dt className="w-28 shrink-0 text-slate-500">Source</dt>
              <dd className="break-all text-slate-900">{job.sourceUrl}</dd>
            </div>
            {job.errorMessage && (
              <div className="flex gap-2">
                <dt className="w-28 shrink-0 text-slate-500">Error</dt>
                <dd className="break-words text-slate-900">{job.errorMessage}</dd>
              </div>
            )}
            <div className="flex gap-2">
              <dt className="w-28 shrink-0 text-slate-500">Details</dt>
              <dd className="break-all text-slate-900">{JSON.stringify(job.stats)}</dd>
            </div>
          </dl>
        </Card>
      )}
    </div>
  );
}
