import React, { useState, useEffect, useCallback, useRef } from 'react';
import SwipeCard from './components/SwipeCard/SwipeCard';
import AdminPanel from './components/AdminPanel/AdminPanel';
import GenerateModal from './components/Modals/GenerateModal';
import GptConsole from './components/Modals/GptConsole';
import LoginModal from './components/Modals/LoginModal';
import api from './services/api';
import { useAppState } from './hooks/useAppState';
import './App.css';

function StatsBar() {
  const [summary, setSummary] = useState({ total: 0, rated: 0, pending: 0 });
  useEffect(() => {
    let mounted = true;
    api.getSummary().then(s => { if (mounted) setSummary(s); }).catch(() => {});
    return () => { mounted = false; };
  }, []);
  // simple refresh on visibility change and every 10s
  useEffect(() => {
    const int = setInterval(() => { api.getSummary().then(setSummary).catch(() => {}); }, 10000);
    const onVis = () => { if (!document.hidden) { api.getSummary().then(setSummary).catch(() => {}); } };
    document.addEventListener('visibilitychange', onVis);
    return () => { clearInterval(int); document.removeEventListener('visibilitychange', onVis); };
  }, []);
  // immediate refresh on app events
  useEffect(() => {
    const onRefresh = () => { api.getSummary().then(setSummary).catch(() => {}); };
    window.addEventListener('summary-refresh', onRefresh);
    return () => { window.removeEventListener('summary-refresh', onRefresh); };
  }, []);
  return (
    <div style={{ display: 'flex', gap: 16, marginBottom: 8, fontSize: 14 }}>
      <span>Всього: {summary.total}</span>
      <span>Оцінені: {summary.rated}</span>
      <span>Очікують: {summary.pending}</span>
    </div>
  );
}

