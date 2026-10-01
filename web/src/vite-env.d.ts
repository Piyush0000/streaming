/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_AUTH_BASE_URL?: string;
  readonly VITE_API_BASE_URL?: string;
  readonly VITE_CHAT_WS_URL?: string;
  readonly VITE_CHAT_WS_PATH?: string;
  readonly VITE_MEDIA_WS_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
