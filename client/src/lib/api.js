import axios from 'axios';

export const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || 'http://localhost:5000/api'
});

api.interceptors.request.use((config) => {
  const t = localStorage.getItem('insight_token');
  if (t) config.headers.Authorization = `Bearer ${t}`;
  return config;
});

export const setSession = (token, user) => {
  localStorage.setItem('insight_token', token);
  localStorage.setItem('insight_user', JSON.stringify(user));
};

export const clearSession = () => {
  localStorage.removeItem('insight_token');
  localStorage.removeItem('insight_user');
  localStorage.removeItem('insight_permissions');
  localStorage.removeItem('insight_company_access');
};

export const getUser = () => {
  try {
    return JSON.parse(localStorage.getItem('insight_user'));
  } catch {
    return null;
  }
};

export const getPermissions = () => {
  try {
    return JSON.parse(localStorage.getItem('insight_permissions')) || [];
  } catch {
    return [];
  }
};

export const getCompanyAccess = () => {
  try {
    return JSON.parse(localStorage.getItem('insight_company_access')) || {};
  } catch {
    return {};
  }
};

export const hasPermission = (permission) => {
  const user = getUser();
  if (user?.role === 'group_admin') return true;
  return getPermissions().includes(permission);
};

export const refreshAccess = async () => {
  const { data } = await api.get('/auth/me');

  if (data?.user) {
    localStorage.setItem('insight_user', JSON.stringify(data.user));
  }

  localStorage.setItem(
    'insight_permissions',
    JSON.stringify(data?.permissions || [])
  );

  localStorage.setItem(
    'insight_company_access',
    JSON.stringify(data?.company_access || {})
  );

  return data;
};
