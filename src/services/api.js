// API Service - взаємодія з Express backend (через proxy CRA)
const API_BASE = '/api';

class ApiService {
  constructor() {
    this.token = localStorage.getItem('token');
    // session id для анонімних оцінок
    const stored = localStorage.getItem('session_id');
    if (stored) {
      this.sessionId = stored;
    } else {
      this.sessionId = 'sess-' + Math.random().toString(36).slice(2) + '-' + Date.now();
      localStorage.setItem('session_id', this.sessionId);
    }
  }

  setToken(token) {
    this.token = token;
    if (token) {
      localStorage.setItem('token', token);
    } else {
      localStorage.removeItem('token');
    }
  }

  getHeaders() {
    const headers = {
      'Content-Type': 'application/json',
    };
    if (this.token) {
      headers['Authorization'] = `Bearer ${this.token}`;
    }
    return headers;
  }

  async request(endpoint, options = {}) {
    const url = `${API_BASE}${endpoint}`;
    const config = {
      credentials: 'omit',
      ...options,
      headers: { ...this.getHeaders(), ...(options.headers || {}) },
    };

    try {
      const response = await fetch(url, config);
      const contentType = response.headers.get('content-type') || '';
      let data;
      if (contentType.includes('application/json')) {
        data = await response.json();
      } else {
        const text = await response.text();
        // Handle CRA proxy errors or HTML/text responses
        const prefix = text.slice(0, 200).replace(/\s+/g, ' ').trim();
        if (!response.ok) {
          const err = new Error(prefix || `HTTP ${response.status}`);
          err.status = response.status;
          throw err;
        }
        // Non-JSON but OK; return as text payload
        data = { ok: true, text };
      }

      if (!response.ok) {
        const message = (data && (data.error || data.message)) || `HTTP ${response.status}`;
        const err = new Error(message);
        err.status = response.status;
        throw err;
      }

      return data;
    } catch (error) {
      console.error('API Error:', error);
      throw error;
    }
  }

  // Auth endpoints
  async login(username, password) {
    const data = await this.request('/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    });
    this.setToken(data.token);
    return data;
  }

  logout() {
    this.setToken(null);
  }

  // Content endpoints
  async getNextContent() {
    const q = `?types=image,text,audio,video,combo&order=asc&session_id=${encodeURIComponent(this.sessionId)}`;
    return this.request(`/next-content${q}`);
  }

  async getAllContent(page = 1, limit = 20) {
    const res = await this.request(`/admin/data?page=${page}&limit=${limit}`);
    return { items: res.data || [], total: res.total || 0, page: res.page || page, limit: res.limit || limit };
  }

  async createContent(contentData) {
    return this.request('/content', {
      method: 'POST',
      body: JSON.stringify(contentData),
    });
  }

  async updateContent(id, contentData) {
    return this.request(`/content/${id}`, {
      method: 'PUT',
      body: JSON.stringify(contentData),
    });
  }

  async deleteContent(id) {
    return this.request(`/admin/data/${id}`, { method: 'DELETE' });
  }

  // Rating endpoints
  async submitRating(contentId, rating, comment = '') {
    // rating уже у форматі -2,-1,1,2 → backend очікує direction
    return this.request('/rate', {
      method: 'POST',
      body: JSON.stringify({
        content_id: contentId,
        direction: rating,
        comment,
        session_id: this.sessionId,
      }),
    });
  }

  async getRatings() { return []; }

  // Generation endpoint
  async generateContent(prompt, model = 'black-forest-labs/flux-schnell', params = {}) {
    const count = params.count || 10;
    return this.request('/generate', {
      method: 'POST',
      body: JSON.stringify({ 
        prompt, 
        count, 
        model, 
        type: params.type || 'image', 
        duration_seconds: params.seconds, 
        replicate_token: params.replicateToken || '',
        agent_id: params.agent_id || null,
        use_agent: params.use_agent !== false, // default true
      }),
    });
  }

  async getGenerationStatus(jobId) {
    return this.request(`/generate/${encodeURIComponent(jobId)}`);
  }

  // OpenRouter text generation
  async generateOpenRouter(prompt, count = 1, model = 'openai/gpt-4o-mini') {
    return this.request('/generate/openrouter', {
      method: 'POST',
      body: JSON.stringify({ prompt, count, model }),
    });
  }

  // Universal generator (text/image/video/audio/combo)
  async generateUniversal(prompt, type = 'text', count = 1, durationSeconds) {
    return this.request('/generate/universal', {
      method: 'POST',
      body: JSON.stringify({ prompt, type, count, durationSeconds }),
    });
  }

  // Stats endpoint
  async getStats() {
    const raw = await this.request('/stats');
    return {
      total: raw?.totalContent ?? 0,
      rated: raw?.ratedDistinct ?? 0,
      pending: raw?.pendingGlobal ?? 0,
      totalRatings: raw?.totalRatings ?? 0,
      top: raw?.top || [],
      worst: raw?.worst || [],
    };
  }

  async getSummary() {
    const q = `?session_id=${encodeURIComponent(this.sessionId)}`;
    return this.request(`/stats/summary${q}`);
  }

  // Swipe data endpoint
  async getSwipeData() { return []; }
}

export default new ApiService();
