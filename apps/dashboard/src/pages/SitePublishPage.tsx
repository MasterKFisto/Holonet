import { PageHeader, PlaceholderCard } from '../components/ui';
import { SiteHeader } from '../components/site/SiteHeader';

/** Publishing controls — deploy/rollback UI arrives with the builder phase. */
export function SitePublishPage() {
  return (
    <div>
      <SiteHeader />
      <PageHeader title="Publish" description="Build releases and publish to OSS." />
      <PlaceholderCard feature="Publish / rollback controls and deployment history" />
    </div>
  );
}
