import React, { useState, useEffect } from 'react';
import api from '../../services/api';
import GenerateModal from '../Modals/GenerateModal';
import './AdminPanel.css';

const AdminPanel = ({ onClose }) => {
  const [activeTab, setActiveTab] = useState('content');
  const [content, setContent] = useState([]);
  const [ratings, setRatings] = useState([]);
  const [stats, setStats] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [showGenerateModal, setShowGenerateModal] = useState(false);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const pageSize = 10;

  useEffect(() => {
    loadData();
  }, [activeTab, page]);

  const loadData = async () => {
    setIsLoading(true);
    try {
      if (activeTab === 'content') {
        const res = await api.getAllContent(page, pageSize);
        const items = Array.isArray(res) ? res : (res.items || res.data || []);
        setContent(items);
        const t = (typeof res?.total === 'number') ? res.total : 0;
        setTotal(t);
      } else if (activeTab === 'ratings') {
        setRatings([]);
      } else if (activeTab === 'stats') {
        const data = await api.getStats();
        setStats(data);
      }
    } catch (error) {
      console.error('Failed to load data:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleGenerate = async (formData) => {
    try {
      await api.generateContent(formData.prompt, formData.model, {
        type: formData.type,
        count: Number(formData.count) || 1,
      });
      alert('Контент успішно згенеровано!');
      setPage(1);
      loadData();
    } catch (error) {
      throw error;
    }
  };

  const handleDeleteContent = async (id) => {
    if (!window.confirm('Видалити цей контент?')) return;

    try {
      await api.deleteContent(id);
      loadData();
    } catch (error) {
      alert('Помилка видалення: ' + error.message);
    }
  };

  const handleLogout = () => {
    api.logout();
    onClose();
  };

  return (
    <div className="admin-panel">
      <div className="admin-header">
        <h1>Адмін-панель</h1>
        <div className="admin-header-actions">
          <button className="btn btn-primary" onClick={() => setShowGenerateModal(true)}>
            + Згенерувати
          </button>
          <button className="btn btn-secondary" onClick={handleLogout}>
            Вийти
          </button>
          <button className="btn btn-secondary" onClick={onClose}>
            ← Назад
          </button>
        </div>
      </div>

      <div className="admin-tabs">
        <button
          className={`tab ${activeTab === 'content' ? 'active' : ''}`}
          onClick={() => { setActiveTab('content'); setPage(1); }}
        >
          Контент ({content.length})
        </button>
        <button
          className={`tab ${activeTab === 'ratings' ? 'active' : ''}`}
          onClick={() => setActiveTab('ratings')}
        >
          Оцінки
        </button>
        <button
          className={`tab ${activeTab === 'stats' ? 'active' : ''}`}
          onClick={() => setActiveTab('stats')}
        >
          Статистика
        </button>
      </div>

      <div className="admin-content">
        {isLoading ? (
          <div className="loading">Завантаження...</div>
        ) : (
          <>
            {activeTab === 'content' && (
          <ContentTab content={content} onDelete={handleDeleteContent} />
            )}
            {activeTab === 'ratings' && <RatingsTab ratings={ratings} />}
            {activeTab === 'stats' && <StatsTab stats={stats} />}
          </>
        )}
      </div>

      {activeTab === 'content' && (
        <div className="pagination" style={{ display: 'flex', gap: 8, justifyContent: 'center', marginTop: 12 }}>
          <button className="btn" disabled={page <= 1} onClick={() => setPage(p => Math.max(1, p - 1))}>« Попередня</button>
          <span>Сторінка {page}{total ? ` / ${Math.max(1, Math.ceil(total / pageSize))}` : ''}</span>
          <button className="btn" disabled={total && page >= Math.ceil(total / pageSize)} onClick={() => setPage(p => p + 1)}>Наступна »</button>
        </div>
      )}

      {showGenerateModal && (
        <GenerateModal
          onGenerate={handleGenerate}
          onClose={() => setShowGenerateModal(false)}
        />
      )}
    </div>
  );
};

const ContentTab = ({ content, onDelete }) => {
  if (content.length === 0) {
    return <div className="empty-state">Немає контенту</div>;
  }

  return (
    <div className="content-grid">
      {content.map(item => (
        <div key={item.id} className="content-card">
          <div className="content-preview">
            {item.type === 'image' && (
              <img src={item.preview_url || item.url || item.assets?.[0]?.url} alt={item.title} />
            )}
            {item.type === 'video' && (
              <video src={item.url || item.assets?.[0]?.url} controls />
            )}
            {item.type === 'audio' && (
              <div className="audio-placeholder">🎵</div>
            )}
            {item.type === 'text' && (
              <div className="text-placeholder">📝</div>
            )}
          </div>
          <div className="content-info">
            <h3>{item.title}</h3>
            {item.prompt && <p className="prompt">{item.prompt}</p>}
            <div className="content-meta">
              <span className="type">{item.type}</span>
              {item.model && <span className="model">{item.model}</span>}
              {typeof item.score_mean === 'number' && item.score_count > 0 && (
                <span className="model">avg {Number(item.score_mean).toFixed(2)} ({item.score_count})</span>
              )}
            </div>
            <button
              className="btn-delete"
              onClick={() => onDelete(item.id)}
            >
              Видалити
            </button>
          </div>
        </div>
      ))}
    </div>
  );
};

const RatingsTab = ({ ratings }) => {
  if (ratings.length === 0) {
    return <div className="empty-state">Немає оцінок</div>;
  }

  return (
    <div className="ratings-list">
      {ratings.map(rating => (
        <div key={rating.id} className="rating-card">
          <div className="rating-header">
            <span className={`rating-value ${rating.rating > 0 ? 'positive' : 'negative'}`}>
              {rating.rating > 0 ? '+' : ''}{rating.rating}
            </span>
            <span className="rating-date">
              {new Date(rating.rated_at).toLocaleString('uk-UA')}
            </span>
          </div>
          {rating.comment && (
            <p className="rating-comment">{rating.comment}</p>
          )}
          <div className="rating-content-info">
            <small>Контент: {rating.content_title || `ID ${rating.content_id}`}</small>
          </div>
        </div>
      ))}
    </div>
  );
};

const StatsTab = ({ stats }) => {
  if (!stats) {
    return <div className="empty-state">Немає статистики</div>;
  }

  return (
    <div className="stats-grid">
      <div className="stat-card">
        <h3>Всього контенту</h3>
        <div className="stat-value">{stats.total || 0}</div>
      </div>
      <div className="stat-card">
        <h3>Оцінено</h3>
        <div className="stat-value">{stats.rated || 0}</div>
      </div>
      <div className="stat-card">
        <h3>В очікуванні</h3>
        <div className="stat-value">{stats.pending || 0}</div>
      </div>
      <div className="stat-card">
        <h3>Середній позитивний</h3>
        <div className="stat-value">{stats.avg_positive_rating ? Number(stats.avg_positive_rating).toFixed(2) : '—'}</div>
      </div>
    </div>
  );
};

export default AdminPanel;
