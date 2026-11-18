module.exports = {
  APP_VERSION: '3.0.0',
  PHASE: 3,
  PIN_LENGTH: 4,
  // Lockout: 3 wrong PINs are tolerated, the 4th wrong PIN locks for 5 min; each later group adds 5 more.
  MAX_FREE_FAILURES: 3,
  LOCK_STEP_MINUTES: 5,
  MAX_LOCK_MINUTES: 24 * 60,
  FAILURE_MEMORY_HOURS: 24,
  TOKEN_REFRESH_SECONDS: 30,
  MAX_SESSION_HOURS: 24,
  ACCOUNT_TYPES: ['bank', 'mobile_wallet', 'cash', 'savings', 'other'],
  TX_TYPES: ['income', 'expense', 'transfer'],
  CURRENCIES: ['PKR', 'USD', 'EUR', 'GBP', 'AED', 'SAR', 'INR'],
  AUTO_LOCK_OPTIONS: [1, 5, 15, 30, 60],
  THEMES: ['dark', 'light'],
  APP_VERSION_NOTE: 'phase-2',
  CODING_INCOME: { client_payment: 'Client payment', project_income: 'Project income', retainer: 'Retainer / maintenance', other_income: 'Other income' },
  CODING_EXPENSE: { hosting: 'Hosting', domain: 'Domain', marketing: 'Marketing', advertising: 'Advertising', tools: 'Tools & subscriptions', other_expense: 'Other' },
  // ledger category each module record posts to (created on demand)
  CODING_LEDGER: { client_payment: 'Coding', project_income: 'Coding', retainer: 'Coding', other_income: 'Coding', hosting: 'Hosting', domain: 'Domain', marketing: 'Marketing', advertising: 'Advertising', tools: 'Tools & Subscriptions', other_expense: 'Other' },
  DARAZ_EXPENSE: { flyer_bags: 'Flyer bags', packaging: 'Packaging', shipping: 'Shipping', other: 'Other' },
  DARAZ_LEDGER: { flyer_bags: 'Flyer Bags', packaging: 'Packaging', shipping: 'Shipping', other: 'Daraz Expenses', inventory: 'Inventory', sales: 'Daraz' },
  BUSINESS_CATEGORIES: {
    Hosting: ['expense', 'server', '#22D3EE'], Domain: ['expense', 'globe', '#60A5FA'], 'Tools & Subscriptions': ['expense', 'briefcase', '#A78BFA'],
    Advertising: ['expense', 'megaphone', '#F472B6'], Inventory: ['expense', 'boxes', '#F59E0B'], 'Flyer Bags': ['expense', 'shopping-bag', '#FB7185'],
    Packaging: ['expense', 'package', '#94A3B8'], Shipping: ['expense', 'truck', '#60A5FA'], 'Daraz Expenses': ['expense', 'store', '#94A3B8'],
    Investments: ['expense', 'trending-up', '#A78BFA'], 'Trading proceeds': ['income', 'bitcoin', '#A78BFA'],
    Coding: ['income', 'code', '#34D399'], Daraz: ['income', 'package', '#F59E0B'], Marketing: ['expense', 'megaphone', '#A78BFA'], Other: ['expense', 'circle-ellipsis', '#94A3B8'],
  },
  MODULES: ['coding', 'daraz', 'trading'],
  ASSET_TYPES: ['crypto', 'stock', 'other'],
  DEFAULT_CATEGORIES: {
    expense: [
      ['Food', 'utensils', '#F59E0B'], ['Transport', 'car', '#60A5FA'], ['Shopping', 'shopping-bag', '#F472B6'],
      ['Internet', 'wifi', '#22D3EE'], ['Bills', 'receipt', '#FB7185'], ['Marketing', 'megaphone', '#A78BFA'],
      ['Personal', 'user', '#34D399'], ['Other', 'circle-ellipsis', '#94A3B8'],
    ],
    income: [
      ['Coding', 'code', '#34D399'], ['Daraz', 'package', '#F59E0B'], ['Personal', 'user', '#60A5FA'],
      ['Investment', 'trending-up', '#A78BFA'], ['Gift', 'gift', '#F472B6'], ['Other', 'circle-ellipsis', '#94A3B8'],
    ],
  },
};
