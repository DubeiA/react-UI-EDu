import { useState, useCallback } from 'react';

export const useAppState = () => {
  const [state, setState] = useState({
    currentContent: null,
    isLoading: false,
    error: null,
    view: 'swipe', // 'swipe' | 'admin' | 'settings'
    isAuthenticated: !!localStorage.getItem('token'),
  });

  const setCurrentContent = useCallback((content) => {
    setState(prev => ({ ...prev, currentContent: content, error: null }));
  }, []);

  const setLoading = useCallback((isLoading) => {
    setState(prev => ({ ...prev, isLoading }));
  }, []);

  const setError = useCallback((error) => {
    setState(prev => ({ ...prev, error, isLoading: false }));
  }, []);

  const setView = useCallback((view) => {
    setState(prev => ({ ...prev, view }));
  }, []);

  const setAuthenticated = useCallback((isAuthenticated) => {
    setState(prev => ({ ...prev, isAuthenticated }));
  }, []);

  const clearError = useCallback(() => {
    setState(prev => ({ ...prev, error: null }));
  }, []);

  return {
    ...state,
    setCurrentContent,
    setLoading,
    setError,
    setView,
    setAuthenticated,
    clearError,
  };
};
