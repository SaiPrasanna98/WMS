import { Link, useLocation } from 'react-router-dom';
import { getBreadcrumbs } from '../utils/breadcrumbs';

export function Breadcrumbs() {
  const { pathname } = useLocation();
  const crumbs = getBreadcrumbs(pathname);

  if (crumbs.length === 0) return null;

  return (
    <nav className="breadcrumbs" aria-label="Breadcrumb">
      <ol className="breadcrumb-list">
        {crumbs.map((crumb, index) => {
          const isLast = index === crumbs.length - 1;
          return (
            <li key={`${crumb.label}-${index}`} className="breadcrumb-item">
              {index > 0 && <span className="breadcrumb-sep" aria-hidden="true">/</span>}
              {crumb.path && !isLast ? (
                <Link to={crumb.path} className="breadcrumb-link">{crumb.label}</Link>
              ) : (
                <span className={isLast ? 'breadcrumb-current' : 'breadcrumb-text'}>
                  {crumb.label}
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
