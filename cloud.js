// Google sign-in + Firestore sync. Loaded as an ES module after app.js.
// Talks to app.js through window.App; exposes its own state on window.Cloud.
const cfg = window.FIREBASE_CONFIG;
const Cloud = (window.Cloud = { status: "unconfigured", user: null, lastSync: null, error: null });
const App = window.App;
const notify = () => App?.refreshAuth();

if (cfg && cfg.apiKey) {
  Cloud.status = "loading";
  notify();
  try {
    const V = "13.4.0";
    const [{ initializeApp }, A, F] = await Promise.all([
      import(`https://www.gstatic.com/firebasejs/${V}/firebase-app.js`),
      import(`https://www.gstatic.com/firebasejs/${V}/firebase-auth.js`),
      import(`https://www.gstatic.com/firebasejs/${V}/firebase-firestore.js`),
    ]);
    const app = initializeApp(cfg);
    const auth = A.getAuth(app);
    const db = F.getFirestore(app);
    const clientId = Math.random().toString(36).slice(2);
    let unsub = null;
    let pushTimer = null;

    const docRef = (uid) => F.doc(db, "users", uid);

    async function push() {
      if (!Cloud.user) return;
      try {
        await F.setDoc(docRef(Cloud.user.uid), {
          state: JSON.stringify(App.getState()),
          writer: clientId,
          updatedAt: F.serverTimestamp(),
          profile: { name: Cloud.user.displayName || "", email: Cloud.user.email || "", photo: Cloud.user.photoURL || "" },
          stats: App.getStats(),
        }, { merge: true });
        Cloud.lastSync = new Date();
        Cloud.error = null;
      } catch (e) {
        Cloud.error = e.message;
      }
      notify();
    }
    Cloud.schedulePush = () => {
      clearTimeout(pushTimer);
      pushTimer = setTimeout(push, 1200);
    };

    Cloud.signIn = async () => {
      const provider = new A.GoogleAuthProvider();
      try {
        await A.signInWithPopup(auth, provider);
      } catch (e) {
        if (e.code === "auth/popup-blocked" || e.code === "auth/operation-not-supported-in-this-environment") {
          return A.signInWithRedirect(auth, provider);
        }
        if (e.code !== "auth/popup-closed-by-user" && e.code !== "auth/cancelled-popup-request") {
          Cloud.error = e.message;
          alert("Sign-in failed: " + e.message);
          notify();
        }
      }
    };
    Cloud.signOut = async () => {
      await push();
      await A.signOut(auth);
    };

    A.onAuthStateChanged(auth, async (user) => {
      unsub?.();
      unsub = null;
      Cloud.user = user;
      if (!user) {
        Cloud.status = "signedOut";
        Cloud.lastSync = null;
        return notify();
      }
      Cloud.status = "syncing";
      notify();
      try {
        const snap = await F.getDoc(docRef(user.uid));
        if (snap.exists() && snap.data().state) App.mergeRemote(JSON.parse(snap.data().state));
        if (!snap.exists() || !snap.data().createdAt) await F.setDoc(docRef(user.uid), { createdAt: F.serverTimestamp() }, { merge: true });
        await push();
        Cloud.status = "signedIn";
        // live updates from other devices
        unsub = F.onSnapshot(docRef(user.uid), (s) => {
          const d = s.data();
          if (!d || s.metadata.hasPendingWrites || d.writer === clientId || !d.state) return;
          App.mergeRemote(JSON.parse(d.state));
          Cloud.lastSync = new Date();
          notify();
        });
      } catch (e) {
        Cloud.status = "signedIn";
        Cloud.error = e.message;
      }
      notify();
    });
  } catch (e) {
    Cloud.status = "error";
    Cloud.error = "Could not load Firebase (are you offline?) " + e.message;
    notify();
  }
} else {
  notify();
}
