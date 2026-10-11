import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useFormSubmissions, useSiteForms } from '../api/hooks';
import { Card, PageHeader } from '../components/ui';
import { SiteHeader } from '../components/site/SiteHeader';

/**
 * Form submission inbox for a site.
 *
 * Lists the site's forms and the submissions of the selected form. Submission
 * data is untrusted visitor input — React text interpolation escapes it, and
 * the raw IP is never shown (only its hash).
 */
export function SiteFormsPage() {
  const { siteId } = useParams<{ siteId: string }>();
  const formsQuery = useSiteForms(siteId);
  const [selectedFormId, setSelectedFormId] = useState<string | undefined>(undefined);
  const submissionsQuery = useFormSubmissions(selectedFormId);

  useEffect(() => {
    if (selectedFormId === undefined && formsQuery.data && formsQuery.data.forms.length > 0) {
      const first = formsQuery.data.forms[0];
      if (first) {
        setSelectedFormId(first.id);
      }
    }
  }, [formsQuery.data, selectedFormId]);

  const forms = formsQuery.data?.forms ?? [];
  const submissions = submissionsQuery.data?.submissions ?? [];

  return (
    <div>
      <SiteHeader />
      <PageHeader title="Forms" description="Form definitions and visitor submissions." />

      {formsQuery.isLoading && <p className="text-slate-500">Loading forms…</p>}
      {!formsQuery.isLoading && forms.length === 0 && (
        <Card>
          <p className="text-slate-500">
            No forms yet. Form definitions arrive with the form builder; until then, published
            contact forms accept submissions only for forms that exist here.
          </p>
        </Card>
      )}

      {forms.length > 0 && (
        <div className="grid gap-6 lg:grid-cols-3">
          <div className="space-y-2">
            {forms.map((form) => (
              <button
                key={form.id}
                type="button"
                onClick={() => setSelectedFormId(form.id)}
                className={`block w-full rounded-lg border p-3 text-left transition-colors ${
                  form.id === selectedFormId
                    ? 'border-indigo-600 bg-indigo-50'
                    : 'border-slate-200 bg-white hover:border-slate-300'
                }`}
              >
                <p className="font-medium text-slate-900">{form.name}</p>
                <p className="text-sm text-slate-500">
                  {form.status === 'active' ? 'Active' : 'Disabled'}
                  {form.notificationEmail ? ` · notifies ${form.notificationEmail}` : ''}
                </p>
              </button>
            ))}
          </div>

          <div className="lg:col-span-2">
            <Card>
              <h3 className="mb-3 text-sm font-semibold text-slate-700">Submissions</h3>
              {submissionsQuery.isLoading && <p className="text-slate-500">Loading submissions…</p>}
              {!submissionsQuery.isLoading && submissions.length === 0 && (
                <p className="text-slate-500">No submissions yet.</p>
              )}
              {submissions.length > 0 && (
                <ul className="divide-y divide-slate-200">
                  {submissions.map((submission) => (
                    <li key={submission.id} className="py-3">
                      <div className="flex items-start justify-between gap-4">
                        <dl className="grid gap-1">
                          {Object.entries(submission.data).map(([key, value]) => (
                            <div key={key} className="grid grid-cols-3 gap-2 text-sm">
                              <dt className="font-medium text-slate-500">{key}</dt>
                              <dd className="col-span-2 break-words text-slate-900">
                                {String(value)}
                              </dd>
                            </div>
                          ))}
                        </dl>
                        <time
                          dateTime={submission.createdAt}
                          className="shrink-0 text-xs text-slate-400"
                        >
                          {new Date(submission.createdAt).toLocaleString()}
                        </time>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>
        </div>
      )}
    </div>
  );
}
