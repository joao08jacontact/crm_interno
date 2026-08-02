# Internal Operations Dashboard Design Guidelines

## Design Approach

**System**: Linear-inspired dark dashboard aesthetics + Material Design data visualization principles
**Justification**: Utility-focused, information-dense internal tool requiring clarity, professional polish, and efficient data presentation

**Key Principles**:
- Maximum information density without clutter
- Hierarchical data presentation (overview → detail)
- Scannable metrics with instant comprehension
- Dark mode optimized for extended use

---

## Typography

**Families**: 
- Primary: Inter (via Google Fonts CDN) - UI, metrics, labels
- Monospace: JetBrains Mono - numerical data, timestamps, IDs

**Hierarchy**:
- Dashboard title: text-2xl font-semibold
- Section headers: text-lg font-semibold
- Card titles: text-sm font-medium uppercase tracking-wide
- Metrics (large numbers): text-4xl font-bold tabular-nums
- Metric labels: text-xs font-medium text-gray-400
- Body/descriptions: text-sm
- Data tables: text-sm tabular-nums
- Timestamps: text-xs font-mono text-gray-500

---

## Layout System

**Spacing Primitives**: Tailwind units of 2, 3, 4, 6, 8
- Component padding: p-4 to p-6
- Card spacing: gap-4, gap-6
- Section margins: mb-6, mb-8
- Grid gaps: gap-4

**Container Structure**:
- Full viewport layout with fixed sidebar (w-64)
- Main content: p-6 with max-w-screen-2xl
- Dashboard grid: grid-cols-1 md:grid-cols-2 lg:grid-cols-4 for metric cards
- Responsive breakpoints: mobile (single column) → tablet (2 cols) → desktop (3-4 cols)

---

## Component Library

### Navigation
**Sidebar** (fixed, w-64, dark background):
- Logo/brand at top (h-16)
- Navigation items with icons (Heroicons) + labels
- Active state: subtle accent background + border-l-2
- Section dividers with text-xs uppercase labels

**Top Bar** (sticky, backdrop-blur):
- Breadcrumb navigation
- Search bar (w-96)
- User profile + notification bell (right-aligned)

### Dashboard Cards

**Metric Cards** (4-column grid on desktop):
- White/light border on dark background
- Icon in accent color (top-left, w-10 h-10)
- Large metric number (center, text-4xl)
- Label below (text-xs uppercase)
- Trend indicator (small chart or percentage with arrow)
- Minimum height: h-32

**Chart Cards** (2-column or full-width):
- Card header: title + time range selector + filter icon
- Chart area with grid lines (subtle gray)
- Legend below chart
- Tooltip on hover showing exact values

### Data Visualization

**Line Charts** (Tickets Opened vs Closed):
- Two lines with distinct colors from HSL 217 palette
- Area fill with low opacity (0.1-0.2)
- Grid: horizontal lines only, subtle
- Axis labels: text-xs
- Data points: circles on hover
- Height: h-64 to h-80

**Timeline/Gantt View**:
- Header row: months/weeks with vertical dividers
- Ticket rows: left-aligned ticket ID + title
- Timeline bars: rounded, with status-based colors
- Dependencies: dotted connector lines
- Drag handles on bar edges
- Compact row height (h-10)

**Kanban Board**:
- Horizontal scroll container
- Columns: min-w-80, max-w-96
- Column headers: count badge + add button
- Cards: p-3, gap-2 between cards
- Card elements: ticket ID (badge), title (font-medium), assignee avatar, priority icon, due date
- Drag indicator on hover

### Forms & Inputs

**Search/Filter Bar**:
- Dark input with light border
- Inline icon (left)
- Clear button (right) when populated
- Autocomplete dropdown below

**Date Range Picker**:
- Two input fields with calendar icon
- Connected with dash separator
- Dropdown calendar on click

**Status Filters**:
- Pill buttons (rounded-full)
- Multi-select with checkmarks
- Active state: filled with accent color

### Tables

**Ticket List View**:
- Sticky header row
- Alternating row backgrounds (very subtle)
- Columns: ID, Title, Status (badge), Priority (icon), Assignee (avatar), Updated (relative time)
- Row actions on hover (right side)
- Sortable columns (arrow icons)

---

## Animations

**Minimal & Purposeful**:
- Chart data: 300ms ease-in-out transition
- Card hover: subtle scale (scale-[1.02])
- Skeleton loading for async data
- Tooltip fade-in: 150ms
- NO continuous animations, NO distracting effects

---

## Icons

**Library**: Heroicons (via CDN)
**Usage**:
- Navigation: outline style (w-5 h-5)
- Metric cards: solid style (w-8 h-8)
- Status indicators: mini style (w-4 h-4)
- Actions: outline style (w-5 h-5)

---

## Images

**No hero images** - Dashboard prioritizes functional density. Use brand logo in sidebar only.