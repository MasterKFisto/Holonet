import { PageHeader, PlaceholderCard } from '../components/ui';

/** Sites overview — the list arrives once the workspace selector is wired. */
export function SitesPage() {
  return (
    <div>
      <PageHeader title="Sites" description="Static sites in the selected workspace." />
      <PlaceholderCard
        feature="Site list"
        note="Lists sites for the selected workspace (useSites) once the workspace selector is implemented — the typed hooks are ready."
      />
    </div>
  );
}
