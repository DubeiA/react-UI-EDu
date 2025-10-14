# 🏗️ Architecture Overview

Детальний опис архітектури React версії Tinder AI.

## 📐 High-Level Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                         Browser                              │
│  ┌───────────────────────────────────────────────────────┐  │
│  │                   React App (port 3000)                │  │
│  │  ┌─────────────┐  ┌──────────────┐  ┌─────────────┐  │  │
│  │  │   App.js    │  │ Components   │  │   Hooks     │  │  │
│  │  │  (Root)     │──│ (UI Layer)   │──│  (Logic)    │  │  │
│  │  └─────────────┘  └──────────────┘  └─────────────┘  │  │
│  │         │                                              │  │
│  │         └──────────────┬──────────────────────────────┤  │
│  │                    API Service                         │  │
│  └────────────────────────┼─────────────────────────────┬─┘  │
│                           │                              │    │
└───────────────────────────┼──────────────────────────────┼────┘
                            │ HTTP/HTTPS                   │
                            │ (Proxy via CRA)              │
                            ↓                              │
┌─────────────────────────────────────────────────────────────┐
│                   Express Backend (port 3001)               │
│  ┌──────────────┐  ┌──────────────┐  ┌─────────────────┐  │
│  │   Routes     │  │  Controllers │  │   Services      │  │
│  │  (API/Auth)  │──│  (Business)  │──│ (Replicate/DB)  │  │
│  └──────────────┘  └──────────────┘  └─────────────────┘  │
│                              │                              │
└──────────────────────────────┼──────────────────────────────┘
                               │
                               ↓
                    ┌──────────────────────┐
                    │   SQLite Database    │
                    │   (tinder_ai.db)     │
                    └──────────────────────┘
```

## 🗂️ Component Hierarchy

```
App.js (Root State)
│
├─ Header
│  └─ AdminButton
│
├─ SwipeView (view === 'swipe')
│  ├─ LoadingOverlay
│  ├─ ErrorBanner
│  └─ SwipeCard
│     ├─ CardContent (image/video/audio/text)
│     ├─ CardInfo (metadata)
│     ├─ SwipeInstructions
│     ├─ SkipButton
│     └─ CommentModal (conditional)
│
├─ AdminPanel (view === 'admin')
│  ├─ AdminHeader
│  ├─ AdminTabs
│  ├─ ContentTab (activeTab === 'content')
│  │  └─ ContentCard[] (grid)
│  ├─ RatingsTab (activeTab === 'ratings')
│  │  └─ RatingCard[] (list)
│  ├─ StatsTab (activeTab === 'stats')
│  │  └─ StatCard[] (grid)
│  └─ GenerateModal (conditional)
│
├─ LoginModal (conditional)
│
└─ Footer
```

## 🔄 Data Flow

### 1. Swipe Flow
```
User swipes card
       ↓
useSwipe hook calculates rating
       ↓
handleSwipeComplete(rating)
       ↓
Show CommentModal
       ↓
User submits comment
       ↓
onRate(rating, comment)
       ↓
api.submitRating()
       ↓
POST /api/ratings → Backend
       ↓
Save to Database
       ↓
loadNextContent()
       ↓
GET /api/content/next → Backend
       ↓
Update state.currentContent
       ↓
Re-render SwipeCard
```

### 2. Admin Flow
```
User clicks Admin button
       ↓
Check isAuthenticated?
  ├─ Yes → setView('admin')
  └─ No  → Show LoginModal
       ↓
User enters credentials
       ↓
api.login(username, password)
       ↓
POST /api/auth/login → Backend
       ↓
Verify credentials + Generate JWT
       ↓
Store token in localStorage
       ↓
setAuthenticated(true)
       ↓
setView('admin')
       ↓
Render AdminPanel
```

### 3. Generation Flow
```
User clicks "Згенерувати" in AdminPanel
       ↓
Show GenerateModal
       ↓
User fills form (prompt, model, type)
       ↓
handleGenerate(formData)
       ↓
api.generateContent()
       ↓
POST /api/generate → Backend
       ↓
Backend calls Replicate API
       ↓
Wait for generation (30-60s)
       ↓
Save to Database
       ↓
Return generated content URL
       ↓
