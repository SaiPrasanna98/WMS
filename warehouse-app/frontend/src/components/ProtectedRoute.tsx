import { ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { getDefaultRoute } from '../utils/routing';

interface ProtectedRouteProps {
  children: ReactNode;
  permission?: string;
  permissions?: string[];
}

export function ProtectedRoute({ children, permission, permissions }: ProtectedRouteProps) {
  const { user, loading, hasPermission, hasAnyPermission } = useAuth();

  if (loading) {
    return <div className="loading-screen">Loading...</div>;
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  const fallback = getDefaultRoute(user.permissions);

  if (permission && !hasPermission(permission)) {
    return <Navigate to={fallback} replace />;
  }

  if (permissions && !hasAnyPermission(...permissions)) {
    return <Navigate to={fallback} replace />;
  }

  return <>{children}</>;
}
