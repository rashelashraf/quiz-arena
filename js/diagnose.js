/* ---------------------------------------------------------------------------
   diagnose.js — walks the Firebase setup one step at a time.

   Deliberately does not use db.js, so that a bug in db.js cannot hide the real
   problem. Everything here talks to Firebase directly.
--------------------------------------------------------------------------- */

import { FIREBASE_CONFIG, BOOTSTRAP_ADMIN_UIDS, SDK_VERSION, FIRESTORE_DATABASE_ID } from './config.js';
import { el, $, toast } from './render.js';

const SDK = `https://www.gstatic.com/firebasejs/${SDK_VERSION || '10.12.2'}`;
const checks = $('#checks');
const logBox = $('#log');
const actions = $('#actions');
const lines = [];

function log(...parts) {
  lines.push(parts.join(' '));
  logBox.value = lines.join('\n');
}

function step(title) {
  const dot = el('span', { class: 'dot wait', text: '·' });
  const detail = el('div', { class: 'detail', text: 'checking…' });
  const body = el('div', {}, [el('h3', { text: title }), detail]);
  checks.appendChild(el('div', { class: 'check-row' }, [dot, body]));
  return {
    pass(msg) { dot.className = 'dot go'; dot.textContent = '✓'; detail.textContent = msg; log('OK  ', title, '—', msg); },
    fail(msg, hint) {
      dot.className = 'dot no'; dot.textContent = '✕'; detail.textContent = msg;
      if (hint) body.appendChild(el('div', { class: 'hint', html: hint }));
      log('FAIL', title, '—', msg);
    },
    warn(msg, hint) {
      dot.className = 'dot wait'; dot.textContent = '!'; detail.textContent = msg;
      if (hint) body.appendChild(el('div', { class: 'hint', html: hint }));
      log('WARN', title, '—', msg);
    }
  };
}

function errText(e) {
  return `${e?.code ? e.code + ': ' : ''}${e?.message || e}`;
}

$('#copy-log').addEventListener('click', async () => {
  await navigator.clipboard.writeText(logBox.value);
  toast('Copied');
});

await main();

