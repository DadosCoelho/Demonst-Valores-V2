# app/main.py
import os
import json
import re # <-- NOVA IMPORTAÇÃO: Módulo para Expressões Regulares
from datetime import datetime, timedelta, timezone
from typing import Annotated
from fastapi import FastAPI, HTTPException, status, Depends, Response, Request, Query

from fastapi.security import OAuth2PasswordBearer, OAuth2PasswordRequestForm
from dotenv import load_dotenv
import pandas as pd
from google.oauth2 import service_account
from googleapiclient.discovery import build

from fastapi.middleware.cors import CORSMiddleware

from pydantic import BaseModel
from passlib.context import CryptContext
from jose import JWTError, jwt

# --- Imports para SQLAlchemy ---
from sqlalchemy import create_engine, Column, Integer, String, Boolean, DateTime, Text
from sqlalchemy.orm import sessionmaker, declarative_base

# Carrega as variáveis de ambiente do .env
load_dotenv()

# --- Configurações da Google Sheets API ---
SERVICE_ACCOUNT_FILE = os.getenv('GOOGLE_SERVICE_ACCOUNT_KEY_FILE')
SPREADSHEET_ID = os.getenv('GOOGLE_SPREADSHEET_ID')
DEFAULT_DATA_RANGE_IN_SHEET = os.getenv('GOOGLE_SPREADSHEET_DEFAULT_DATA_RANGE')

if not SERVICE_ACCOUNT_FILE or not SPREADSHEET_ID or not DEFAULT_DATA_RANGE_IN_SHEET:
    raise ValueError(
        "As variáveis de ambiente GOOGLE_SERVICE_ACCOUNT_KEY_FILE, "
        "GOOGLE_SPREADSHEET_ID e GOOGLE_SPREADSHEET_DEFAULT_DATA_RANGE devem ser definidas no arquivo .env"
    )

SCOPES = ['https://www.googleapis.com/auth/spreadsheets.readonly']

def get_sheets_service():
    """
    Autentica com a Google Sheets API usando a conta de serviço
    e retorna o objeto de serviço da API.
    """
    try:
        creds = service_account.Credentials.from_service_account_file(
            SERVICE_ACCOUNT_FILE, scopes=SCOPES
        )
        service = build('sheets', 'v4', credentials=creds)
        return service
    except Exception as e:
        print(f"Erro ao autenticar com a Google Sheets API: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Erro de autenticação com a Google Sheets API. Verifique sua chave e permissões."
        )

# --- Configuração do Banco de Dados ---
DATABASE_URL = os.getenv("DATABASE_URL")
if not DATABASE_URL:
    raise ValueError("A variável de ambiente DATABASE_URL deve ser definida no arquivo .env para conexão com o banco de dados.")

engine = create_engine(DATABASE_URL)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()

# --- Modelo de Usuário para SQLAlchemy ---
class DBUser(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    username = Column(String, unique=True, index=True)
    email = Column(String, unique=True, index=True, nullable=True)
    full_name = Column(String, nullable=True)
    hashed_password = Column(String)
    disabled = Column(Boolean, default=False)

# --- Modelo de Cache para SQLAlchemy ---
class SheetCache(Base):
    __tablename__ = "sheets_cache"

    id = Column(Integer, primary_key=True, index=True)
    sheet_name = Column(String, unique=True, index=True)
    cached_at = Column(DateTime(timezone=True), default=datetime.now(timezone.utc))
    data_json = Column(Text)

# Cria as tabelas no banco de dados (se ainda não existirem)
Base.metadata.create_all(bind=engine)

# Dependência para obter a sessão do banco de dados
def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

# --- Instância do Aplicativo FastAPI ---
app = FastAPI(
    title="Backend de Visão Financeira",
    description="API para acessar e processar dados de planilhas do Google, gerenciar usuários no PostgreSQL e JWT em cookies.",
    version="1.0.0"
)

# --- Configuração CORS ---
origins = [
    "http://localhost",
    "http://localhost:3000",
    "http://127.0.0.1",
    "http://127.0.0.1:3000",
    # Em produção, adicione o domínio do seu frontend:
    # "https://seufrontend.com",
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# --- Autenticação e JWT ---
pwd_context = CryptContext(schemes=["pbkdf2_sha256"], deprecated="auto")

class User(BaseModel):
    username: str
    email: str | None = None
    full_name: str | None = None
    disabled: bool | None = None

class UserInDB(User):
    hashed_password: str

class TokenData(BaseModel):
    username: str | None = None

SECRET_KEY = os.getenv("SECRET_KEY")
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 30

if not SECRET_KEY:
    raise ValueError("A variável de ambiente SECRET_KEY deve ser definida no arquivo .env para JWT.")

JWT_COOKIE_NAME = "finance_access_token"
CACHE_TTL_MINUTES = 10

def verify_password(plain_password: str, hashed_password: str):
    return pwd_context.verify(plain_password, hashed_password)

def get_password_hash(password: str):
    return pwd_context.hash(password)

def get_user_from_db(db: SessionLocal, username: str):
    return db.query(DBUser).filter(DBUser.username == username).first()

def authenticate_user(db: SessionLocal, username: str, password: str):
    user = get_user_from_db(db, username)
    if not user:
        return False
    if not verify_password(password, user.hashed_password):
        return False
    return user

def create_access_token(data: dict, expires_delta: timedelta | None = None):
    to_encode = data.copy()
    if expires_delta:
        expire = datetime.now(timezone.utc) + expires_delta
    else:
        expire = datetime.now(timezone.utc) + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    to_encode.update({"exp": expire})
    encoded_jwt = jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)
    return encoded_jwt

async def get_current_user(request: Request, db: Annotated[SessionLocal, Depends(get_db)]):
    token = request.cookies.get(JWT_COOKIE_NAME)

    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Não foi possível validar as credenciais",
        headers={"WWW-Authenticate": "Bearer"},
    )
    if not token:
        raise credentials_exception
        
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        username: str = payload.get("sub")
        if username is None:
            raise credentials_exception
        token_data = TokenData(username=username)
    except JWTError:
        raise credentials_exception
    
    user = get_user_from_db(db, token_data.username)
    if user is None:
        raise credentials_exception
    
    return User(username=user.username, email=user.email, full_name=user.full_name, disabled=user.disabled)

