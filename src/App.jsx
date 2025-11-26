import React, { useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider } from '@/contexts/AuthContext';
import ProtectedRoute from '@/components/ProtectedRoute';
import Layout from '@/components/Layout';
import Login from '@/pages/Login';
import Dashboard from '@/pages/Dashboard';
import NewVisit from '@/pages/NewVisit';
import VisitDetails from '@/pages/VisitDetails';
import PatientAnalysis from '@/pages/PatientAnalysis';
import Patients from '@/pages/Patients';
import { preloadSentimentModel } from '@/services/aiService';

const queryClient = new QueryClient();

function App() {  // ← Only ONE function declaration
  // Pre-load sentiment model in background
  useEffect(() => {
    preloadSentimentModel().then(success => {
      if (success) {
        console.log('✅ Sentiment model pre-loaded and ready!');
      } else {
        console.log('⚠️ Sentiment model will load on first use');
      }
    });
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      <Router>
        <AuthProvider>
          <Routes>
            {/* Public Routes*/}
            <Route path="/login" element={<Login />} />
            
            {/* Protected Routes */}
            <Route
              path="/dashboard"
              element={
                <ProtectedRoute>
                  <Layout>
                    <Dashboard />
                  </Layout>
                </ProtectedRoute>
              }
            />
            <Route
              path="/patients"
              element={
                <ProtectedRoute>
                  <Layout>
                    <Patients />
                  </Layout>
                </ProtectedRoute>
              }
            />
            <Route
              path="/new-visit"
              element={
                <ProtectedRoute>
                  <Layout>
                    <NewVisit />
                  </Layout>
                </ProtectedRoute>
              }
            />
            <Route
              path="/visit-details"
              element={
                <ProtectedRoute>
                  <Layout>
                    <VisitDetails />
                  </Layout>
                </ProtectedRoute>
              }
            />
            <Route
              path="/patient-analysis"
              element={
                <ProtectedRoute>
                  <Layout>
                    <PatientAnalysis />
                  </Layout>
                </ProtectedRoute>
              }
            />
            
            {/* Redirect root to login */}
            <Route path="/" element={<Navigate to="/login" replace />} />
            
            {/* redirect to login */}
            <Route path="*" element={<Navigate to="/login" replace />} />
          </Routes>
        </AuthProvider>
      </Router>
    </QueryClientProvider>
  );
}

export default App;