import React, { useState, useMemo } from 'react';
import { useSwipe } from '../../hooks/useSwipe';
import CommentModal from '../Modals/CommentModal';
import './SwipeCard.css';

const SwipeCard = ({ content, onRate, onSkip }) => {
  const [showCommentModal, setShowCommentModal] = useState(false);
  const [pendingRating, setPendingRating] = useState(null);

  const handleSwipeComplete = (rating) => {
    setPendingRating(rating);
    setShowCommentModal(true);
  };

  const {
    isDragging,
    position,
    rotation,
    handleStart,
    handleMove,
    handleEnd,
  } = useSwipe(handleSwipeComplete);

  const handleCommentSubmit = (comment) => {
    if (pendingRating !== null) {
      onRate(pendingRating, comment);
    }
    setShowCommentModal(false);
    setPendingRating(null);
  };

  const handleCommentSkip = () => {
    if (pendingRating !== null) {
      onRate(pendingRating, '');
    }
    setShowCommentModal(false);
    setPendingRating(null);
  };

  const [imageError, setImageError] = useState(false);
  const primaryAsset = useMemo(() => {
    if (!content) return null;
    const assets = Array.isArray(content.assets) ? content.assets : [];
    if (content.type === 'image') {
      return content.url || assets?.[0]?.url || null;
    }
    if (content.type === 'video') {
      return content.url || assets?.find(a => (a.mime || '').startsWith('video/'))?.url || assets?.[0]?.url || null;
    }
    if (content.type === 'audio') {
      return content.url || assets?.find(a => (a.mime || '').startsWith('audio/'))?.url || assets?.[0]?.url || null;
    }
    if (content.type === 'text') {
      return null;
    }
    if (content.type === 'combo') {
      const img = assets.find(a => (a.mime || '').startsWith('image/'))?.url;
      const vid = assets.find(a => (a.mime || '').startsWith('video/'))?.url;
      const aud = assets.find(a => (a.mime || '').startsWith('audio/'))?.url;
      return content.url || img || vid || aud || assets?.[0]?.url || null;
    }
    return content.url || assets?.[0]?.url || null;
  }, [content]);

  if (!content) {
    return (
      <div className="swipe-container">
        <div className="empty-state">
          <p>Немає доступного контенту</p>
          <p className="hint">Згенеруйте новий контент в адмін-панелі</p>
        </div>
      </div>
    );
  }

  const cardStyle = {
    transform: `translate(${position.x}px, ${position.y}px) rotate(${rotation}deg)`,
    transition: isDragging ? 'none' : 'transform 0.3s ease-out',
  };

  // Determine swipe hint
  const getSwipeHint = () => {
    const threshold = 50;
    if (position.y < -threshold) return '+2 (Дуже добре)';
    if (position.x > threshold) return '+1 (Добре)';
    if (position.y > threshold) return '-1 (Погано)';
    if (position.x < -threshold) return '-2 (Дуже погано)';
    return '';
  };

  const swipeHint = getSwipeHint();

  return (
    <>
      <div className="swipe-container">
        <div
          className={`swipe-card ${isDragging ? 'dragging' : ''}`}
          style={cardStyle}
          onMouseDown={(e) => handleStart(e.clientX, e.clientY)}
          onMouseMove={(e) => isDragging && handleMove(e.clientX, e.clientY)}
          onMouseUp={handleEnd}
          onMouseLeave={handleEnd}
          onTouchStart={(e) => handleStart(e.touches[0].clientX, e.touches[0].clientY)}
          onTouchMove={(e) => isDragging && handleMove(e.touches[0].clientX, e.touches[0].clientY)}
          onTouchEnd={handleEnd}
        >
          {/* Content Display */}
          <div className="card-content">
            {(content.type === 'image' || (content.type === 'combo' && primaryAsset && /\.(png|jpe?g|webp|gif)(\?|$)/i.test(primaryAsset))) && (
              imageError ? (
                <div className="card-text">
                  <h3>{content.title || 'Зображення недоступне'}</h3>
                  <p>Не вдалося завантажити зображення</p>
                </div>
              ) : (
                <img
                  src={primaryAsset}
                  alt={content.title}
                  className="card-image"
                  draggable="false"
                  onError={() => setImageError(true)}
                />
              )
            )}
            {(content.type === 'video' || (content.type === 'combo' && primaryAsset && /\.(mp4|webm|mov|m4v)(\?|$)/i.test(primaryAsset))) && (
              <video
                src={primaryAsset}
                className="card-video"
                controls
                playsInline
                preload="metadata"
                onLoadedData={(e) => { try { e.currentTarget.currentTime = 0; } catch {} }}
                onError={(e) => { e.currentTarget.poster = content.metadata?.poster_url || ''; }}
              />
            )}
            {(content.type === 'audio' || (content.type === 'combo' && primaryAsset && /\.(mp3|wav|ogg)(\?|$)/i.test(primaryAsset))) && (
              <div className="card-audio-container">
                <audio
                  src={primaryAsset}
                  controls
                  className="card-audio"
                  preload="metadata"
                />
                <p className="audio-title">{content.title}</p>
              </div>
            )}
            {content.type === 'text' && (
              <div className="card-text">
                <h3>{content.title}</h3>
                <p>{content.text_body || content.description}</p>
              </div>
            )}
            {content.type === 'combo' && !primaryAsset && (
              <div className="card-text">
                <h3>{content.title || 'Комбінований контент'}</h3>
                <p>{content.text_body || content.description || 'Немає прев’ю для відображення'}</p>
              </div>
            )}
          </div>

          {/* Metadata */}
          <div className="card-info">
            <h3>{content.title}</h3>
            {content.prompt && (
              <p className="card-prompt">
                <strong>Prompt:</strong> {content.prompt}
              </p>
            )}
            <div className="card-meta">
              <span className="card-type">{content.type}</span>
              {content.model && <span className="card-model">{content.model}</span>}
            </div>
          </div>

          {/* Swipe Hint Overlay */}
          {swipeHint && (
            <div className={`swipe-hint ${swipeHint.startsWith('+') ? 'positive' : 'negative'}`}>
              {swipeHint}
            </div>
          )}
        </div>

        {/* Swipe Instructions */}
        <div className="swipe-instructions">
          <div className="instruction up">↑ +2</div>
          <div className="instruction right">→ +1</div>
          <div className="instruction down">↓ -1</div>
          <div className="instruction left">← -2</div>
        </div>

        {/* Skip Button */}
        {onSkip && (
          <button className="skip-button" onClick={onSkip}>
            Пропустити
          </button>
        )}
      </div>

      {/* Comment Modal */}
      {showCommentModal && (
        <CommentModal
          rating={pendingRating}
          onSubmit={handleCommentSubmit}
          onSkip={handleCommentSkip}
          onClose={() => setShowCommentModal(false)}
        />
      )}
    </>
  );
};

export default SwipeCard;
