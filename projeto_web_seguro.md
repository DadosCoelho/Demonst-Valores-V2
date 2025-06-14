# Projeto Web Seguro com Next.js, FastAPI e Google Sheets

## 🎯 Objetivo

Criar uma aplicação web com:

- Frontend autenticado (Next.js)
- Backend seguro (FastAPI - Python)
- Acesso privado a planilhas do Google
- Armazenamento seguro em banco de dados (PostgreSQL)
- Comunicação segura entre frontend e backend

---

## 🧱 Arquitetura

```
Next.js (frontend)
    ⇅ (HTTPS + JWT via Cookie)
FastAPI (backend)
    ⇅
Google Sheets API + PostgreSQL
```

---

## 📦 Tecnologias

### Frontend
- Next.js (React + SSR)
- TypeScript
- Tailwind CSS
- Auth via JWT (armazenado em cookie HTTP-only)
- Axios (para chamadas autenticadas)

### Backend
- FastAPI (Python 3.10+)
- google-api-python-client (Sheets API)
- PostgreSQL (via SQLAlchemy ou asyncpg)
- JWT Auth
- python-dotenv
- CORS configurado
- Rate limiting (ex: slowapi)

### Google API
- Conta de serviço com acesso privado às planilhas
- Permissões mínimas necessárias
- Armazenamento seguro da chave (sem subir ao Git)

---

## 🔐 Segurança

- JWT via cookie HTTP-only + Secure + SameSite=strict
- Nenhuma informação sensível no frontend
- Backend valida token em todas as rotas
- Sanitização e validação de entradas com Pydantic
- CORS estrito (origens permitidas específicas)
- Rate limiting
- Logs sem dados sensíveis
- Monitoramento de falhas e alertas

---

## 🗄️ Banco de Dados

- PostgreSQL
  - Criptografia TLS
  - Backup automático
  - Roles com permissões mínimas
- Tabelas: `users`, `sheets_cache`, `logs`

---

## 📑 Google Sheets

- API: `google-api-python-client`
- Autenticação: Conta de serviço
- Permissões: Leitura ou edição apenas para planilhas específicas
- Atualizações cacheadas no banco para performance

---

## 🧪 Testes

- Backend: Pytest
- Frontend: Jest + React Testing Library
- Testes de integração para rotas críticas
- Testes de segurança (CORS, Auth, etc.)

---

## 🚀 Deploy

### Frontend
- Vercel (HTTPS por padrão)
- Variáveis de ambiente seguras

### Backend
- Railway / Fly.io / Render
- Configuração de secrets e banco seguro

### Banco
- Supabase / Railway / Neon
- TLS obrigatório
- IP Whitelist

---

## 📁 Estrutura de Pastas

### Frontend (Next.js)
```
/pages
/components
/lib
/hooks
/public
```

### Backend (FastAPI)
```
/app
    /routes
    /services
    /schemas
    /models
    /core
/tests
```

---

## 📌 Requisitos

### Obrigatórios
- Conta Google Cloud com projeto habilitado
- Service Account com acesso à planilha
- PostgreSQL (banco inicial)
- Chave da conta de serviço (.json) segura
- Domínio com HTTPS (SSL)

### Recomendados
- Monitoramento (Sentry, UptimeRobot)
- CI/CD básico com GitHub Actions
- Backup automático do banco

---

## ✅ Checklist Inicial

- [ ] Criar projeto Google Cloud
- [ ] Criar conta de serviço e dar acesso à planilha
- [ ] Criar projeto Next.js com rota de login
- [ ] Criar backend FastAPI com login e rota protegida
- [ ] Configurar cookie HTTP-only no login
- [ ] Criar conexão segura com PostgreSQL
- [ ] Testar autenticação frontend <-> backend
- [ ] Testar acesso à planilha
- [ ] Implementar cache no banco

---

## 📎 Referências

- https://fastapi.tiangolo.com
- https://nextjs.org
- https://developers.google.com/sheets/api
- https://www.postgresql.org
- https://jwt.io

---

## 🛠️ Licença

Este projeto é open-source e pode ser adaptado livremente.
