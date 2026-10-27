/// <reference types="vite/client" />

interface ViteTypeOptions {
  strictImportMetaEnv: unknown;
}

interface ImportMetaEnv {
  readonly VITE_API_BASE?: string;
  readonly VITE_APP_VERSION?: string;
  readonly VITE_USE_STRIPE_EXTENSION?: string;
  readonly VITE_STRIPE_PRICING_TABLE_ID?: string;
  readonly VITE_STRIPE_PUBLISHABLE_KEY?: string;
  readonly VITE_STRIPE_BASIC_URL?: string;
  readonly VITE_STRIPE_ADVANCED_URL?: string;
  readonly VITE_STRIPE_PRO_URL?: string;
  readonly VITE_STRIPE_ADDON_URL?: string;
  readonly VITE_GA_ID?: string;
  readonly VITE_ADS_ID?: string;
  readonly VITE_SENTRY_DSN?: string;
  readonly VITE_FIREBASE_API_KEY: string;
  readonly VITE_FIREBASE_AUTH_DOMAIN: string;
  readonly VITE_FIREBASE_PROJECT_ID: string;
  readonly VITE_FIREBASE_STORAGE_BUCKET?: string;
  readonly VITE_FIREBASE_MESSAGING_SENDER_ID: string;
  readonly VITE_FIREBASE_APP_ID: string;
  readonly VITE_FIREBASE_MEASUREMENT_ID?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
