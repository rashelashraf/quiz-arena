/* ---------------------------------------------------------------------------
   Paste your Firebase web config between the braces below, then commit.

   Firebase console -> Project settings -> Your apps -> Web app -> Config.
   These keys are meant to be public; your Firestore rules do the protecting.
   See firestore.rules in this repo.

   Leave it empty and the app runs in "this device only" mode, which stores
   everything in the browser. That mode is good for trying things out and for
   running a quiz with no internet, but nothing syncs to student phones.

   If something is not working, open diagnose.html. It checks each step in
   turn and tells you exactly which one failed.
--------------------------------------------------------------------------- */

export const FIREBASE_CONFIG = {
  apiKey: "AIzaSyB7fS_UWMarCLmdTqQXuXXqJ_RH5pMJmVY",
  authDomain: "quiz-b975c.firebaseapp.com",
  projectId: "quiz-b975c",
  storageBucket: "quiz-b975c.firebasestorage.app",
  messagingSenderId: "508813182766",
  appId: "1:508813182766:web:f2fa416c3ba2388a561cbf",
  measurementId: "G-FV5ZMN798M"
};

/* Only needed if you gave your Firestore database a name of its own instead of
   accepting the default. The console shows it at the top of the Firestore
   page; if it reads "(default)", leave this alone. */
export const FIRESTORE_DATABASE_ID = '';

/* Which build of the Firebase library to load from Google's CDN. Bump this if
   you ever need a newer one. */
export const SDK_VERSION = '10.12.2';

/* Optional. Any Firebase user whose UID is listed here is treated as a teacher
   without needing a document in the `admins` collection. Normally you will not
   need this: use the "Claim teacher access" button on the home page. */
export const BOOTSTRAP_ADMIN_UIDS = [];
