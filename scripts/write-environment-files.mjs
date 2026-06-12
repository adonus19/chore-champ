import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const rootDir = process.cwd();
const productionEnvironmentPath = resolve(rootDir, 'src/environments/environment.ts');
const developmentEnvironmentPath = resolve(rootDir, 'src/environments/environment.development.ts');
const localEnvPath = resolve(rootDir, '.env');

loadLocalEnvFile(localEnvPath);

const requiredVariables = [
  'FIREBASE_API_KEY',
  'FIREBASE_AUTH_DOMAIN',
  'FIREBASE_PROJECT_ID',
  'FIREBASE_APP_ID',
  'FIREBASE_MESSAGING_SENDER_ID',
  'FIREBASE_STORAGE_BUCKET',
];

const missingVariables = requiredVariables.filter((name) => !process.env[name]?.trim());

if (missingVariables.length > 0) {
  console.error('Missing Firebase environment variables:');

  for (const name of missingVariables) {
    console.error(`- ${name}`);
  }

  process.exit(1);
}

const sharedFirebaseConfig = {
  apiKey: requiredValue('FIREBASE_API_KEY'),
  authDomain: requiredValue('FIREBASE_AUTH_DOMAIN'),
  projectId: requiredValue('FIREBASE_PROJECT_ID'),
  appId: requiredValue('FIREBASE_APP_ID'),
  messagingSenderId: requiredValue('FIREBASE_MESSAGING_SENDER_ID'),
  storageBucket: requiredValue('FIREBASE_STORAGE_BUCKET'),
  authAccountCollection: 'authAccounts',
  peopleCollection: 'people',
  childProfileCollection: 'childProfiles',
  childLinkCollection: 'childLinks',
  usernameIndexCollection: 'usernameIndex',
  legacyUserProfileCollection: 'userProfiles',
};

const productionEnvironment = createEnvironmentFile({
  production: true,
  ...sharedFirebaseConfig,
  useAuthEmulator: false,
  authEmulatorUrl: 'http://127.0.0.1:9099',
  useFirestoreEmulator: false,
  firestoreEmulatorHost: '127.0.0.1',
  firestoreEmulatorPort: 8080,
});

const developmentEnvironment = createEnvironmentFile({
  production: false,
  ...sharedFirebaseConfig,
  useAuthEmulator: booleanValue('FIREBASE_USE_AUTH_EMULATOR', false),
  authEmulatorUrl: stringValue('FIREBASE_AUTH_EMULATOR_URL', 'http://127.0.0.1:9099'),
  useFirestoreEmulator: booleanValue('FIREBASE_USE_FIRESTORE_EMULATOR', false),
  firestoreEmulatorHost: stringValue('FIREBASE_FIRESTORE_EMULATOR_HOST', '127.0.0.1'),
  firestoreEmulatorPort: numberValue('FIREBASE_FIRESTORE_EMULATOR_PORT', 8080),
});

writeEnvironmentFile(productionEnvironmentPath, productionEnvironment);
writeEnvironmentFile(developmentEnvironmentPath, developmentEnvironment);

console.log('Wrote Angular environment files:');
console.log(`- ${productionEnvironmentPath}`);
console.log(`- ${developmentEnvironmentPath}`);

function requiredValue(name) {
  return process.env[name].trim();
}

function stringValue(name, fallback) {
  return process.env[name]?.trim() || fallback;
}

function booleanValue(name, fallback) {
  const rawValue = process.env[name]?.trim().toLowerCase();

  if (!rawValue) {
    return fallback;
  }

  return rawValue === 'true';
}

function numberValue(name, fallback) {
  const rawValue = process.env[name]?.trim();

  if (!rawValue) {
    return fallback;
  }

  const parsed = Number(rawValue);

  return Number.isFinite(parsed) ? parsed : fallback;
}

function writeEnvironmentFile(filePath, contents) {
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, contents, 'utf8');
}

function loadLocalEnvFile(filePath) {
  if (!existsSync(filePath)) {
    return;
  }

  const lines = readFileSync(filePath, 'utf8').split(/\r?\n/u);

  for (const line of lines) {
    const trimmedLine = line.trim();

    if (!trimmedLine || trimmedLine.startsWith('#')) {
      continue;
    }

    const separatorIndex = trimmedLine.indexOf('=');

    if (separatorIndex <= 0) {
      continue;
    }

    const name = trimmedLine.slice(0, separatorIndex).trim();
    const rawValue = trimmedLine.slice(separatorIndex + 1).trim();

    if (!name || process.env[name]) {
      continue;
    }

    process.env[name] = unwrapQuotedValue(rawValue);
  }
}

function unwrapQuotedValue(value) {
  if (
    (value.startsWith('"') && value.endsWith('"'))
    || (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }

  return value;
}

function createEnvironmentFile(config) {
  return `import { AppEnvironment } from './environment.model';

export const environment: AppEnvironment = {
  production: ${config.production},
  firebase: {
    apiKey: ${quote(config.apiKey)},
    authDomain: ${quote(config.authDomain)},
    projectId: ${quote(config.projectId)},
    appId: ${quote(config.appId)},
    messagingSenderId: ${quote(config.messagingSenderId)},
    storageBucket: ${quote(config.storageBucket)},
    useAuthEmulator: ${config.useAuthEmulator},
    authEmulatorUrl: ${quote(config.authEmulatorUrl)},
    useFirestoreEmulator: ${config.useFirestoreEmulator},
    firestoreEmulatorHost: ${quote(config.firestoreEmulatorHost)},
    firestoreEmulatorPort: ${config.firestoreEmulatorPort},
    authAccountCollection: ${quote(config.authAccountCollection)},
    peopleCollection: ${quote(config.peopleCollection)},
    childProfileCollection: ${quote(config.childProfileCollection)},
    childLinkCollection: ${quote(config.childLinkCollection)},
    usernameIndexCollection: ${quote(config.usernameIndexCollection)},
    legacyUserProfileCollection: ${quote(config.legacyUserProfileCollection)},
  },
};
`;
}

function quote(value) {
  return JSON.stringify(value);
}