async def get_current_active_user(current_user: Annotated[User, Depends(get_current_user)]):
    if current_user.disabled:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Usuário inativo")
    return current_user

# --- Endpoints de Autenticação ---
@app.post("/api/token")
async def login_for_access_token(
    response: Response,
    form_data: Annotated[OAuth2PasswordRequestForm, Depends()],
    db: Annotated[SessionLocal, Depends(get_db)]
):
    user = authenticate_user(db, form_data.username, form_data.password)
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Nome de usuário ou senha incorretos",
            headers={"WWW-Authenticate": "Bearer"},
        )
    access_token_expires = timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    access_token = create_access_token(
        data={"sub": user.username}, expires_delta=access_token_expires
    )
    
    response.set_cookie(
        key=JWT_COOKIE_NAME,
        value=access_token,
        httponly=True,
        samesite="Lax",
        secure=False,
        max_age=access_token_expires.total_seconds(),
    )
    return {"message": "Login bem-sucedido"}

@app.post("/api/logout")
async def logout(response: Response):
    response.delete_cookie(key=JWT_COOKIE_NAME)
    return {"message": "Logout bem-sucedido"}

@app.get("/api/users/me", response_model=User)
async def read_users_me(current_user: Annotated[User, Depends(get_current_active_user)]):
    """
    Retorna os dados do usuário atualmente autenticado. Requer um JWT válido no cookie.
    """
    return current_user

@app.get("/api/sheets/tabs")
async def get_sheet_tabs(current_user: Annotated[User, Depends(get_current_active_user)]):
    """
    Retorna uma lista com os nomes de todas as abas (sheets) da planilha Google.
    Requer um JWT válido no cookie.
    """
    service = get_sheets_service()
    try:
        spreadsheet_metadata = service.spreadsheets().get(
            spreadsheetId=SPREADSHEET_ID,
            fields='sheets.properties.title'
        ).execute()
        
        sheet_titles = [sheet['properties']['title'] for sheet in spreadsheet_metadata.get('sheets', [])]
        return {"tabs": sheet_titles}
    except Exception as e:
        print(f"Erro ao listar abas da planilha: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Erro ao listar abas da planilha: {e}. Verifique o ID da planilha e permissões."
        )

