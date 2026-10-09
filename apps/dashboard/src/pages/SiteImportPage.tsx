import { PageHeader, PlaceholderCard } from '../components/ui';
import { SiteHeader } from '../components/site/SiteHeader';

/** Website import — AI-assisted import arrives with the import phase. */
export function SiteImportPage() {
  return (
    <div>
      <SiteHeader />
      <PageHeader title="Import" description="Import an existing website into Holonet." />
      <PlaceholderCard feature="Import wizard (manual + AI-assisted)" />
    </div>
  );
}
