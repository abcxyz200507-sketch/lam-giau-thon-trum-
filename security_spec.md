# Firestore Security Specification (Phase 0)

## Data Invariants
1. Every document in `/players/{playerId}` must have `playerId == request.auth.uid` on creation (`isOwner(playerId)`), matching `^[a-zA-Z0-9_\-]+$`, and requires a verified Firebase Auth user (`email_verified == true`).
2. A player cannot self-assign admin or elevated roles: `role` must always equal `'player'` on creation and remains immutable on updates.
3. No raw passwords, emails, phone numbers, or PII are stored in `/players/{playerId}`.
4. `uid` and `createdAt` are immutable after document creation.
5. `createdAt`, `lastLoginAt`, and `updatedAt` must match `request.time` (server timestamps).
6. Only the document owner (`isOwner(playerId)`) or the bootstrapped admin (`abcxyz200507@gmail.com` verified) can read (`/players/{playerId}`) or update a player profile; `allow list` never performs `get()`/`exists()` lookups and restricts non-admins to `resource.data.uid == request.auth.uid`.
7. `/admins/{adminUid}` cannot be created, updated, deleted, or listed from client SDKs.

## Dirty Dozen Adversarial Payloads (Must Return PERMISSION_DENIED)
1. Unauthenticated create on `/players/user1` (`request.auth == null`).
2. Unverified email create on `/players/user1` (`email_verified == false`).
3. Identity spoofing: `uid: "other_uid"` when `request.auth.uid == "user1"`.
4. Path ID poisoning: `/players/bad$id!with/slashes` or 200-char ID.
5. Privilege escalation: `create` on `/players/user1` with `role: "admin"`.
6. Shadow field injection: `create` with extra field `isAdmin: true`.
7. Fake timestamp: `createdAt` set to a client-chosen past date instead of `request.time`.
8. Oversized displayName (> 24 chars) or invalid balance type (`balance: "999999"`).
9. Cross-user update: `user2` updating `/players/user1` (`displayName` / `balance`).
10. Immutable field tampering: `user1` updating `uid` or `createdAt` or `role`.
11. Unauthorized collection scrape: non-admin running `list` on `/players` without `where('uid', '==', auth.uid)`.
12. Privilege escalation write: non-admin attempting `create` on `/admins/user1`.
