import { Card, PageHeader, PlaceholderCard } from '../components/ui';
import { useHealth, useMe } from '../api/hooks';

/** Dashboard overview: API status and signed-in user (skeleton phase). */
export function DashboardPage() {
  const health = useHealth();
  const me = useMe();

  return (
    <div>
      <PageHeader title="Dashboard" description="Platform overview and quick status." />
      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <h2 className="text-sm font-semibold text-slate-900">API status</h2>
          <p className="mt-2 text-sm text-slate-600">
            {health.isLoading ? (
              'Checking…'
            ) : health.isError ? (
              <span className="text-red-600">Unreachable</span>
            ) : (
              <span className="text-emerald-600">
                {health.data?.service} is {health.data?.ok ? 'healthy' : 'degraded'}
              </span>
            )}
          </p>
        </Card>
        <Card>
          <h2 className="text-sm font-semibold text-slate-900">Signed in as</h2>
          <p className="mt-2 text-sm text-slate-600">
            {me.data ? me.data.user.email : 'Not signed in — visit /login.'}
          </p>
        </Card>
      </div>
      <div className="mt-6">
        <PlaceholderCard
          feature="Activity feed"
          note="Recent publishes, imports, and audit events arrive in a later phase."
        />
      </div>
    </div>
  );
}
