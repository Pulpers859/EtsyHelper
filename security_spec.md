# Security Specification - EtsyAI

## Data Invariants
1. Only authenticated users can manage their shop data.
2. In this single-user template, we assume the user owns all shop data for now, but we'll structure it for future multi-user support by adding an `ownerId` field.
3. Timestamps must be server-generated.
4. Stock levels must be non-negative integers.

## The Dirty Dozen Payloads
1. **Unauthenticated Write**: Attempting to create an inventory item without being logged in. (Expected: `PERMISSION_DENIED`)
2. **Identity Spoofing**: Attempting to set `ownerId` to another user's ID. (Expected: `PERMISSION_DENIED`)
3. **Ghost Fields**: Attempting to inject `isAdmin: true` into a profile. (Expected: `PERMISSION_DENIED`)
4. **Invalid Type**: Attempting to set `stockLevel` to a string instead of an integer. (Expected: `PERMISSION_DENIED`)
5. **Negative Stock**: Attempting to set `stockLevel` to -1. (Expected: `PERMISSION_DENIED`)
6. **Path Poisoning**: Using a long junk string as a document ID. (Expected: `PERMISSION_DENIED`)
7. **Bypassing Status**: Manually setting a post status to `posted` without a valid `postedAt` timestamp. (Expected: `PERMISSION_DENIED`)
8. **Owner Override**: User A trying to delete User B's inventory. (Expected: `PERMISSION_DENIED`)
9. **Blanket Read**: Authenticated user trying to list all interactions from all shops. (Expected: `PERMISSION_DENIED`)
10. **Timestamp Fraud**: Providing a client-side timestamp for `updatedAt`. (Expected: `PERMISSION_DENIED`)
11. **Huge Data**: Attempting to post a 1MB string in a category field. (Expected: `PERMISSION_DENIED`)
12. **Status Lock**: Attempting to edit a `posted` social media post. (Expected: `PERMISSION_DENIED`)

## Test Runner
The firestore.rules.test.ts will be implemented to verify these constraints.
