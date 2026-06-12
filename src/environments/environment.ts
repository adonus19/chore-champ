import { AppEnvironment } from './environment.model';

export const environment: AppEnvironment = {
  production: true,
  firebase: {
    apiKey: 'AIzaSyD1Djk4mW5p_n9zz0kCRvqHnMhRXLY6n5c',
    authDomain: 'chorechamp-9be80.firebaseapp.com',
    projectId: 'chorechamp-9be80',
    appId: '1:545586351272:web:6a6e05ecdb0489393f469d',
    messagingSenderId: '545586351272',
    storageBucket: 'chorechamp-9be80.firebasestorage.app',
    useAuthEmulator: false,
    authEmulatorUrl: 'http://127.0.0.1:9099',
    useFirestoreEmulator: false,
    firestoreEmulatorHost: '127.0.0.1',
    firestoreEmulatorPort: 8080,
    authAccountCollection: 'authAccounts',
    peopleCollection: 'people',
    childProfileCollection: 'childProfiles',
    childLinkCollection: 'childLinks',
    usernameIndexCollection: 'usernameIndex',
    legacyUserProfileCollection: 'userProfiles',
  },
};
