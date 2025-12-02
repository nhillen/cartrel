# PRD: Marketplace (Supplier/Retailer Discovery)

**Goal**  
Provide a built-in marketplace for suppliers and retailers to discover each other, share profiles, and initiate connections—competing with Syncio’s marketplace and Faire-style discovery, while integrating with our connection/sync flows.

## Scope
- Profiles: store/brand profile with name, location, category, product count, website, social link, up to 6 images (1:1, <3MB), optional description. Visibility toggle.
- Search/Browse: keyword search; filters (location/region, category, product count range). Pagination.
- Contact/Invite: “Invite to connect” flow that sends a message (email) and includes profile; optionally prefill connection key/invite code. Track outgoing/incoming invites.
- Access: initially free to create a profile; available to both sources and destinations; universal stores supported. Respect visibility settings.
- Quality controls: hide/offline toggle; report/flag profiles; optional verification badge for vetted suppliers/retailers.
- Integration: deep link to connection flow (stores page) after invite is accepted; optional tagging of collections for recommended products.
- Guidance: link to collaboration tips and best practices.
- Performance: index profiles for fast search; rate-limit invite sending; image upload validation (size/ratio).

## UX/Flows
- Profile editor: fields, image upload (1:1 crop, size limit), preview, save/publish toggle.
- Marketplace browse: cards with image, name, category, location, product count; filter bar; search; detail view; invite CTA.
- Invite modal: message box, preferred contact email (from notification settings), send; show status (sent/pending/responded).
- Notifications: email + in-app for received invites/messages.
- Admin/moderation: ability to hide reported profiles.

## Non-goals
- Payments/commission negotiation (handled via payouts/agreements).
- Automated matchmaking/recommendations (could be future).

## Open Decisions
- Eligibility by tier (free vs Starter+); limits on invites per month on free to control spam.
- Verification criteria and process for badges.
- Whether to surface “hidden” products/collections tags for marketplace filtering.

## Differentiators / How we win
- Free profiles by default; minimal friction to join; more generous invite limits on lower tiers than Syncio early-access.
- Direct tie-in to our connection keys/invites and product-only mode for catalog sharing, plus re-share consent for marketplaces.
- Better profile quality controls (image guidelines, flagging) and optional verification to improve trust.
