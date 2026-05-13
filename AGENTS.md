# Campux Agent Guide

## UI Direction

CampuxNext should keep the visual spirit of the old Campux app. Do not redesign it into a generic SaaS dashboard or a polished admin-console shell.

The product should feel like a lightweight campus wall tool:

- simple, direct, and student-facing
- mobile-first for the posting flow
- tenant architecture should stay mostly invisible to normal users
- plain white page background
- bold `Campux` wordmark
- small, saturated functional color blocks
- minimal decoration
- no large marketing hero, glassmorphism, floating card shell, or heavy gradient background

## Layout Rules

Mobile is the primary UI. The default posting screen should follow the old Campux structure:

- `Campux` title plus current wall/brand name at the top
- current wall/brand name at the top, without a tenant switcher on normal user pages
- yellow horizontal announcement banner
- avatar plus large post textarea
- image thumbnails and add-image entry in roughly `70px` square blocks
- anonymous posting as a compact green block
- post rules as a compact orange block
- colorful gradient submit button
- bottom navigation for primary pages

Desktop may add a simple sidebar, but it should reference the old desktop layout:

- left sidebar with a blue `Campux` header
- emoji/text navigation entries such as `📝 投稿`, `🌏 稿件`, `🛠 服务`, `🔐 管理`
- selected item is just bolder or lightly highlighted
- avatar/account area at the bottom
- keep the main content plain and task-focused

Do not use a dense enterprise sidebar with nested navigation, metrics cards, hero panels, or dashboard widgets unless the user explicitly asks for that.

## Tenant Visibility

CampuxNext may be multi-tenant internally, but ordinary users usually only participate in one campus wall. Avoid exposing "tenant" as a primary product concept in user-facing screens.

- Do not show a tenant switcher on the home/posting flow, feed, or service pages.
- Use the campus wall name as brand context, not as an account/workspace selector.
- Put tenant or wall switching only in admin/configuration surfaces when it is actually needed.
- Prefer user-facing words like `校园墙`, `墙号`, `当前校园墙`, or the wall's brand name. Avoid showing raw `tenant`, `tenantId`, or slugs in normal UI.

## Account And Roles

CampuxNext uses one flat account system. A person has one `User` account, and that account may be authorized to enter one or more campus walls through `TenantMembership`.

Do not create separate accounts per campus wall. Do not allow an account to enter every wall by default. Access to a wall must be explicitly granted, usually when the user registers through that wall's bot.

Login flow:

- If the account has no campus wall membership, show an access denied / no authorized campus wall state.
- If the account has exactly one campus wall membership, enter that wall directly.
- If the account has multiple memberships, ask the user to choose which campus wall to enter.
- If the account has system operation permission, also expose a separate system operations entry.
- The system operations entry must be visually and structurally separate from the ordinary campus wall workspace. Do not add it as a normal tenant tab.

There are two role layers.

Global account role:

| Role | Chinese name | Scope | Meaning |
| --- | --- | --- | --- |
| `system_operator` | 系统运维 | Global account-level role | Can enter the independent operations panel and manage system-level lifecycle, user, membership, queue, audit, and domain state. |

Tenant membership role:

| Role | Chinese name | Scope | Meaning |
| --- | --- | --- | --- |
| `submitter` | 用户 | One campus wall | Can submit posts and view or withdraw their own posts. |
| `reviewer` | 审核员 | One campus wall | Can review posts for that campus wall. |
| `admin` | 管理员 | One campus wall | Can review posts and manage allowed settings for that campus wall. |

Important boundaries:

- Normal user-facing pages should use the current campus wall context and hide tenant mechanics.
- `submitter` should only see posting and their own post status.
- `reviewer` should only see review-related surfaces, not wall settings.
- `admin` can only administer the campus wall where they have the `admin` membership.
- `system_operator` manages system-level operations such as tenant lifecycle, global users, membership, queue state, audit logs, and domain bindings.
- Campus wall display settings belong to tenant admins, not the system operations panel. This includes wall name, slug, theme color, front-facing brand name, announcements, post rules, and service links.
- If a system operator is also a member of a campus wall, the ordinary wall workspace should still look like the normal tenant workspace. Use the account menu or tenant selection screen to enter the separate operations panel.

## Component Style

Use shadcn/ui where it helps consistency and accessibility, but do not let shadcn defaults dictate the look. Campux styling should override components toward the old app's simpler look.

Preferred treatments:

- low-radius or old-style rounded blocks for functional strips
- minimal borders and shadows
- native-feeling text areas
- compact buttons
- vivid single-purpose colors:
  - announcement: yellow/orange
  - anonymous: green
  - rules: orange
  - primary posting action: old colorful gradient
  - desktop sidebar header: blue

Avoid:

- large rounded cards around every section
- blue-gray textarea panels
- decorative radial gradients or app-shell backgrounds
- centered desktop phone mockup as the default desktop experience
- labels/tags feature in the post composer; this feature is intentionally removed

## Implementation Notes

Current frontend direction:

- Vite + React
- shadcn/ui component primitives
- Tailwind CSS
- mobile bottom navigation, desktop sidebar

When changing the UI, compare against `legacy/frontend/src/pages/post.vue`, `legacy/frontend/src/pages/index.vue`, and `legacy/frontend/src/components/BottomNavBar.vue` before inventing a new visual direction.

Keep changes scoped and verify with:

```bash
bun --cwd apps/web typecheck
```
