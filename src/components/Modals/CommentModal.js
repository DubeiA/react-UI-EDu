import React, { useState } from 'react';
import './Modal.css';

const CommentModal = ({ rating, onSubmit, onSkip, onClose }) => {
  const [comment, setComment] = useState('');

  const getRatingLabel = (rating) => {
    switch (rating) {
      case 2: return '+2 (Дуже добре)';
      case 1: return '+1 (Добре)';
      case -1: return '-1 (Погано)';
      case -2: return '-2 (Дуже погано)';
      default: return '';
    }
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    onSubmit(comment);
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Додати коментар</h2>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>

        <div className="modal-body">
          <div className={`rating-badge ${rating > 0 ? 'positive' : 'negative'}`}>
            {getRatingLabel(rating)}
          </div>

          <form onSubmit={handleSubmit}>
            <textarea
              className="comment-textarea"
              placeholder="Чому ви поставили таку оцінку? (необов'язково)"
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              rows={4}
              autoFocus
            />

            <div className="modal-actions">
              <button
                type="button"
                className="btn btn-secondary"
                onClick={onSkip}
              >
                Пропустити
              </button>
              <button
                type="submit"
                className="btn btn-primary"
              >
                Зберегти
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
};

export default CommentModal;
