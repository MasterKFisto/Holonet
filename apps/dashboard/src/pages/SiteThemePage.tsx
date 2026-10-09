import { PageHeader, PlaceholderCard } from '../components/ui';
import { SiteHeader } from '../components/site/SiteHeader';

/** Site theming — design tokens arrive with the theming phase. */
export function SiteThemePage() {
  return (
    <div>
      <SiteHeader />
      <PageHeader title="Theme" description="Colors, fonts, and design tokens." />
      <PlaceholderCard feature="Design token editor" />
    </div>
  );
}
