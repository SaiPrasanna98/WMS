import { Outlet, NavLink } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { NAV_GROUPS } from '../config/navigation';
import { Breadcrumbs } from './Breadcrumbs';

export function Layout() {
  const { user, logout, hasPermission } = useAuth();

  const visibleGroups = NAV_GROUPS.map(group => ({
    ...group,
    items: group.items.filter(item => hasPermission(item.permission)),
  })).filter(group => group.items.length > 0);

  const primaryRole = user?.roles[0] ?? '';

  return (
    <div className="app-layout">
      <aside className="sidebar">
        <div className="sidebar-brand">
          <div className="brand-mark">W</div>
          <div>
            <h2>Warehouse</h2>
            <span className="brand-sub">Operations</span>
          </div>
        </div>
        <nav className="sidebar-nav">
          {visibleGroups.map(group => (
            <div key={group.title} className="nav-group">
              <div className="nav-group-title">{group.title}</div>
              {group.items.map(item => (
                <NavLink
                  key={item.path}
                  to={item.path}
                  className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
                >
                  {item.label}
                </NavLink>
              ))}
            </div>
          ))}
        </nav>
      </aside>

      <div className="main-area">
        <header className="topbar">
          <div className="topbar-left">
            <Breadcrumbs />
          </div>
          <div className="topbar-right">
            <NavLink
              to="/settings"
              className={({ isActive }) => `btn btn-outline btn-sm topbar-settings ${isActive ? 'active' : ''}`}
            >
              Settings
            </NavLink>
            <div className="user-info">
              <span className="user-name">{user?.fullName}</span>
              <span className="user-role">{primaryRole}</span>
            </div>
            <button className="btn btn-outline btn-sm" onClick={logout}>
              Sign out
            </button>
          </div>
        </header>
        <main className="content">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
