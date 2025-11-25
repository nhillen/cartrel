/**
 * API client for admin dashboard
 * Wraps fetch with authentication and error handling
 */

class ApiError extends Error {
  constructor(
    public status: number,
    message: string
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

class RateLimitError extends ApiError {
  constructor(message = 'Rate limited. Please wait 60s and try again.') {
    super(429, message);
    this.name = 'RateLimitError';
  }
}

class ApiClient {
  private baseUrl: string;

  constructor() {
    this.baseUrl = process.env.NEXT_PUBLIC_API_URL || '';
  }

  /**
   * Get authentication token from NextAuth session
   */
  private async getToken(): Promise<string | null> {
    try {
      const res = await fetch('/api/auth/token');
      if (res.ok) {
        const { token } = await res.json();
        return token;
      }
    } catch (error) {
      console.error('Error getting session token:', error);
    }
    return null;
  }

  /**
   * Make an authenticated request
   */
  private async request<T>(path: string, options: RequestInit = {}): Promise<T> {
    const token = await this.getToken();
    if (!token) {
      throw new ApiError(401, 'Authentication required');
    }

    const url = `${this.baseUrl}${path}`;
    const res = await fetch(url, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        ...options.headers,
      },
    });

    if (res.status === 429) {
      throw new RateLimitError();
    }

    if (!res.ok) {
      const text = await res.text();
      throw new ApiError(res.status, text || `Request failed: ${res.statusText}`);
    }

    return res.json();
  }

  /**
   * GET request
   */
  async get<T>(path: string, params?: Record<string, unknown>): Promise<T> {
    let url = path;
    if (params) {
      const searchParams = new URLSearchParams();
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined && value !== null) {
          searchParams.set(key, String(value));
        }
      });
      const queryString = searchParams.toString();
      if (queryString) {
        url = `${path}?${queryString}`;
      }
    }
    return this.request<T>(url);
  }

  /**
   * POST request
   */
  async post<T>(path: string, body?: unknown): Promise<T> {
    return this.request<T>(path, {
      method: 'POST',
      body: body ? JSON.stringify(body) : undefined,
    });
  }

  /**
   * PATCH request
   */
  async patch<T>(path: string, body: unknown): Promise<T> {
    return this.request<T>(path, {
      method: 'PATCH',
      body: JSON.stringify(body),
    });
  }

  /**
   * DELETE request
   */
  async delete<T>(path: string): Promise<T> {
    return this.request<T>(path, {
      method: 'DELETE',
    });
  }
}

// Export singleton instance
export const api = new ApiClient();

// Export error classes for type checking
export { ApiError, RateLimitError };
