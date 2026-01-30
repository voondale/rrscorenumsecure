One‑Set League Tracker – v5.5.1
=================================================

What’s in this build
--------------------
• Anonymous users can submit a score exactly once per match (create-only).
• Admins (email/password) can create/overwrite/delete results, upload/reset schedule, rename players, and manage phone numbers.
• Admin detection is by UID (configured in app.js) and/or by adding emails to ADMIN_EMAILS.

How to use
----------
1) Enable Email/Password sign-in in Firebase Console → Authentication → Sign-in method.
2) Create an admin user in Firebase Console → Authentication → Users.
3) (Optional) Add the admin email to ADMIN_EMAILS in app.js. Your known admin UID is already included.
4) Deploy Firestore rules:
   - Console: Firestore Database → Rules → paste firebase.rules → Publish
   - Or CLI:  firebase deploy --only firestore:rules
5) Host index.html, styles.css, app.js (e.g., GitHub Pages). The app signs in anonymous viewers automatically.

Behavior
--------
• Anonymous:
  - Can press “Save Match” to CREATE results. Will be rejected if a result already exists.
  - Cannot delete/update results, or write to matches/players (rules block it and UI hides admin controls).
• Admin:
  - Sign in with Email/Password. Admin Panel becomes visible.
  - Can overwrite/delete results; upload/reset schedule; rename; manage phones.

Files
-----
• index.html, styles.css, app.js – app UI and logic.
• firebase.rules – Firestore security rules (Option A + admin-only writes elsewhere).
• firebase.json – points to firebase.rules for CLI deployment.

Built on: 2026-01-30T18:12:44