Close modal + Reload content list
```

## 🧩 Module Responsibilities

### App.js
**Responsibility:** Root state management & routing logic
- Manages global state (view, auth, content, loading, error)
- Controls view switching (swipe ↔ admin)
- Handles authentication flow
- Coordinates between child components

### services/api.js
**Responsibility:** Backend communication
- HTTP requests to Express API
- JWT token management
- Request/response error handling
- Singleton pattern for shared instance

### hooks/useAppState.js
**Responsibility:** State management hook
- Encapsulates app-level state
- Provides state update functions
- Simplifies state updates in components

### hooks/useSwipe.js
**Responsibility:** Swipe gesture logic
- Mouse & touch event handling
- Position & rotation calculations
- Swipe direction detection
- Provides drag state to component

### components/SwipeCard
**Responsibility:** Display & interaction with content
- Renders content based on type
- Integrates swipe logic
- Shows metadata & instructions
- Triggers rating flow

### components/AdminPanel
**Responsibility:** Admin operations
- Tab navigation (content/ratings/stats)
- CRUD operations for content
- Statistics visualization
- Content generation triggering

### components/Modals/*
**Responsibility:** Modal interactions
- **LoginModal:** Authentication UI
- **CommentModal:** Rating comment collection
- **GenerateModal:** Content generation form

## 🔐 Security Architecture

### Authentication Flow
```
1. User submits credentials
   ↓
2. Backend verifies with bcrypt
   ↓
3. Generate JWT token (exp: 24h)
   ↓
4. Frontend stores in localStorage
   ↓
5. Include in Authorization header
   ↓
6. Backend verifies JWT middleware
```

### Protected Routes
```javascript
// Backend middleware
const authMiddleware = (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];
  
  if (!token) return res.status(401).json({ error: 'No token' });
  
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.userId = decoded.userId;
    next();
  } catch (error) {
    res.status(401).json({ error: 'Invalid token' });
  }
};

// Protected endpoints
app.post('/api/generate', authMiddleware, generateContent);
app.delete('/api/content/:id', authMiddleware, deleteContent);
```

## 💾 State Management Strategy

### Local Component State
For UI-specific state (e.g., modal visibility, form inputs):
```javascript
const [showModal, setShowModal] = useState(false);
```

### App-Level State
For shared state across components (via useAppState hook):
```javascript
const { currentContent, isLoading, setCurrentContent } = useAppState();
```

### Server State
For backend data (via api service):
```javascript
const content = await api.getNextContent();
```

## 📊 Performance Considerations

### Current Implementation
- Direct API calls (no caching)
- No code splitting
- Full React bundle (~220KB)
- No virtualization for lists

### Potential Optimizations

**1. Code Splitting:**
```javascript
const AdminPanel = lazy(() => import('./components/AdminPanel'));
```

**2. Memoization:**
```javascript
const MemoizedSwipeCard = React.memo(SwipeCard);
const rating = useMemo(() => calculateRating(data), [data]);
```

**3. API Caching:**
```javascript
// Using React Query
const { data } = useQuery('content', api.getNextContent, {
  staleTime: 5 * 60 * 1000, // 5 minutes
});
```

**4. Virtual Scrolling:**
```javascript
// For large content/ratings lists
import { FixedSizeList } from 'react-window';
```

## 🧪 Testing Strategy

### Unit Tests
- Individual components (SwipeCard, AdminPanel, etc.)
- Hooks (useSwipe, useAppState)
- Services (api.js)

### Integration Tests
- Component interactions
- API integration
- Auth flow

### E2E Tests
- Complete user flows (swipe → rate → admin)
- Generation workflow
- Login/logout

## 🔮 Future Architecture Enhancements

### 1. React Context
Replace useAppState with Context API:
```javascript
<AppProvider>
  <App />
</AppProvider>
```

### 2. React Router
Add proper routing:
```
/ → Swipe view
/admin → Admin panel
/stats → Statistics
/login → Login page
```

### 3. TypeScript
Add type safety:
```typescript
interface Content {
  id: number;
  title: string;
  type: 'image' | 'video' | 'audio' | 'text';
  // ...
}
```

### 4. State Management Library
Consider Redux/Zustand for complex state:
```javascript
const useContentStore = create((set) => ({
  content: [],
  fetchContent: async () => { /* ... */ },
}));
```

## 📐 Design Patterns Used

- **Singleton:** API Service
- **Custom Hooks:** Logic encapsulation
- **Component Composition:** Modal system
- **Render Props:** Conditional rendering
- **Higher-Order Components:** (potential for auth wrapper)

## 🎯 Architecture Goals Achieved

- ✅ Separation of Concerns
- ✅ Reusable Components
- ✅ Maintainable Code Structure
- ✅ Testable Units
- ✅ Scalable Foundation
- ✅ Type-safe API Layer (partially)

---

**Architecture Version:** 1.0  
**Last Updated:** 2025-10-13  
**Complexity Level:** Medium  
**Scalability:** High
