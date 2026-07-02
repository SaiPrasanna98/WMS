import axios, { AxiosError, InternalAxiosRequestConfig } from 'axios';

/** Local dev uses Vite proxy (/api). Production sets VITE_API_URL on Vercel. */
function getApiBaseUrl(): string {
  const configured = import.meta.env.VITE_API_URL?.trim();
  if (!configured) return '/api';
  const base = configured.replace(/\/$/, '');
  return base.endsWith('/api') ? base : `${base}/api`;
}

const RETRYABLE_STATUSES = [502, 503, 504];
const MAX_RETRIES = 4;
const RETRY_DELAY_MS = 2500;
const REQUEST_TIMEOUT_MS = 60000;

type RetryConfig = InternalAxiosRequestConfig & { __retryCount?: number };

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function isRetriableError(error: AxiosError): boolean {
  if (!error.response) return true;
  return RETRYABLE_STATUSES.includes(error.response.status);
}

const api = axios.create({
  baseURL: getApiBaseUrl(),
  headers: { 'Content-Type': 'application/json' },
  timeout: REQUEST_TIMEOUT_MS,
});

/** Wake the backend on Render free tier while the user opens the login page. */
export function warmupBackend(): void {
  const configured = import.meta.env.VITE_API_URL?.trim();
  if (!configured) return;
  const base = configured.replace(/\/$/, '');
  void fetch(`${base}/api/health`, { mode: 'cors' }).catch(() => {});
}

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

api.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const config = error.config as RetryConfig | undefined;
    if (!config) return Promise.reject(error);

    if (error.response?.status === 401 && !config.url?.includes('/auth/login')) {
      localStorage.removeItem('token');
      localStorage.removeItem('user');
      window.location.href = '/login';
      return Promise.reject(error);
    }

    const retryCount = config.__retryCount ?? 0;
    if (isRetriableError(error) && retryCount < MAX_RETRIES) {
      config.__retryCount = retryCount + 1;
      await sleep(RETRY_DELAY_MS * config.__retryCount);
      return api(config);
    }

    return Promise.reject(error);
  }
);

export default api;

export function getErrorMessage(error: unknown): string {
  if (axios.isAxiosError(error)) {
    if (error.code === 'ECONNABORTED') {
      return 'The server is taking longer than expected. Please try again.';
    }
    if (!error.response) {
      return 'Unable to reach the server. It may still be starting — please try again.';
    }
    const data = error.response.data as { error?: string } | undefined;
    return data?.error || error.message;
  }
  return 'An unexpected error occurred';
}
