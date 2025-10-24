import React, { useState, useEffect } from 'react';
import './Modal.css';

const GenerateModal = ({ onGenerate, onClose }) => {
  const [formData, setFormData] = useState({
    prompt: '',
    type: 'image',
    model: '',
    count: '',
    use_agent: true,
    agent_id: '',
    generate_variants: false,
    variants_count: 5,
  });
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState('');
  const [availableModels, setAvailableModels] = useState({ image: [], video: [], audio: [] });
  const [agents, setAgents] = useState([]);
  const [loading, setLoading] = useState(false);
  const [enhancedPreview, setEnhancedPreview] = useState(null);
  const [showPreview, setShowPreview] = useState(false);

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

  useEffect(() => {
    const fetchAgents = async () => {
      try {
        const resp = await fetch('/api/agents');
        const data = await resp.json();
        setAgents(Array.isArray(data?.agents) ? data.agents : []);
      } catch (e) {
        console.error('Failed to fetch agents:', e);
      }
    };
    fetchAgents();
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
    const n = Number(formData.count);
    if (formData.generate_variants) {
      // варіанти генеруються окремим шляхом
      await handleGenerateVariants();
      return;
    }
    if (!Number.isFinite(n) || n < 1 || n > 500) {
      setError('Кількість має бути від 1 до 500');
      return;
    }
    setIsGenerating(true);
    setError('');
    try {
      await onGenerate({
        ...formData,
        count: n,
      });
      onClose();
    } catch (err) {
      console.error('Generation failed:', err);
      setError(err.message || 'Помилка генерації');
    } finally {
      setIsGenerating(false);
    }
  };

  const currentModels = availableModels[formData.type] || [];
  const agentsForType = agents.filter(a => a.type === formData.type);

  const handlePreviewEnhancement = async () => {
    if (!formData.prompt) {
      setError('Введіть промпт');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const resp = await fetch('/api/agents/enhance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: formData.prompt, type: formData.type, agent_id: formData.agent_id || null })
      });
      const data = await resp.json();
      setEnhancedPreview(data);
      setShowPreview(true);
    } catch (e) {
      console.error('Preview enhance failed:', e);
      setError('Не вдалось отримати попередній перегляд');
    } finally {
      setLoading(false);
    }
  };

  const handleGenerateVariants = async () => {
    if (!formData.prompt) {
      setError('Введіть промпт');
      return;
    }
    if (!formData.model) {
      alert('Оберіть модель для варіантів!');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const resp = await fetch('/api/agents/variants', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: formData.prompt, type: formData.type, count: Number(formData.variants_count) || 5 })
      });
      const data = await resp.json();
      const variants = Array.isArray(data?.variants) ? data.variants : [];
      for (const variant of variants) {
        await onGenerate({
          prompt: variant,
          type: formData.type,
          model: formData.model,
          count: 1,
          use_agent: false,
        });
      }
      alert(`Запущено генерацію ${variants.length} варіантів!`);
      onClose();
    } catch (e) {
      console.error('Variants generate failed:', e);
      setError('Помилка при генерації варіантів');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>🎨 Генерація контенту з AI агентом</h2>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>

        <div className="modal-body">
          <form onSubmit={handleSubmit}>
            <div className="form-group">
              <label htmlFor="type">Тип контенту</label>
              <select id="type" className="form-input" value={formData.type} onChange={(e) => handleChange('type', e.target.value)}>
                {contentTypes.map(type => (
                  <option key={type.value} value={type.value}>{type.label}</option>
                ))}
              </select>
            </div>

            <div className="form-group">
              <label htmlFor="prompt">Промпт</label>
              <textarea id="prompt" className="form-input" value={formData.prompt} onChange={(e) => handleChange('prompt', e.target.value)} placeholder="Опишіть що ви хочете згенерувати..." rows={4} required />
              <small className="hint">💡 Пишіть просто — агент покращить ваш промпт автоматично!</small>
            </div>

            <div className="form-group checkbox-group">
              <label>
                <input type="checkbox" checked={!!formData.use_agent} onChange={(e) => handleChange('use_agent', e.target.checked)} />
                <span>🤖 Використовувати AI агента для покращення промпту</span>
              </label>
            </div>

            {formData.use_agent && agentsForType.length > 0 && (
              <div className="form-group">
                <label>Оберіть агента (опціонально):</label>
                <select className="form-input" value={formData.agent_id || ''} onChange={(e) => handleChange('agent_id', e.target.value)}>
                  <option value="">🎲 Автоматичний вибір</option>
                  {agentsForType.map(agent => (
                    <option key={agent.id} value={agent.id}>{agent.name} - {agent.description}</option>
                  ))}
                </select>
              </div>
            )}

            {formData.use_agent && (
              <div className="form-group">
                <button type="button" className="btn btn-secondary" onClick={handlePreviewEnhancement} disabled={loading || !formData.prompt}>
                  👁️ Попередній перегляд покращення
                </button>
              </div>
            )}

            {showPreview && enhancedPreview && (
              <div className="preview-box">
                <h4>Попередній перегляд:</h4>
                <div className="preview-comparison">
                  <div className="preview-column">
                    <strong>Ваш промпт:</strong>
                    <p>{enhancedPreview.original_prompt}</p>
                  </div>
                  <div className="preview-column">
                    <strong>Покращений промпт:</strong>
                    <p className="enhanced">{enhancedPreview.enhanced_prompt}</p>
                    <small>Агент: {enhancedPreview.agent_name}</small>
                  </div>
                </div>
              </div>
            )}

            <div className="form-group checkbox-group">
              <label>
                <input type="checkbox" checked={!!formData.generate_variants} onChange={(e) => handleChange('generate_variants', e.target.checked)} />
                <span>🎲 Згенерувати множинні варіанти (різні описи однієї ідеї)</span>
              </label>
            </div>

            {formData.generate_variants && (
            <div className="form-group">
              <label>Кількість варіантів</label>
              <input type="number" className="form-input" value={formData.variants_count} min={2} max={50} onChange={(e) => handleChange('variants_count', Number(e.target.value) || 2)} />
              <small className="hint">⚠️ Кожен варіант буде згенеровано окремо (може зайняти час)</small>
            </div>
            )}

            <div className="form-group">
              <label htmlFor="model">Модель {formData.generate_variants ? '(для всіх варіантів)' : ''}</label>
              <select id="model" className="form-input" value={formData.model} onChange={(e) => handleChange('model', e.target.value)}>
                <option value="">Автоматичний вибір</option>
                {currentModels.map(model => (
                  <option key={model.value} value={model.replicateId}>{model.label}</option>
                ))}
              </select>
              {formData.generate_variants && (
                <small className="hint">ℹ️ Ця модель буде використана для генерації всіх {formData.variants_count} варіантів</small>
              )}
            </div>

            {!formData.generate_variants && (
              <div className="form-group">
                <label htmlFor="count">Кількість (1–500)</label>
                <input id="count" type="number" min={1} max={500} className="form-input" value={formData.count} placeholder="Напр. 40 або 500" onChange={(e) => handleChange('count', e.target.value)} />
              </div>
            )}

            {error && <div className="error-message">{error}</div>}

            <div className="modal-actions">
              <button type="button" className="btn btn-secondary" onClick={onClose} disabled={isGenerating || loading}>Скасувати</button>
              <button type="submit" className="btn btn-primary" disabled={isGenerating || loading}>
                {isGenerating || loading ? '⏳ Обробка...' : (formData.generate_variants ? '🎲 Згенерувати варіанти' : '✨ Згенерувати')}
              </button>
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
