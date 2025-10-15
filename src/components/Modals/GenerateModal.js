import React, { useState, useEffect } from 'react';
import './Modal.css';

const GenerateModal = ({ onGenerate, onClose }) => {
  const [formData, setFormData] = useState({
    prompt: '',
    type: 'image',
    model: '',
    count: 1  // ← ВИПРАВЛЕНО: додано count
  });
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState('');
  const [availableModels, setAvailableModels] = useState({ image: [], video: [], audio: [] });

  useEffect(() => {
    const fetchModels = async () => {
      try {
        const resp = await fetch('/api/models');
        const models = await resp.json();
        setAvailableModels(models || { image: [], video: [], audio: [] });
        if (models?.image?.length) {
          setFormData(prev => ({ ...prev, model: models.image[0].replicateId }));
        }
      } catch (e) {
        console.error('Failed to fetch models:', e);
      }
    };
    fetchModels();
  }, []);

  const contentTypes = [
    { value: 'image', label: '🖼️ Зображення' },
    { value: 'video', label: '🎥 Відео' },
    { value: 'audio', label: '🎵 Аудіо' },
  ];

  const handleChange = (field, value) => {
    setFormData(prev => {
      const updated = { ...prev, [field]: value };
      if (field === 'type') {
        const first = (availableModels[value] || [])[0]?.replicateId || '';
        updated.model = first;
      }
      return updated;
    });
    setError('');
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!formData.prompt.trim()) {
      setError('Введіть prompt');
      return;
    }
    if (!formData.model) {
      setError('Оберіть модель');
      return;
    }
    setIsGenerating(true);
    setError('');
    try {
      await onGenerate(formData);
      onClose();
    } catch (err) {
      console.error('Generation failed:', err);
      setError(err.message || 'Помилка генерації');
    } finally {
      setIsGenerating(false);
    }
  };

  const currentModels = availableModels[formData.type] || [];

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Згенерувати контент</h2>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>

        <div className="modal-body">
          <form onSubmit={handleSubmit}>
            <div className="form-group">
              <label htmlFor="type">Тип контенту</label>
              <select
                id="type"
                className="form-input"
                value={formData.type}
                onChange={(e) => handleChange('type', e.target.value)}
              >
                {contentTypes.map(type => (
                  <option key={type.value} value={type.value}>
                    {type.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="form-group">
              <label htmlFor="prompt">Prompt</label>
              <textarea
                id="prompt"
                className="form-input"
                value={formData.prompt}
                onChange={(e) => handleChange('prompt', e.target.value)}
                placeholder="Опишіть, що ви хочете згенерувати..."
                rows={4}
                required
              />
            </div>

            <div className="form-group">
              <label htmlFor="model">Модель</label>
              <select
                id="model"
                className="form-input"
                value={formData.model}
                onChange={(e) => handleChange('model', e.target.value)}
              >
                {currentModels.map(model => (
                  <option key={model.value} value={model.replicateId}>
                    {model.label}
                  </option>
                ))}
              </select>
            </div>

            {error && (
              <div className="error-message">{error}</div>
            )}

            <div className="modal-actions">
              <button type="button" className="btn btn-secondary" onClick={onClose} disabled={isGenerating}>Скасувати</button>
              <button type="submit" className="btn btn-primary" disabled={isGenerating}>{isGenerating ? 'Генерація...' : 'Згенерувати'}</button>
            </div>
          </form>

          {isGenerating && (
            <div className="generating-info">
              <div className="spinner"></div>
              <p>
                {formData.type === 'image' && '⏳ Генерація зображення...'}
                {formData.type === 'video' && '⏳ Генерація відео (це може зайняти декілька хвилин)...'}
                {formData.type === 'audio' && '⏳ Генерація аудіо...'}
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default GenerateModal;
