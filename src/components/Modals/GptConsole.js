import React, { useState } from 'react';
import './Modal.css';
import api from '../../services/api';

const GptConsole = ({ onClose }) => {
  const [prompt, setPrompt] = useState('');
  const [type, setType] = useState('text');
  const [count, setCount] = useState(1);
  const [isLoading, setIsLoading] = useState(false);
  const [seconds, setSeconds] = useState('');
  const [message, setMessage] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    setIsLoading(true);
    setMessage('');
    try {
      if (type === 'text') {
        await api.generateOpenRouter(prompt, count);
      } else {
        const durationSeconds = seconds ? Number(seconds) : undefined;
        await api.generateUniversal(prompt, type, count, durationSeconds);
      }
      setMessage('✅ Запит відправлено. Контент з’явиться у свайпі.');
    } catch (err) {
      setMessage('❌ Помилка: ' + (err?.message || 'failed'));
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content modal-small" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>GPT Console</h2>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>

        <div className="modal-body">
          <form onSubmit={handleSubmit}>
            <div className="form-group">
              <label htmlFor="type">Тип контенту</label>
              <select id="type" className="form-input" value={type} onChange={(e) => setType(e.target.value)}>
                <option value="text">Текст</option>
                <option value="image">Зображення</option>
                <option value="video">Відео</option>
                <option value="audio">Аудіо</option>
                <option value="combo">Комбо</option>
              </select>
            </div>
            <div className="form-group">
              <label htmlFor="prompt">Що згенерувати?</label>
              <textarea id="prompt" className="form-input" value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="Опиши, що ти хочеш згенерувати…" rows={4} required />
            </div>
            <div className="form-group">
              <label htmlFor="count">Кількість</label>
              <input id="count" type="number" min="1" max="10" className="form-input" value={count} onChange={(e) => setCount(Number(e.target.value) || 1)} />
            </div>
          {(type === 'audio' || type === 'video' || type === 'combo') && (
            <div className="form-group">
              <label htmlFor="seconds">Тривалість (сек)</label>
              <input id="seconds" type="number" min="1" max="30" className="form-input" value={seconds} onChange={(e) => setSeconds(e.target.value)} placeholder="Напр. 10" />
            </div>
          )}

            {message && (
              <div className="info-message">{message}</div>
            )}

            <div className="modal-actions">
              <button type="button" className="btn btn-secondary" onClick={onClose} disabled={isLoading}>Скасувати</button>
              <button type="submit" className="btn btn-primary" disabled={isLoading}>{isLoading ? 'Надсилання...' : 'Згенерувати'}</button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
};

export default GptConsole;


