import { FirebaseOptions } from 'firebase/app';

export interface FirebaseEnvironmentConfig extends FirebaseOptions {
  useAuthEmulator: boolean;
  authEmulatorUrl: string;
  useFirestoreEmulator: boolean;
  firestoreEmulatorHost: string;
  firestoreEmulatorPort: number;
  authAccountCollection: string;
  peopleCollection: string;
  childProfileCollection: string;
  childLinkCollection: string;
  usernameIndexCollection: string;
  legacyUserProfileCollection: string;
}

export interface AppEnvironment {
  production: boolean;
  firebase: FirebaseEnvironmentConfig;
}
