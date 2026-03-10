import axios from 'axios';

const api = axios.create({
  baseURL: 'http://localhost:8000',
});

export const chatWithRAG = async (message: string, history: any[]) => {
  const response = await api.post('/chat/', { message, history });
  return response.data;
};

export const getTheorems = async () => {
  const response = await api.get('/theorems/');
  return response.data;
};

export const getAgentEvents = async () => {
  const response = await api.get('/agents/events');
  return response.data;
};

export default api;
