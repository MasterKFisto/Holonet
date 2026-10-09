import { PageHeader, PlaceholderCard } from '../components/ui';
import { SiteHeader } from '../components/site/SiteHeader';

/** Forms and submissions — arrives with the forms phase. */
export function SiteFormsPage() {
  return (
    <div>
      <SiteHeader />
      <PageHeader title="Forms" description="Form definitions and submissions." />
      <PlaceholderCard feature="Form builder and submission inbox" />
    </div>
  );
}
