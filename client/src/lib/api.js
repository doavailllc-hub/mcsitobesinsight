import axios from 'axios';
export const api = axios.create({baseURL: import.meta.env.VITE_API_URL || 'http://localhost:5000/api'});
api.interceptors.request.use((config)=>{const t=localStorage.getItem('insight_token'); if(t) config.headers.Authorization=`Bearer ${t}`; return config;});
export const setSession=(token,user)=>{localStorage.setItem('insight_token',token);localStorage.setItem('insight_user',JSON.stringify(user));};
export const clearSession=()=>{localStorage.removeItem('insight_token');localStorage.removeItem('insight_user');};
export const getUser=()=>{try{return JSON.parse(localStorage.getItem('insight_user'))}catch{return null}};
