/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** URL de base de l'API, avec le préfixe `/api/v1`. */
  readonly VITE_API_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
