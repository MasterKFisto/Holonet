import { useParams } from 'react-router-dom';
import { Card, PageHeader, PlaceholderCard } from '../components/ui';
import { SiteHeader } from '../components/site/SiteHeader';
import { useSite } from '../api/hooks';

/** Site overview: name, status, and upcoming sections. */
export function SiteDetailPage() {
  const { siteId } = useParams<{ siteId: string }>();
  const site = useSite(siteId);

  return (
    <div>
      <SiteHeader />
      <PageHeader
        title={site.data ? site.data.site.name : 'Site overview'}
        description={
          site.data
            ? `Status: ${site.data.site.status} · slug: ${site.data.site.slug}`
            : 'Loading site…'
        }
      />
      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <h2 className="text-sm font-semibold text-slate-900">Pages</h2>
          <p className="mt-2 text-sm text-slate-600">Manage pages and content blocks.</p>
        </Card>
        <Card>
          <h2 className="text-sm font-semibold text-slate-900">Publishing</h2>
          <p className="mt-2 text-sm text-slate-600">Build and publish static releases to OSS.</p>
        </Card>
      </div>
      <div className="mt-6">
        <PlaceholderCard feature="Site analytics" />
      </div>
    </div>
  );
}
