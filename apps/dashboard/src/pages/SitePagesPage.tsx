import { PageHeader, PlaceholderCard } from '../components/ui';
import { SiteHeader } from '../components/site/SiteHeader';

/** Pages list for a site — the page CRUD UI arrives in a later phase. */
export function SitePagesPage() {
  return (
    <div>
      <SiteHeader />
      <PageHeader title="Pages" description="Pages and their content blocks." />
      <PlaceholderCard feature="Page list and ordering" />
    </div>
  );
}