# --- Endpoint de Leitura da Planilha com Cache e Transformação de Dados ---
@app.get("/api/sheets/data")
async def read_sheets_data(
    sheet_name: Annotated[str, Query(description="Nome da aba/sheet a ser lida na planilha.")],
    current_user: Annotated[User, Depends(get_current_active_user)],
    db: Annotated[SessionLocal, Depends(get_db)]
):
    # 1. Tenta buscar do cache
    cached_data = db.query(SheetCache).filter(SheetCache.sheet_name == sheet_name).first()
    
    now_utc = datetime.now(timezone.utc)
    
    if cached_data and (now_utc - cached_data.cached_at) < timedelta(minutes=CACHE_TTL_MINUTES):
        print(f"[CACHE HIT] Retornando dados para '{sheet_name}' do cache.")
        return json.loads(cached_data.data_json)
    
    # 2. Se não houver cache ou estiver expirado, busca da API do Google Sheets
    print(f"[CACHE MISS/EXPIRED] Buscando dados para '{sheet_name}' da Google Sheets API.")
    service = get_sheets_service()
    try:
        full_range = f"{sheet_name}!{DEFAULT_DATA_RANGE_IN_SHEET}"
        
        result = service.spreadsheets().values().get(
            spreadsheetId=SPREADSHEET_ID,
            range=full_range
        ).execute()
        
        values = result.get('values', [])

        if not values or len(values) < 2: # Precisa de cabeçalhos e pelo menos uma linha de dados
            if cached_data:
                db.delete(cached_data)
                db.commit()
            return {"message": "Nenhum dado encontrado na aba ou intervalo especificado."}
        
        # --- Lógica de Transformação de Dados (portada do seu script Python) ---
        headers = values[0]
        data_rows = values[1:]

        # Cria um DataFrame a partir dos dados brutos
        df_raw = pd.DataFrame(data_rows, columns=headers)
        
        # Assume que a primeira coluna é o nome do indicador e a define como índice
        first_col_header = df_raw.columns[0]
        df_raw = df_raw.set_index(first_col_header)

        col_base_name = 'BasePercentual' # <-- VERIFIQUE SE ESTE É O NOME REAL NA SUA PLANILHA!

        # Identifica colunas que são anos, extraindo o número inteiro do ano
        years_info = [] # Lista de tuplas: (inteiro_ano, nome_original_coluna)
        # Regex para identificar 'YYYY TOTAL' ou apenas 'YYYY' (se a planilha mudar)
        year_pattern = re.compile(r'(\d{4})\s*TOTAL') 

        for col in df_raw.columns:
            if col == col_base_name:
                continue

            match = year_pattern.match(str(col))
            if match:
                try:
                    year_val = int(match.group(1)) # Extrai o ano (grupo 1 da regex)
                    years_info.append((year_val, col))
                except ValueError:
                    pass
            else: # Tenta também se for apenas o ano sem 'TOTAL'
                try:
                    year_val = int(str(col))
                    if len(str(year_val)) == 4: # Garante que é um número de 4 dígitos (como um ano)
                        years_info.append((year_val, col))
                except ValueError:
                    pass

        # Ordena os anos cronologicamente
        years_info.sort(key=lambda x: x[0])

        if not years_info: # Se nenhuma coluna de ano válida for identificada
             print(f"Aviso: Nenhuma coluna de ano válida encontrada na aba '{sheet_name}'. Os dados transformados estarão vazios.")
             data_to_cache = []
        else:
            bases = None
            if col_base_name in df_raw.columns:
                bases = df_raw[col_base_name]
            else:
                print(f"Aviso: A coluna '{col_base_name}' NÃO foi encontrada na aba '{sheet_name}'. Os percentuais não serão calculados.")

            transformed_data = []

            for year_int, original_col_name in years_info: # Itera usando o ano inteiro e o nome original da coluna
                registro = {'ano': year_int} # O frontend espera 'ano' como número inteiro
                
                percentuais = {}
                
                for campo_indicador, valor in df_raw[original_col_name].items():
                    registro[campo_indicador] = valor
                    
                    if bases is not None:
                        base_ref = bases.get(campo_indicador)
                        if pd.notnull(base_ref) and str(base_ref).strip() != '':
                            base_ref_str = str(base_ref).strip()
                            if base_ref_str.lower() == 'base':
                                continue

                            if base_ref_str in df_raw.index:
                                valor_base = df_raw.at[base_ref_str, original_col_name]
                                
                                try:
                                    valor_numeric = float(valor) if pd.notnull(valor) else 0.0
                                    valor_base_numeric = float(valor_base) if pd.notnull(valor_base) else 0.0
                                except (ValueError, TypeError):
                                    valor_numeric = 0.0
                                    valor_base_numeric = 0.0

                                if valor_base_numeric != 0:
                                    percentuais[campo_indicador] = round(100 * valor_numeric / valor_base_numeric, 2)
                                else:
                                    percentuais[campo_indicador] = 0.0
                                    
                registro['percentuais'] = percentuais
                transformed_data.append(registro)
            
            data_to_cache = transformed_data
        
        # 3. Atualiza o cache no banco de dados
        current_data_json = json.dumps(data_to_cache, ensure_ascii=False)

        if cached_data:
            cached_data.data_json = current_data_json
            cached_data.cached_at = now_utc
        else:
            new_cache_entry = SheetCache(
                sheet_name=sheet_name,
                data_json=current_data_json,
                cached_at=now_utc
            )
            db.add(new_cache_entry)
        
        db.commit()
        db.refresh(cached_data or new_cache_entry)
        
        return data_to_cache

    except Exception as e:
        print(f"Erro ao ler dados da planilha da aba '{sheet_name}': {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Erro ao ler dados da planilha da aba '{sheet_name}': {e}. Verifique o ID da planilha, nome da aba e o intervalo. Também certifique-se de que a coluna '{col_base_name}' existe se você espera percentuais."
        )

# Instruções para rodar o servidor Uvicorn:
# No terminal, na pasta raiz do seu projeto (meu_projeto_financeiro), execute:
# uvicorn main:app --reload --app-dir app --host localhost