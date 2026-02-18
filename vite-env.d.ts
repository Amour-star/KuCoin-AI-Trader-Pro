/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly KUCOIN_API_KEY?: string;
  readonly KUCOIN_API_SECRET?: string;
  readonly KUCOIN_API_PASSPHRASE?: string;
  readonly KUCOIN_SANDBOX?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

