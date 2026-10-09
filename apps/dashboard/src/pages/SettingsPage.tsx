import { PageHeader, PlaceholderCard } from '../components/ui';

/** Account and workspace settings — arrives with the settings phase. */
export function SettingsPage() {
  return (
    <div>
      <PageHeader title="Settings" description="Profile, workspaces, and security." />
      <PlaceholderCard feature="Profile and workspace settings" />
    </div>
  );
}
