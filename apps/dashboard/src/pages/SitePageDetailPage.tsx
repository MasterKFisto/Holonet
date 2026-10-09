import { useParams } from 'react-router-dom';
import { PageHeader, PlaceholderCard } from '../components/ui';
import { SiteHeader } from '../components/site/SiteHeader';

/** Single page detail — the block editor arrives in a later phase. */
export function SitePageDetailPage() {
  const { pageId } = useParams<{ pageId: string }>();
  return (
    <div>
      <SiteHeader />
      <PageHeader
        title="Page detail"
        description={`Page ${pageId ?? ''} — blocks render here in a later phase.`}
      />
      <PlaceholderCard
        feature="Block editor"
        note="Not implemented yet by design (requirement 10)."
      />
    </div>
  );
}
