import { useState, useCallback, useRef } from 'react';

export const useSwipe = (onSwipeComplete) => {
  const [isDragging, setIsDragging] = useState(false);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [rotation, setRotation] = useState(0);
  const startPos = useRef({ x: 0, y: 0 });

  const handleStart = useCallback((clientX, clientY) => {
    setIsDragging(true);
    startPos.current = { x: clientX, y: clientY };
  }, []);

  const handleMove = useCallback((clientX, clientY) => {
    if (!isDragging) return;

    const deltaX = clientX - startPos.current.x;
    const deltaY = clientY - startPos.current.y;
    
    setPosition({ x: deltaX, y: deltaY });
    setRotation(deltaX * 0.1); // Rotation based on horizontal movement
  }, [isDragging]);

  const handleEnd = useCallback(() => {
    if (!isDragging) return;

    const threshold = 100;
    let rating = null;

    // Determine swipe direction and rating
    if (Math.abs(position.x) > threshold || Math.abs(position.y) > threshold) {
      if (position.y < -threshold) {
        rating = 2; // Up = +2
      } else if (position.x > threshold) {
        rating = 1; // Right = +1
      } else if (position.y > threshold) {
        rating = -1; // Down = -1
      } else if (position.x < -threshold) {
        rating = -2; // Left = -2
      }
    }

    if (rating !== null && onSwipeComplete) {
      onSwipeComplete(rating);
    }

    // Reset position
    setIsDragging(false);
    setPosition({ x: 0, y: 0 });
    setRotation(0);
  }, [isDragging, position, onSwipeComplete]);

  const reset = useCallback(() => {
    setIsDragging(false);
    setPosition({ x: 0, y: 0 });
    setRotation(0);
  }, []);

  return {
    isDragging,
    position,
    rotation,
    handleStart,
    handleMove,
    handleEnd,
    reset,
  };
};
