import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Activity, Users, Plus, LogOut } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';

export default function Layout({ children }) {
  const location = useLocation();
  const { user, logout } = useAuth();
  
  const navItems = [
    { name: 'Dashboard', path: '/dashboard', icon: Activity },
    { name: 'Patients', path: '/patients', icon: Users },
    { name: 'New Visit', path: '/new-visit', icon: Plus },
  ];

  const isActive = (path) => {
    return location.pathname === path;
  };

  return (
    <div className="flex min-h-screen">
      {/* Sidebar */}
      <div className="w-64 bg-white border-r border-gray-200 flex flex-col">
        {/* Logo */}
        <div className="p-6 border-b border-gray-200">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-gradient-to-br from-teal-400 to-teal-600 rounded-lg flex items-center justify-center">
              <Activity className="w-6 h-6 text-white" />
            </div>
            <div>
              <h1 className="font-semibold text-gray-900">Smart Exam Room</h1>
              <p className="text-xs text-teal-600">Clinical Analysis</p>
            </div>
          </div>
        </div>

        {/* Navigation */}
        <nav className="flex-1 p-4">
          <div className="mb-2">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2 px-3">
              Navigation
            </p>
          </div>
          <div className="space-y-1">
            {navItems.map((item) => {
              const Icon = item.icon;
              return (
                <Link
                  key={item.path}
                  to={item.path}
                  className={`flex items-center gap-3 px-3 py-2 rounded-lg transition-colors ${
                    isActive(item.path)
                      ? 'bg-teal-50 text-teal-700 font-medium'
                      : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
                  }`}
                >
                  <Icon className="w-5 h-5" />
                  <span className="text-sm">{item.name}</span>
                </Link>
              );
            })}
          </div>
        </nav>

        {/* Footer - User Info */}
        <div className="p-4 border-t border-gray-200 space-y-3">
          <div className="flex items-center gap-2 px-3 py-2">
            <div className="w-8 h-8 bg-teal-100 rounded-full flex items-center justify-center">
              <span className="text-xs font-semibold text-teal-700">
                {user?.fullName?.split(' ')[0]?.charAt(0) || 'U'}
              </span>
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-gray-900 truncate">
                {user?.fullName || 'User'}
              </p>
              <p className="text-xs text-gray-500">v1.0</p>
            </div>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={logout}
            className="w-full flex items-center gap-2 text-gray-600 hover:text-red-600 hover:border-red-300"
          >
            <LogOut className="w-4 h-4" />
            Sign Out
          </Button>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 overflow-auto">
        {children}
      </div>
    </div>
  );
}