async function main() {

log('Quiz Arena connection check', new Date().toISOString());
log('page:', location.href);
log('project:', FIREBASE_CONFIG.projectId || '(none)');
log('sdk:', SDK);

/* 1 — how the page is being served ---------------------------------------- */

const serving = step('How this page is being served');
if (location.protocol === 'file:') {
  serving.fail('Opened straight from the disk.',
    'Browsers block JavaScript modules on <code>file://</code>, so nothing here can work. Run <code>python3 -m http.server 8080</code> in this folder and open <code>http://localhost:8080</code>, or publish to GitHub Pages.');
  return;
} else {
  serving.pass(`${location.protocol}//${location.host}`);
}

/* 2 — config --------------------------------------------------------------- */

const cfg = step('Firebase settings in js/config.js');
const missing = ['apiKey', 'authDomain', 'projectId', 'appId'].filter((k) => !FIREBASE_CONFIG[k]);
if (missing.length) {
  cfg.fail(`Missing: ${missing.join(', ')}`,
    'Firebase console, Project settings, Your apps, Web app. Copy the whole config object into <code>js/config.js</code>.');
} else if (FIREBASE_CONFIG.authDomain && !FIREBASE_CONFIG.authDomain.includes(FIREBASE_CONFIG.projectId)) {
  cfg.warn(`Project ${FIREBASE_CONFIG.projectId}, but authDomain is ${FIREBASE_CONFIG.authDomain}`,
    'These usually match. Check you did not paste two different projects together.');
} else {
  cfg.pass(`Project ${FIREBASE_CONFIG.projectId}`);
}

/* 3 — the library ---------------------------------------------------------- */

let initializeApp, auth, firestore;
const sdk = step('Downloading the Firebase library');
try {
  [{ initializeApp }, auth, firestore] = await Promise.all([
    import(`${SDK}/firebase-app.js`),
    import(`${SDK}/firebase-auth.js`),
    import(`${SDK}/firebase-firestore.js`)
  ]);
  sdk.pass(`Version ${SDK_VERSION || '10.12.2'} loaded from Google's CDN`);
} catch (e) {
  sdk.fail(errText(e),
    'The browser could not fetch the Firebase library. Usually a blocked network, an extension blocking <code>gstatic.com</code>, or a version number that does not exist. Try setting <code>SDK_VERSION</code> in <code>js/config.js</code> to <code>10.12.2</code>.');
  return;
}

/* 4 — starting the app ----------------------------------------------------- */

let app, store;
const start = step('Starting the Firebase app');
try {
  app = initializeApp(FIREBASE_CONFIG);
  store = FIRESTORE_DATABASE_ID ? firestore.getFirestore(app, FIRESTORE_DATABASE_ID) : firestore.getFirestore(app);
  start.pass(FIRESTORE_DATABASE_ID ? `Using database "${FIRESTORE_DATABASE_ID}"` : 'Using the default database');
} catch (e) {
  start.fail(errText(e), 'The config object is present but Firebase would not accept it. Copy it again from the console.');
  return;
}

/* 5 — anonymous sign-in ----------------------------------------------------- */

let uid = null;
const signin = step('Signing in anonymously');
try {
  const cred = await auth.signInAnonymously(auth.getAuth(app));
  uid = cred.user.uid;
  signin.pass(`Signed in as ${uid}`);
} catch (e) {
  const hints = {
    'auth/operation-not-allowed': 'Anonymous sign-in is off. Firebase console, Authentication, Sign-in method, Anonymous, Enable, Save.',
    'auth/configuration-not-found': 'Authentication has never been opened on this project. Firebase console, Authentication, Get started, then enable Anonymous.',
    'auth/api-key-not-valid': 'The <code>apiKey</code> does not belong to this project. Copy the config again.',
    'auth/invalid-api-key': 'The <code>apiKey</code> is not valid. Copy the config again.',
    'auth/unauthorized-domain': `Add <code>${location.hostname}</code> under Authentication, Settings, Authorized domains.`,
    'auth/network-request-failed': 'The browser could not reach Firebase at all. Check the connection, and any school firewall or ad blocker.'
  };
  signin.fail(errText(e), hints[e?.code] || 'Open Authentication in the Firebase console and make sure Anonymous sign-in is enabled.');
  return;
}

/* 6 — reading from Firestore ------------------------------------------------ */

const read = step('Reading from Firestore');
let canRead = false;
try {
  const snap = await firestore.getDocs(firestore.collection(store, 'classes'));
  canRead = true;
  read.pass(`Reads are working. ${snap.size} class${snap.size === 1 ? '' : 'es'} found.`);
} catch (e) {
  const hints = {
    'permission-denied': 'Firestore answered, but the rules refused the read. Paste <code>firestore.rules</code> into Firestore, Rules and press Publish. The default locked-mode rules block everything.',
    'unavailable': 'No answer from Firestore. The most common cause is that the database has not been created: Firebase console, Firestore Database, Create database, Native mode.',
    'not-found': 'That database does not exist. If you named it something other than <code>(default)</code>, put the name in <code>FIRESTORE_DATABASE_ID</code> in <code>js/config.js</code>.',
    'failed-precondition': 'If you created the database in Datastore mode, it will not work. It has to be Native mode.'
  };
  read.fail(errText(e), hints[e?.code] || 'Check that a Firestore database exists and that the rules have been published.');
}

/* 7 — teacher status --------------------------------------------------------- */

let isTeacher = false;
let locked = false;
if (canRead) {
  const who = step('Is this device a teacher?');
  try {
    if (BOOTSTRAP_ADMIN_UIDS.includes(uid)) {
      isTeacher = true;
      who.pass('Listed in BOOTSTRAP_ADMIN_UIDS in js/config.js');
    } else {
      const snap = await firestore.getDoc(firestore.doc(store, 'admins', uid));
      isTeacher = snap.exists();
      // If this read is refused, the published rules predate the meta
      // collection. Treat the list as open so the claim button still appears.
      try {
        locked = (await firestore.getDoc(firestore.doc(store, 'meta', 'lock'))).exists();
      } catch { locked = false; }
      if (isTeacher) who.pass('Yes. This device can create classes and run quizzes.');
      else if (locked) who.fail('No, and the teacher list is closed.',
        `Add a document to the <code>admins</code> collection whose <b>document ID</b> is <code>${uid}</code>. The ID is what matters, not the fields inside.`);
      else who.warn('Not yet, but the teacher list is still open.',
        'Press <b>Claim teacher access</b> below, then close the list. If the claim is refused, the rules published in Firebase are older than the ones in <code>firestore.rules</code> — paste them in again and press Publish. To teach from several machines, sign in with a teacher account on the home page first.');
    }
  } catch (e) {
    who.fail(errText(e), 'Reads worked elsewhere, so this is probably a rules mismatch. Re-publish <code>firestore.rules</code>.');
  }
}

/* 8 — writing ---------------------------------------------------------------- */

if (canRead && isTeacher) {
  const write = step('Writing to Firestore');
  try {
    const ref = firestore.doc(store, 'classes', '__connection_check__');
    await firestore.setDoc(ref, { probe: true, at: Date.now() });
    await firestore.deleteDoc(ref);
    write.pass('Writes are working. Everything is set up.');
  } catch (e) {
    write.fail(errText(e), 'This device is listed as a teacher but the rules still refused the write. Make sure the published rules are the ones from <code>firestore.rules</code>, not the default locked-mode set.');
  }
}

/* ---------- what to do next -------------------------------------------------- */

if (canRead && !isTeacher && !locked) {
  actions.appendChild(el('button', {
    class: 'btn-primary btn-big',
    onclick: async (e) => {
      e.target.disabled = true;
      try {
        await firestore.setDoc(firestore.doc(store, 'admins', uid), { claimedAt: Date.now(), device: navigator.userAgent.slice(0, 140) });
        toast('This device is now a teacher.');
        setTimeout(() => location.reload(), 900);
      } catch (err) {
        e.target.disabled = false;
        toast(errText(err), 'bad');
        log('FAIL claim —', errText(err));
      }
    },
    text: 'Claim teacher access'
  }));
}

if (isTeacher && !locked) {
  actions.appendChild(el('button', {
    onclick: async (e) => {
      if (!confirm('Close the teacher list? After this, new teachers have to be added from the Firebase console.')) return;
      e.target.disabled = true;
      try {
        await firestore.setDoc(firestore.doc(store, 'meta', 'lock'), { lockedAt: Date.now(), by: uid });
        toast('Teacher list closed.');
        setTimeout(() => location.reload(), 900);
      } catch (err) { e.target.disabled = false; toast(errText(err), 'bad'); }
    },
    text: 'Close the teacher list'
  }));
}

if (isTeacher) actions.appendChild(el('a', { class: 'btn btn-go', href: 'admin.html', text: 'Open the teacher console' }));

}
