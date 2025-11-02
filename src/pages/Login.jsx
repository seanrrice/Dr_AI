import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Brain, UserPlus, LogIn, AlertCircle } from 'lucide-react';

export default function Login() {
  const navigate = useNavigate();
  const { login, signup } = useAuth();
  const [isSignUp, setIsSignUp] = useState(false);
  const [formData, setFormData] = useState({
    username: '',
    password: '',
    fullName: ''
  });
  const [error, setError] = useState('');

  const handleSubmit = (e) => {
    e.preventDefault();
    setError('');

    if (isSignUp) {
      if (!formData.fullName) {
        setError('Please enter your full name');
        return;
      }
      const result = signup(formData.username, formData.password, formData.fullName);
      if (!result.success) {
        setError(result.error);
      } else {
        
        navigate('/dashboard');
      }
    } else {
      const result = login(formData.username, formData.password);
      if (!result.success) {
        setError(result.error);
      } else {
        
        navigate('/dashboard');
      }
    }
  };

  const handleChange = (e) => {
    setFormData({
      ...formData,
      [e.target.name]: e.target.value
    });
  };

  const toggleMode = () => {
    setIsSignUp(!isSignUp);
    setError('');
    setFormData({ username: '', password: '', fullName: '' });
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-teal-50 via-green-50 to-emerald-50 flex items-center justify-center p-6">
      <div className="w-full max-w-md">
        {/* Logo/Header */}
        <div className="text-center mb-8">
          <div className="flex items-center justify-center gap-3 mb-4">
            <Brain className="w-12 h-12 text-teal-600" />
            <h1 className="text-4xl font-bold text-slate-900">Doctor AI</h1>
          </div>
          <p className="text-lg text-slate-600">Smart Patient Exam Room</p>
        </div>

        {/* Login/Signup Card */}
        <Card className="shadow-2xl border-none">
          <CardHeader>
            <CardTitle className="text-2xl flex items-center gap-2">
              {isSignUp ? (
                <>
                  <UserPlus className="w-6 h-6 text-teal-600" />
                  Create Account
                </>
              ) : (
                <>
                  <LogIn className="w-6 h-6 text-teal-600" />
                  Welcome Back
                </>
              )}
            </CardTitle>
            <CardDescription>
              {isSignUp 
                ? 'Sign up to access the Smart Exam Room system'
                : 'Sign in to access your patient dashboard'
              }
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              {isSignUp && (
                <div className="space-y-2">
                  <Label htmlFor="fullName">Full Name (with title)</Label>
                  <Input
                    id="fullName"
                    name="fullName"
                    type="text"
                    placeholder="e.g., Dr. Sarah Smith"
                    value={formData.fullName}
                    onChange={handleChange}
                    required={isSignUp}
                  />
                </div>
              )}

              <div className="space-y-2">
                <Label htmlFor="username">Username</Label>
                <Input
                  id="username"
                  name="username"
                  type="text"
                  placeholder="Enter your username"
                  value={formData.username}
                  onChange={handleChange}
                  required
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="password">Password</Label>
                <Input
                  id="password"
                  name="password"
                  type="password"
                  placeholder="Enter your password"
                  value={formData.password}
                  onChange={handleChange}
                  required
                />
              </div>

              {error && (
                <Alert variant="destructive">
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}

              <Button 
                type="submit" 
                className="w-full bg-teal-600 hover:bg-teal-700"
              >
                {isSignUp ? 'Create Account' : 'Sign In'}
              </Button>
            </form>

            <div className="mt-6 text-center">
              <button
                type="button"
                onClick={toggleMode}
                className="text-sm text-teal-600 hover:text-teal-700 font-medium"
              >
                {isSignUp 
                  ? 'Already have an account? Sign in'
                  : "Don't have an account? Sign up"
                }
              </button>
            </div>

            {!isSignUp && (
              <div className="mt-6 p-4 bg-slate-50 rounded-lg">
                <p className="text-xs text-slate-600 font-semibold mb-2">Demo Accounts:</p>
                <div className="space-y-1 text-xs text-slate-500">
                  <p>Username: <span className="font-mono">victoria</span> | Password: <span className="font-mono">password1234</span></p>
                  <p>Username: <span className="font-mono">admin</span> | Password: <span className="font-mono">admin123</span></p>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Footer */}
        <p className="text-center text-sm text-slate-500 mt-6">
          © 2025 Doctor AI Smart Exam Room 
        </p>
      </div>
    </div>
  );
}