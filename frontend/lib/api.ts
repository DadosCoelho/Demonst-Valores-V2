// Demonst-Valores V2/frontend/lib/api.ts
import axios from 'axios';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:8000';

const api = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
  withCredentials: true, // Essencial para enviar cookies
});

// --- Funções para interagir com a API do backend ---

interface LoginResponse {
  message: string;
}

interface UserCredentials {
  username: string;
  password: string;
}

// Requisição de Login
export const login = async (credentials: UserCredentials): Promise<LoginResponse> => {
  const formData = new URLSearchParams();
  formData.append('username', credentials.username);
  formData.append('password', credentials.password);

  const response = await api.post<LoginResponse>('/api/token', formData.toString(), {
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
  });
  return response.data;
};

// Requisição de Logout
export const logout = async (): Promise<void> => {
  await api.post('/api/logout');
};

// Requisição para obter a lista de abas
interface GetTabsResponse {
    tabs: string[];
}
export const fetchSheetTabs = async (): Promise<string[]> => {
    const response = await api.get<GetTabsResponse>('/api/sheets/tabs');
    return response.data.tabs;
};

/**
 * Requisição para obter os dados da planilha de uma ABA ESPECÍFICA.
 * Adicionado um parâmetro para forçar a atualização dos dados, ignorando o cache do backend.
 * @param sheetName O nome da aba da planilha a ser buscada.
 * @param forceRefresh Se true, o backend será instruído a ignorar o cache e buscar dados novos do Google Sheets.
 */
export const fetchSheetsData = async (sheetName: string, forceRefresh: boolean = false): Promise<any[]> => {
  const params: { sheet_name: string; force_refresh?: boolean } = { sheet_name: sheetName };
  if (forceRefresh) {
    params.force_refresh = true; // Adiciona o parâmetro de força de atualização
  }

  const response = await api.get<any[]>('/api/sheets/data', {
    params: params // Envia o nome da aba e o force_refresh como parâmetros de query
  });
  // Se o backend retornar { message: "Nenhum dado..." }, converte para array vazio.
  // Isso facilita o tratamento do estado de dados no frontend.
  if (response.data && typeof response.data === 'object' && 'message' in response.data) {
      return [];
  }
  return response.data;
};

// Requisição para obter os dados do usuário autenticado
export const fetchCurrentUser = async (): Promise<any> => {
  const response = await api.get<any>('/api/users/me');
  return response.data;
};

// Interceptor para lidar com respostas de erro (ex: 401 Unauthorized)
api.interceptors.response.use(
  (response) => {
    return response;
  },
  (error) => {
    if (error.response && error.response.status === 401) {
      console.warn('Sessão expirada ou inválida. Redirecionando para login.');
    }
    return Promise.reject(error);
  }
);

export default api;