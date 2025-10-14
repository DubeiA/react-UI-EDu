import { render, screen, fireEvent } from '@testing-library/react';
import SwipeCard from './SwipeCard';

describe('SwipeCard Component', () => {
  const mockContent = {
    id: 1,
    title: 'Test Image',
    type: 'image',
    url: 'https://example.com/image.jpg',
    prompt: 'A beautiful sunset',
    model: 'flux-schnell',
  };

  const mockOnRate = jest.fn();
  const mockOnSkip = jest.fn();

  beforeEach(() => {
    mockOnRate.mockClear();
    mockOnSkip.mockClear();
  });

  test('renders content correctly', () => {
    render(<SwipeCard content={mockContent} onRate={mockOnRate} onSkip={mockOnSkip} />);
    
    expect(screen.getByText('Test Image')).toBeInTheDocument();
    expect(screen.getByAltText('Test Image')).toBeInTheDocument();
    expect(screen.getByText(/A beautiful sunset/i)).toBeInTheDocument();
  });

  test('renders empty state when no content', () => {
    render(<SwipeCard content={null} onRate={mockOnRate} onSkip={mockOnSkip} />);
    
    expect(screen.getByText(/Немає доступного контенту/i)).toBeInTheDocument();
  });

  test('shows skip button when onSkip provided', () => {
    render(<SwipeCard content={mockContent} onRate={mockOnRate} onSkip={mockOnSkip} />);
    
    const skipButton = screen.getByText(/Пропустити/i);
    expect(skipButton).toBeInTheDocument();
    
    fireEvent.click(skipButton);
    expect(mockOnSkip).toHaveBeenCalledTimes(1);
  });

  test('shows swipe instructions', () => {
    render(<SwipeCard content={mockContent} onRate={mockOnRate} onSkip={mockOnSkip} />);
    
    expect(screen.getByText('↑ +2')).toBeInTheDocument();
    expect(screen.getByText('→ +1')).toBeInTheDocument();
    expect(screen.getByText('↓ -1')).toBeInTheDocument();
    expect(screen.getByText('← -2')).toBeInTheDocument();
  });

  test('renders different content types', () => {
    // Video content
    const videoContent = { ...mockContent, type: 'video' };
    const { rerender } = render(<SwipeCard content={videoContent} onRate={mockOnRate} />);
    expect(screen.getByRole('video')).toBeInTheDocument();

    // Audio content
    const audioContent = { ...mockContent, type: 'audio' };
    rerender(<SwipeCard content={audioContent} onRate={mockOnRate} />);
    expect(screen.getByRole('audio')).toBeInTheDocument();

    // Text content
    const textContent = { ...mockContent, type: 'text', description: 'Text content' };
    rerender(<SwipeCard content={textContent} onRate={mockOnRate} />);
    expect(screen.getByText('Text content')).toBeInTheDocument();
  });
});
