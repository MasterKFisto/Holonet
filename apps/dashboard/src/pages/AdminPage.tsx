import { PageHeader, PlaceholderCard } from '../components/ui';

/** Admin area — workspaces, security events, and audit logs (admin role). */
export function AdminPage() {
  return (
    <div>
      <PageHeader title="Admin" description="Platform administration for admin users." />
      <PlaceholderCard feature="Workspace management, security events, and audit logs" />
    </div>
  );
}
