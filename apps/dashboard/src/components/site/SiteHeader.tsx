import { NavLink, useParams } from 'react-router-dom';

/** Secondary navigation for a single site. */
export function SiteHeader() {
  const { siteId } = useParams<{ siteId: string }>();

  const tabs = [
    { to: `/sites/${siteId}`, label: 'Overview', end: true },
    { to: `/sites/${siteId}/pages`, label: 'Pages' },
    { to: `/sites/${siteId}/theme`, label: 'Theme' },
    { to: `/sites/${siteId}/publish`, label: 'Publish' },
    { to: `/sites/${siteId}/forms`, label: 'Forms' },
    { to: `/sites/${siteId}/import`, label: 'Import' },
  ];

  return (
    <div className="mb-6 border-b border-slate-200">
      <nav className="-mb-px flex gap-6">
        {tabs.map((tab) => (
          <NavLink
            key={tab.to}
            to={tab.to}
            end={tab.end}
            className={({ isActive }) =>
              `border-b-2 px-1 pb-3 text-sm font-medium transition-colors ${
                isActive
                  ? 'border-indigo-600 text-indigo-700'
                  : 'border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-700'
              }`
            }
          >
            {tab.label}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
