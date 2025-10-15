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
  useEffect(() => {
    const int = setInterval(() => { api.getSummary().then(setSummary).catch(() => {}); }, 10000);
    const onVis = () => { if (!document.hidden) { api.getSummary().then(setSummary).catch(() => {}); } };
    document.addEventListener('visibilitychange', onVis);
    return () => { clearInterval(int); document.removeEventListener('visibilitychange', onVis); };
  }, []);
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

  useEffect(() => {
    if (view === 'swipe') {
      loadNextContent();
    }
  }, [view]);

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
      loadNextContent();
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
    try {
      const res = await api.generateContent(
        formData.prompt,
        formData.model,
        { type: formData.type, count: formData.count || 1 }
      );
      const jobId = res?.jobId;
      if (jobId) {
        const startedAt = Date.now();
        const poll = async () => {
          try {
            const st = await api.getGenerationStatus(jobId);
            // ← ВИПРАВЛЕНО: Додано обробку помилок
            if (st.status === 'completed') {
              try { window.dispatchEvent(new Event('summary-refresh')); } catch {}
              if (!currentContent) {
                loadNextContent();
              }
              return;
            }
            if (st.status === 'failed') {
              setError(`Помилка генерації: ${st.result?.error || 'невідома помилка'}`);
              return;
            }
            if (st.status === 'notfound') {
              setError('Генерація не знайдена');
              return;
            }
          } catch (pollErr) {
            console.error('Polling error:', pollErr);
          }
          if (Date.now() - startedAt < 120000) setTimeout(poll, 1500);
        };
        poll();
      } else {
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

  return (
    <div className="App">
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

      <footer className="app-footer">
        <p>Swipe для оцінки: ↑ +2 | → +1 | ↓ -1 | ← -2</p>
      </footer>
    </div>
  );
}

export default App;