function App() {
  const {
    currentContent,
    isLoading,
    error,
    view,
    isAuthenticated,
    setCurrentContent,
    setLoading,
    setError,
    setView,
    setAuthenticated,
    clearError,
  } = useAppState();

  const [showLoginModal, setShowLoginModal] = useState(false);
  const [showGenerateModal, setShowGenerateModal] = useState(false);
  const [showGptConsole, setShowGptConsole] = useState(false);
  const pollingRef = useRef(null);
  const [isPolling, setIsPolling] = useState(false);
  let pollAttempts = 0;
  const maxPollAttempts = 5;

  // Load next content on mount
  useEffect(() => {
    if (view === 'swipe') {
      loadNextContent();
    }
  }, [view]);

  // No client-side replicate token persistence

  const stopPolling = useCallback(() => {
    if (pollingRef.current) {
      clearTimeout(pollingRef.current);
      pollingRef.current = null;
    }
    setIsPolling(false);
  }, []);

  const startPollingForContent = useCallback(() => {
    if (pollingRef.current) return;
    setIsPolling(true);
    const poll = async () => {
      try {
        const content = await api.getNextContent();
        stopPolling();
        setCurrentContent(content);
        try { window.dispatchEvent(new Event('summary-refresh')); } catch {}
      } catch (err) {
        if (err && err.status === 404) {
          pollingRef.current = setTimeout(poll, 2000);
        } else {
          stopPolling();
        }
      }
    };
    poll();
  }, [setCurrentContent, stopPolling]);

  const loadNextContent = useCallback(async () => {
    setLoading(true);
    clearError();
    
    try {
      const content = await api.getNextContent();
      setCurrentContent(content);
    } catch (err) {
      if (err && (err.status === 404)) {
        // Немає контенту — це не помилка, просто порожньо
        setCurrentContent(null);
        startPollingForContent();
      } else {
        setError('Не вдалося завантажити контент');
        console.error(err);
      }
    } finally {
      setLoading(false);
    }
  }, [setCurrentContent, setLoading, setError, clearError, startPollingForContent]);

  const handleRate = async (rating, comment) => {
    if (!currentContent) return;

    try {
      await api.submitRating(currentContent.id, rating, comment);
      // Load next content after rating
      loadNextContent();
      // Optionally: fetch summary stats and show somewhere
      try { window.dispatchEvent(new Event('summary-refresh')); } catch {}
    } catch (err) {
      setError('Не вдалося зберегти оцінку');
      console.error(err);
    }
  };

  const handleSkip = () => {
    loadNextContent();
  };

  const handleLogin = async (username, password) => {
    try {
      await api.login(username, password);
      setAuthenticated(true);
      setShowLoginModal(false);
      setView('admin');
    } catch (err) {
      throw new Error('Невірний логін або пароль');
    }
  };

  const handleOpenAdmin = () => {
    if (isAuthenticated) {
      setView('admin');
    } else {
      setShowLoginModal(true);
    }
  };
  const handleGenerate = async (formData) => {
    // Новий формат: бекенд очікує type + model (ключ з /api/models)
    try {
      const res = await api.generateContent(
        formData.prompt,
        formData.model,
        { type: formData.type, count: 1 }
      );
      const jobId = res?.jobId;
      if (jobId) {
        const startedAt = Date.now();
        const poll = async () => {
          try {
            const st = await api.getGenerationStatus(jobId);
            if (st.status === 'completed' || st.status === 'failed' || st.status === 'notfound') {
              try { window.dispatchEvent(new Event('summary-refresh')); } catch {}
              if (!currentContent) {
                loadNextContent();
              }
              return;
            }
          } catch {}
          if (Date.now() - startedAt < 120000) setTimeout(poll, 1500);
        };
        poll();
      } else {
        // Якщо бекенд відразу створює контент без черги
        try { window.dispatchEvent(new Event('summary-refresh')); } catch {}
        if (!currentContent) loadNextContent();
      }
    } catch (e) {
      const msg = String(e?.message || e || '').toLowerCase();
      if (msg.includes('unauthorized') || msg.includes('401')) {
        setShowLoginModal(true);
        throw new Error('Потрібен вхід в адмін-панель');
      }
      throw e;
    }
  };

  const handleCloseAdmin = () => {
    setView('swipe');
    setAuthenticated(false);
    if (isPolling) {
      try { window.dispatchEvent(new Event('summary-refresh')); } catch {}
    }
  };

  const pollContent = async () => {
    try {
      const response = await api.getNextContent();
      if (response) {
        // Показувати контент, не змінюючи режим перегляду
        setCurrentContent(response);
        pollAttempts = 0; // Reset poll attempts on success
      }
    } catch (error) {
      if (error.response?.status === 404) {
        pollAttempts++;
        if (pollAttempts >= maxPollAttempts) {
          console.log('Stopping polling due to repeated 404s.');
          return; // Stop polling after max attempts
        }
      }
      console.error('Polling error:', error);
    }
  };

  useEffect(() => {
    const intervalId = setInterval(pollContent, 5000); // Poll every 5 seconds
    return () => clearInterval(intervalId);
  }, []);

  return (
    <div className="App">
      {/* Header */}
      <header className="app-header">
        <h1>🔥 Tinder AI</h1>
        <div className="header-actions">
          {view === 'swipe' && (
            <button className="btn btn-admin" onClick={handleOpenAdmin}>
              ⚙️ Адмін
            </button>
          )}
        </div>
      </header>

      {/* Main Content */}
      <main className="app-main">
        {view === 'swipe' && (
          <div className="swipe-view">
            <div className="toolbar" style={{ display: 'flex', gap: 8, marginBottom: 8, justifyContent: 'flex-end' }}>
              <button className="btn" onClick={() => setShowGenerateModal(true)}>⚙️ Згенерувати</button>
              <button className="btn" onClick={() => setShowGptConsole(true)}>🤖 GPT</button>
            </div>
            <StatsBar />
            {isLoading && (
              <div className="loading-overlay">
                <div className="spinner"></div>
                <p>Завантаження...</p>
              </div>
            )}

            {error && (
              <div className="error-banner">
                <p>{error}</p>
                <button onClick={clearError}>×</button>
              </div>
            )}

            {!isLoading && !error && (
              <SwipeCard
                content={currentContent}
                onRate={handleRate}
                onSkip={handleSkip}
              />
            )}
          </div>
        )}

        {view === 'admin' && (
          <AdminPanel onClose={handleCloseAdmin} />
        )}
      </main>

      {/* Login Modal */}
      {showLoginModal && (
        <LoginModal
          onLogin={handleLogin}
          onClose={() => setShowLoginModal(false)}
        />
      )}

      {showGenerateModal && (
        <GenerateModal
          onGenerate={handleGenerate}
          onClose={() => setShowGenerateModal(false)}
        />
      )}

      {showGptConsole && (
        <GptConsole onClose={() => setShowGptConsole(false)} />
      )}

      {/* Footer */}
      <footer className="app-footer">
        <p>Swipe для оцінки: ↑ +2 | → +1 | ↓ -1 | ← -2</p>
      </footer>
    </div>
  );
}

export default App;
