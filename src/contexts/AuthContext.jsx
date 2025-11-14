import React, { createContext, useContext, useState, useEffect } from 'react';

const AuthContext = createContext(null);

// Hardcoded users
const USERS = [
  { username: 'victoria', password: 'password1234', fullName: 'Dr. Victoria' },
  { username: 'lelli', password: 'password1234', fullName: 'Dr. Lelli' },
  { username: 'carson', password: 'password1234', fullName: 'Dr. Carson' },
  { username: 'sean', password: 'password1234', fullName: 'Dr. Sean' },
  { username: 'avyesh', password: 'password1234', fullName: 'Dr. Avyesh' },
  { username: 'dani', password: 'password1234', fullName: 'Dr. Dani' },
  { username: 'admin', password: 'admin123', fullName: 'Dr. Admin' }
];

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  // Load user from localStorage on mount
  useEffect(() => {
    console.log('AuthProvider mounting, checking localStorage...');
    try {
      const savedUser = localStorage.getItem('currentUser');
      console.log('Saved user from localStorage:', savedUser);
      
      if (savedUser) {
        const userData = JSON.parse(savedUser);
        setUser(userData);
        console.log('User restored from localStorage:', userData);
      } else {
        console.log('No saved user found');
      }
    } catch (error) {
      console.error('Error loading user from localStorage:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  // Debug: log user state changes
  useEffect(() => {
    console.log('User state changed:', user);
  }, [user]);

  const login = (username, password) => {
    console.log('Login attempt:', username);
    
    // Check hardcoded users
    const foundUser = USERS.find(u => u.username === username && u.password === password);
    
    if (foundUser) {
      const userData = { 
        username: foundUser.username, 
        fullName: foundUser.fullName,
        loginTime: new Date().toISOString()
      };
      
      setUser(userData);
      localStorage.setItem('currentUser', JSON.stringify(userData));
      console.log('Login successful:', userData);
      
      return { success: true };
    }

    // Check custom users
    const customUsers = JSON.parse(localStorage.getItem('users') || '[]');
    const customUser = customUsers.find(u => u.username === username && u.password === password);
    
    if (customUser) {
      const userData = { 
        username: customUser.username, 
        fullName: customUser.fullName,
        loginTime: new Date().toISOString()
      };
      
      setUser(userData);
      localStorage.setItem('currentUser', JSON.stringify(userData));
      console.log('Login successful (custom user):', userData);
      
      return { success: true };
    }

    console.log('Login failed: Invalid credentials');
    return { success: false, error: 'Invalid username or password' };
  };

  const signup = (username, password, fullName) => {
    console.log('Signup attempt:', username);
    
    // Check if username exists
    const existingUser = USERS.find(u => u.username === username);
    if (existingUser) {
      return { success: false, error: 'Username already exists' };
    }

    const customUsers = JSON.parse(localStorage.getItem('users') || '[]');
    const existingCustomUser = customUsers.find(u => u.username === username);
    if (existingCustomUser) {
      return { success: false, error: 'Username already exists' };
    }

    // Create new user
    const newUser = { username, password, fullName };
    customUsers.push(newUser);
    localStorage.setItem('users', JSON.stringify(customUsers));

    
    const userData = { 
      username, 
      fullName,
      loginTime: new Date().toISOString()
    };
    setUser(userData);
    localStorage.setItem('currentUser', JSON.stringify(userData));
    console.log('Signup successful:', userData);

    return { success: true };
  };

  const logout = () => {
    console.log('Logging out');
    setUser(null);
    localStorage.removeItem('currentUser');
  };

  const value = {
    user,
    login,
    logout,
    signup,
    loading
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};