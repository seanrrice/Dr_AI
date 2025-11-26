import React from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';

export default function ProtectedRoute({ children }) {
  const { user, loading } = useAuth();

  //console.log('ProtectedRoute check:', { user, loading }); // Debug 

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-teal-50 via-green-50 to-emerald-50 flex items-center justify-center">
        <div className="text-slate-600">Loading...</div>
      </div>
    );
  }

  if (!user) {
    //console.log('No user found, redirecting to login'); // Debug 
    return <Navigate to="/login" replace />;
  }

  return children;
}